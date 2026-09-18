import { createHash } from 'node:crypto';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist');
const manifest = JSON.parse(await readFile(join(dist, 'release-manifest.json'), 'utf8'));
if (manifest.schemaVersion !== 2) throw Error('release_manifest_v2_required');
if (manifest.profile !== 'production') throw Error('production_profile_required');
if (!['cloud', 'disabled'].includes(manifest.features.aiTransport)) throw Error('invalid_production_transport');
if (manifest.features.fakeProviderIncluded || manifest.features.demoFixtureIncluded) throw Error('production_fixture_enabled');
if (!manifest.features.marketCloudSkeletonIncluded || manifest.features.marketProviderConfigured) throw Error('invalid_market_manifest');
async function treeDigest(path) {
  const paths = [];
  async function visit(current) {
    for (const item of await readdir(current, { withFileTypes: true })) {
      const child = join(current, item.name);
      if (item.isDirectory()) await visit(child); else paths.push(child);
    }
  }
  await visit(path);
  paths.sort((left, right) => relative(path, left).localeCompare(relative(path, right)));
  const digest = createHash('sha256');
  let bytes = 0;
  for (const file of paths) {
    const body = await readFile(file);
    const name = relative(path, file).replaceAll('\\', '/');
    bytes += body.length;
    digest.update(`${name}\0${body.length}\0`);
    digest.update(body);
    digest.update('\0');
  }
  return { sha256: digest.digest('hex'), bytes, files: paths.length };
}
const actualMain = await treeDigest(join(dist, 'miniprogram'));
if (actualMain.bytes !== manifest.mainPackageBytes || actualMain.bytes > 2 * 1024 * 1024) throw Error('main_package_size_mismatch');
const expectedCloudNames = ['portfolioAi', 'portfolioAiCleanup', 'portfolioMarket'];
if (JSON.stringify(Object.keys(manifest.cloudFunctions).sort()) !== JSON.stringify(expectedCloudNames)) throw Error('cloud_function_manifest_incomplete');
for (const name of expectedCloudNames) {
  const actual = await treeDigest(join(dist, 'cloudfunctions', name));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.cloudFunctions[name])) throw Error(`cloud_function_hash_mismatch:${name}`);
}
const marketBundle = await readFile(join(dist, 'cloudfunctions/portfolioMarket/market.cjs'), 'utf8');
if (/fixture_price|server-secret|apikey=[A-Za-z0-9_-]{8,}/i.test(marketBundle)) throw Error('market_bundle_contains_secret_or_fixture');
const clientBundle = await readFile(join(dist, 'miniprogram/lib/core.js'), 'utf8');
if (/TWELVE_DATA_API_KEY|DEEPSEEK_API_KEY|api\.deepseek\.com|api\.twelvedata\.com/i.test(clientBundle)) throw Error('client_bundle_crosses_secret_boundary');
for (const input of manifest.runtimeInputs) if (input.endsWith('src/ai/fake-provider.ts') || input.endsWith('src/dev-fixtures.ts')) throw Error(`production_dependency_forbidden: ${input}`);
const app = JSON.parse(await readFile(join(dist, 'miniprogram/app.json'), 'utf8'));
if (manifest.pageCount !== app.pages.length) throw Error('page_count_mismatch');
const packageRoots = (app.subPackages ?? app.subpackages ?? []).map(item => item.root);
if (JSON.stringify(manifest.subpackages.map(item => item.root)) !== JSON.stringify(packageRoots)) throw Error('subpackage_manifest_mismatch');
for (const route of app.pages) {
  const base = join(dist, 'miniprogram', route); for (const extension of ['js', 'json', 'wxml', 'wxss']) await stat(`${base}.${extension}`);
  const source = await readFile(`${base}.js`, 'utf8'), template = await readFile(`${base}.wxml`, 'utf8');
  const handlers = new Set([...source.matchAll(/^\s{2}(?:async\s+)?([A-Za-z]\w*)\s*\(/gm)].map(match => match[1]));
  for (const match of template.matchAll(/(?:bind|catch)(?::)?\w+="([A-Za-z]\w*)"/g)) if (!handlers.has(match[1])) throw Error(`missing_page_handler: ${route}:${match[1]}`);
}
const overview = await readFile(join(dist, 'miniprogram/pages/overview/index.wxml'), 'utf8');
const research = await readFile(join(dist, 'miniprogram/pages/research/index.wxml'), 'utf8');
if (overview.includes('体验示例') || research.includes('运行离线演示') || research.includes('筛选候选标的')) throw Error('production_demo_entry_found');
console.log(`WeChat production check passed: ${manifest.version}, ${manifest.features.aiTransport}, ${manifest.mainPackageBytes} bytes.`);
