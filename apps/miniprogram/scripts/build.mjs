import { build, transform } from 'esbuild';
import { componentGraph } from './component-graph.mjs';
import { runInNewContext } from 'node:vm';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(root, '../..');
const out = join(root, 'dist');
const profileIndex = process.argv.indexOf('--profile');
const profile = profileIndex >= 0 ? process.argv[profileIndex + 1] : '';
if (!['development', 'test', 'production'].includes(profile)) throw Error('必须显式传入 --profile development|test|production。');

const packageJson = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
let local = {};
try { local = JSON.parse(await readFile(join(root, 'config.local.json'), 'utf8')); } catch (error) { if (error?.code !== 'ENOENT') throw Error('config.local.json 不是有效 JSON。'); }
const allowed = new Set(['appid', 'cloudEnvId', 'aiFunctionName', 'aiTransport', 'marketFunctionName']);
if (Object.keys(local).some(key => !allowed.has(key))) throw Error('config.local.json 包含不允许的字段。');
const requestedTransport = local.aiTransport ?? 'disabled';
if (profile === 'production' && !['cloud', 'disabled'].includes(requestedTransport)) throw Error('生产构建的 aiTransport 只能是 cloud 或 disabled。');
if (profile !== 'production' && !['fake', 'cloud', 'disabled'].includes(requestedTransport)) throw Error('开发/测试构建的 aiTransport 只能是 fake、cloud 或 disabled。');
const transport = requestedTransport === 'cloud' ? 'cloud' : 'disabled';
if ((transport === 'cloud' || local.marketFunctionName) && (!local.appid || local.appid === 'touristappid' || !local.cloudEnvId)) throw Error('cloud 构建需要私有 AppID 和 cloudEnvId。');
if (transport === 'cloud' && !local.aiFunctionName) throw Error('AI cloud 构建需要 aiFunctionName。');

await rm(join(out, 'miniprogram'), { recursive: true, force: true });
await mkdir(join(out, 'miniprogram/lib'), { recursive: true });
const sourceApp = JSON.parse(await readFile(join(root, 'miniprogram/app.json'), 'utf8'));
const components = await componentGraph(join(root, 'miniprogram'));
const staticFiles = ['utils/journal.js', 'app.js', 'app.json', 'app.wxss', 'config.js', 'sitemap.json', ...sourceApp.pages.flatMap(page => ['js', 'json', 'wxml', 'wxss'].map(ext => `${page}.${ext}`)), ...components.flatMap(component => ['js', 'json', 'wxml', 'wxss'].map(ext => `${component}.${ext}`))];
for (const file of staticFiles) {
  if (file.includes('..') || file.startsWith('/')) throw Error('invalid_source_path');
  await mkdir(dirname(join(out, 'miniprogram', file)), { recursive: true });
  if (file.endsWith('.js')) {
    const source = await readFile(join(root, 'miniprogram', file), 'utf8');
    const result = await transform(source, { minify: true, target: 'es2018', legalComments: 'eof' });
    await writeFile(join(out, 'miniprogram', file), result.code);
  } else await cp(join(root, 'miniprogram', file), join(out, 'miniprogram', file));
}
await cp(join(root, 'miniprogram/assets'), join(out, 'miniprogram/assets'), { recursive: true });
const baseProject = JSON.parse(await readFile(join(root, 'project.config.json'), 'utf8'));
const project = { ...baseProject, description: `交易日记 · ${packageJson.version}`, appid: local.appid ?? baseProject.appid, cloudfunctionRoot: 'cloudfunctions/' };
await writeFile(join(out, 'project.config.json'), JSON.stringify(project, null, 2));
const publicConfig = { cloudEnvId: transport === 'cloud' || local.marketFunctionName ? local.cloudEnvId : '', aiFunctionName: transport === 'cloud' ? local.aiFunctionName : '', marketFunctionName: local.marketFunctionName || '', aiTransport: transport, profile, version: packageJson.version };
await writeFile(join(out, 'miniprogram/config.js'), `module.exports = ${JSON.stringify(publicConfig)};\n`);
const entry = profile === 'development' ? join(root, 'src/runtime-dev.ts') : join(root, 'src/runtime.ts');
// Mobile ledgers only admit Asia/Shanghai; US market timestamps use New York.
// Keep the upstream transition tables (including DST), omit unrelated zones.
const mobileTimezones = { name: 'mobile-timezones', setup(builder) {
  builder.onLoad({ filter: /intl-datetimeformat[\/]add-golden-tz\.js$/ }, async ({ path }) => {
    let data;
    runInNewContext(await readFile(path, 'utf8'), { Intl: { DateTimeFormat: { __addTZData(value) { data = value; } } } });
    data.zones = data.zones.filter(zone => /^(Asia\/Shanghai|America\/New_York|Etc\/UTC|UTC)\|/.test(zone));
    if (data.zones.length < 2) throw Error('missing_mobile_timezone_data');
    return { contents: `Intl.DateTimeFormat.__addTZData(${JSON.stringify(data)});`, loader: 'js' };
  });
} };
const result = await build({ plugins: [mobileTimezones], entryPoints: [entry], outfile: join(out, 'miniprogram/lib/core.js'), bundle: true, format: 'cjs', platform: 'browser', target: 'es2018', minify: true, legalComments: 'eof', metafile: true, banner: { js: 'if(typeof globalThis.Intl === "undefined") globalThis.Intl = {};' } });
for (const output of Object.values(result.metafile.outputs)) if (output.imports.length) throw Error(`unbundled_runtime_dependency: ${JSON.stringify(output.imports)}`);
const app = JSON.parse(await readFile(join(out, 'miniprogram/app.json'), 'utf8'));
for (const page of app.pages) for (const extension of ['js', 'json', 'wxml', 'wxss']) await stat(join(out, 'miniprogram', `${page}.${extension}`));
await componentGraph(join(out, 'miniprogram'));
for (const tab of app.tabBar.list) if (!app.pages.includes(tab.pagePath)) throw Error(`missing_tab_page: ${tab.pagePath}`);
async function size(path) { let bytes = 0; for (const item of await readdir(path, { withFileTypes: true })) bytes += item.isDirectory() ? await size(join(path, item.name)) : (await stat(join(path, item.name))).size; return bytes; }
async function treeDigest(path) {
  const files = [];
  async function visit(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const child = join(current, item.name);
      if (item.isDirectory()) await visit(child); else files.push(child);
    }
  }
  await visit(path);
  files.sort((left, right) => relative(path, left).localeCompare(relative(path, right)));
  const digest = createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    const body = await readFile(file);
    const name = relative(path, file).replaceAll('\\', '/');
    bytes += body.length;
    digest.update(`${name}\0${body.length}\0`);
    digest.update(body);
    digest.update('\0');
  }
  return { sha256: digest.digest('hex'), bytes, files: files.length };
}
const bytes = await size(join(out, 'miniprogram'));
if (bytes > 2 * 1024 * 1024) throw Error(`main_package_over_2MiB: ${bytes}`);
const commit = (await promisify(execFile)('git', ['rev-parse', 'HEAD'], { cwd: repoRoot })).stdout.trim();
const workingTreeDirty = (await promisify(execFile)('git', ['status', '--porcelain'], { cwd: repoRoot })).stdout.trim().length > 0;
const gatewayRoot = join(repoRoot, 'apps/ai-gateway');
await promisify(execFile)('npm', ['run', 'build', '-w', '@portfolio/ai-gateway'], { cwd: repoRoot });
await rm(join(out, 'cloudfunctions'), { recursive: true, force: true });
await cp(join(gatewayRoot, 'cloud'), join(out, 'cloudfunctions'), { recursive: true });
await cp(join(gatewayRoot, 'dist/gateway.cjs'), join(out, 'cloudfunctions/portfolioAi/gateway.cjs'));
await cp(join(gatewayRoot, 'dist/gateway.cjs'), join(out, 'cloudfunctions/portfolioAiCleanup/gateway.cjs'));
await cp(join(gatewayRoot, 'dist/market.cjs'), join(out, 'cloudfunctions/portfolioMarket/market.cjs'));
const cloudFunctionNames = (await readdir(join(out, 'cloudfunctions'), { withFileTypes: true })).filter(item => item.isDirectory()).map(item => item.name).sort();
const cloudFunctions = Object.fromEntries(await Promise.all(cloudFunctionNames.map(async name => [name, await treeDigest(join(out, 'cloudfunctions', name))])));
const subpackages = await Promise.all((app.subPackages ?? app.subpackages ?? []).map(async item => ({ root: item.root, bytes: await size(join(out, 'miniprogram', item.root)) })));
const manifest = { schemaVersion: 2, version: packageJson.version, commit, workingTreeDirty, profile, features: { aiTransport: transport, marketTransport: local.marketFunctionName ? 'cloud' : 'disabled', marketCloudSkeletonIncluded: true, marketProviderConfigured: false, fakeProviderIncluded: profile === 'development', demoFixtureIncluded: profile === 'development' }, mainPackageBytes: bytes, pageCount: app.pages.length, subpackages, cloudFunctions, runtimeInputs: Object.keys(result.metafile.inputs).map(path => relative(repoRoot, resolve(path))).sort() };
await writeFile(join(out, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(out, 'README.txt'), `交易日记 · 微信小程序 ${packageJson.version}\n\nprofile：${profile}\ntransport：${transport}\ncloudfunctions 与 miniprogram 同级，不进入小程序主包。\n${transport === 'cloud' ? '客户端不包含模型密钥。' : 'AI 服务已关闭；本地记账、阅读历史和备份仍可用。'}\n`);
console.log(`WeChat project built: ${out}\nMain package: ${(bytes / 1024).toFixed(1)} KiB; ${app.pages.length} pages; profile=${profile}; transport=${transport}; appid=${project.appid}; cloud functions excluded.`);
