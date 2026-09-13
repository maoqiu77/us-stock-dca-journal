import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
// Recreate only our generated subtree; keep the developer's private project
// settings in dist untouched. Copy an explicit source manifest, never backups.
await rm(join(out, 'miniprogram'), { recursive: true, force: true });
await mkdir(join(out, 'miniprogram/lib'), { recursive: true });
const sourceApp = JSON.parse(await readFile(join(root, 'miniprogram/app.json'), 'utf8'));
const staticFiles = ['app.js', 'app.json', 'app.wxss', 'config.js', 'sitemap.json', ...sourceApp.pages.flatMap(page => ['js', 'json', 'wxml', 'wxss'].map(ext => `${page}.${ext}`))];
for (const file of staticFiles) {
  if (file.includes('..') || file.startsWith('/')) throw Error('invalid_source_path');
  await mkdir(dirname(join(out, 'miniprogram', file)), { recursive: true });
  await cp(join(root, 'miniprogram', file), join(out, 'miniprogram', file));
}
const baseProject = JSON.parse(await readFile(join(root, 'project.config.json'), 'utf8'));
let local = {};
try { local = JSON.parse(await readFile(join(root, 'config.local.json'), 'utf8')); } catch (error) { if (error?.code !== 'ENOENT') throw Error('config.local.json 不是有效 JSON。'); }
const allowed = new Set(['appid', 'cloudEnvId', 'aiFunctionName', 'aiTransport']);
if (Object.keys(local).some(key => !allowed.has(key))) throw Error('config.local.json 包含不允许的字段。');
const transport = local.aiTransport ?? 'fake';
if (!['fake', 'cloud'].includes(transport)) throw Error('aiTransport 只能是 fake 或 cloud。');
if (transport === 'cloud' && (!local.appid || local.appid === 'touristappid' || !local.cloudEnvId || !local.aiFunctionName)) throw Error('cloud 构建需要私有 AppID、cloudEnvId 和 aiFunctionName。');
const project = { ...baseProject, appid: local.appid ?? baseProject.appid, cloudfunctionRoot: 'cloudfunctions/' };
await writeFile(join(out, 'project.config.json'), JSON.stringify(project, null, 2));
await writeFile(join(out, 'miniprogram/config.js'), `module.exports = ${JSON.stringify({ cloudEnvId: local.cloudEnvId ?? '', aiFunctionName: local.aiFunctionName ?? 'portfolioAi', aiTransport: transport })};\n`);
const result = await build({ entryPoints: [join(root, 'src/runtime.ts')], outfile: join(out, 'miniprogram/lib/core.js'), bundle: true, format: 'cjs', platform: 'browser', target: 'es2018', minify: true, legalComments: 'eof', metafile: true,
  // WeChat offers globalThis in supported engines; Intl itself can be absent.
  banner: { js: 'if(typeof globalThis.Intl === "undefined") globalThis.Intl = {};' },
});
for (const output of Object.values(result.metafile.outputs)) {
  if (output.imports.length) throw Error(`unbundled_runtime_dependency: ${JSON.stringify(output.imports)}`);
}
const app = JSON.parse(await readFile(join(out, 'miniprogram/app.json'), 'utf8'));
for (const page of app.pages) {
  for (const extension of ['js', 'json', 'wxml', 'wxss']) await stat(join(out, 'miniprogram', `${page}.${extension}`));
}
for (const tab of app.tabBar.list) if (!app.pages.includes(tab.pagePath)) throw Error(`missing_tab_page: ${tab.pagePath}`);
async function size(path) { let bytes = 0; for (const item of await readdir(path, { withFileTypes: true })) bytes += item.isDirectory() ? await size(join(path, item.name)) : (await stat(join(path, item.name))).size; return bytes; }
const bytes = await size(join(out, 'miniprogram'));
if (bytes > 2 * 1024 * 1024) throw Error(`main_package_over_2MiB: ${bytes}`);
const repoRoot = resolve(root, '../..'), gatewayRoot = join(repoRoot, 'apps/ai-gateway');
await promisify(execFile)('npm', ['run', 'build', '-w', '@portfolio/ai-gateway'], { cwd: repoRoot });
await rm(join(out, 'cloudfunctions'), { recursive: true, force: true });
await cp(join(gatewayRoot, 'cloud'), join(out, 'cloudfunctions'), { recursive: true });
await cp(join(gatewayRoot, 'dist/gateway.cjs'), join(out, 'cloudfunctions/portfolioAi/gateway.cjs'));
await writeFile(join(out, 'README.txt'), `交易日记 · 微信小程序 A2/A3 ${transport === 'cloud' ? '云联调构建' : '离线构建'}\n\n导入此目录。当前 AppID：${project.appid}，transport：${transport}。\ncloudfunctions 与 miniprogram 同级，不进入小程序主包。\n${transport === 'cloud' ? '先保持 AI_ENABLED=false 部署并验证 capabilities；不得在客户端配置模型 Key。' : '本构建不调用云函数，只运行明确标记的 fake 演示。'}\n`);
console.log(`WeChat project built: ${out}\nMain package: ${(bytes / 1024).toFixed(1)} KiB; ${app.pages.length} pages; transport=${transport}; appid=${project.appid}; cloud functions excluded.`);
