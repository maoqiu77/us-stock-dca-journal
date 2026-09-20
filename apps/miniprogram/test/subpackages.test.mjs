import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../dist/miniprogram/', import.meta.url));
test('subpackage routes and shared JS imports resolve while all tabs stay in the main package', () => {
  const app = JSON.parse(readFileSync(resolve(root, 'app.json'), 'utf8'));
  assert.equal(app.pages.length, 3);
  assert.equal(app.subPackages.length, 1);
  assert.equal(app.subPackages[0].pages.length, 11);
  const routes = [...app.pages, ...app.subPackages.flatMap(pkg => pkg.pages.map(page => `${pkg.root}/${page}`))];
  const tabs = new Set(app.tabBar.list.map(item => item.pagePath));
  for (const route of tabs) assert.ok(app.pages.includes(route));
  for (const route of routes) {
    for (const ext of ['js', 'json', 'wxml', 'wxss']) assert.ok(existsSync(resolve(root, `${route}.${ext}`)), `${route}.${ext}`);
    const file = resolve(root, `${route}.js`), js = readFileSync(file, 'utf8');
    for (const match of js.matchAll(/require\(["'](\.[^"']+)["']\)/g)) assert.ok(existsSync(resolve(dirname(file), `${match[1]}.js`)), `${route}:${match[1]}`);
    for (const match of js.matchAll(/wx\.(navigateTo|redirectTo|switchTab)\(\{url:["'`]\/([^?"'`$]+)(?:\?|["'`])/g)) {
      assert.ok(routes.includes(match[2]), `undeclared route ${match[2]}`);
      assert.equal(tabs.has(match[2]), match[1] === 'switchTab', `wrong navigation API ${match[2]}`);
    }
  }
  assert.ok(existsSync(resolve(root, 'lib/core.js')));
  assert.ok(!existsSync(resolve(root, 'features/lib/core.js')), 'shared core must not be duplicated');
});
