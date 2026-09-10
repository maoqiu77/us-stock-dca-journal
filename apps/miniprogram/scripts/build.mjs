import { build } from 'esbuild';
import { cp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
// Recreate only our generated subtree; keep the developer's private project
// settings in dist untouched. Copy an explicit source manifest, never backups.
await rm(join(out, 'miniprogram'), { recursive: true, force: true });
await mkdir(join(out, 'miniprogram/lib'), { recursive: true });
const sourceApp = JSON.parse(await readFile(join(root, 'miniprogram/app.json'), 'utf8'));
const staticFiles = ['app.js', 'app.json', 'app.wxss', 'sitemap.json', ...sourceApp.pages.flatMap(page => ['js', 'json', 'wxml', 'wxss'].map(ext => `${page}.${ext}`))];
for (const file of staticFiles) {
  if (file.includes('..') || file.startsWith('/')) throw Error('invalid_source_path');
  await mkdir(dirname(join(out, 'miniprogram', file)), { recursive: true });
  await cp(join(root, 'miniprogram', file), join(out, 'miniprogram', file));
}
await cp(join(root, 'project.config.json'), join(out, 'project.config.json'));
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
await writeFile(join(out, 'README.txt'), '交易日记 · 微信小程序离线测试版\n\n在微信开发者工具中导入此文件所在目录（包含 project.config.json）。\nAppID 选择测试号/游客模式，不使用云服务。无需构建 npm。\n无 AppID 仅用于开发者工具调试，不代表已支持手机扫码预览。\n先点击持仓页“体验示例”测试；示例为虚构数据。\n测试结束在设置页开始新的空账本。\n完整说明见源码 docs/miniprogram/README.md。\n');
console.log(`WeChat project built: ${out}\nMain package: ${(bytes / 1024).toFixed(1)} KiB; ${app.pages.length} pages; no external runtime imports.`);
