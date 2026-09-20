import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const dist = new URL('../dist/', import.meta.url);

function hashTree(root) {
  const rootPath = fileURLToPath(root);
  const files = [];
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else files.push(child);
    }
  }
  visit(rootPath);
  files.sort((left, right) => relative(rootPath, left).localeCompare(relative(rootPath, right)));
  const digest = createHash('sha256');
  let bytes = 0;
  for (const file of files) {
    const body = readFileSync(file);
    const name = relative(rootPath, file).replaceAll('\\', '/');
    bytes += body.length;
    digest.update(`${name}\0${body.length}\0`);
    digest.update(body);
    digest.update('\0');
  }
  return { sha256: digest.digest('hex'), bytes, files: files.length };
}

test('release manifest binds the exact client structure and every cloud function tree', () => {
  const manifest = JSON.parse(readFileSync(new URL('release-manifest.json', dist), 'utf8'));
  const app = JSON.parse(readFileSync(new URL('miniprogram/app.json', dist), 'utf8'));
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.pageCount, app.pages.length + app.subPackages.reduce((n, pkg) => n + pkg.pages.length, 0));
  assert.deepEqual(manifest.subpackages.map(pkg => pkg.root), ['features']);
  for (const pkg of manifest.subpackages) assert.equal(pkg.bytes, hashTree(new URL(`miniprogram/${pkg.root}/`, dist)).bytes);
  assert.equal(manifest.mainPackageBytes, hashTree(new URL('miniprogram/', dist)).bytes - manifest.subpackages.reduce((n, pkg) => n + pkg.bytes, 0));
  assert.deepEqual(Object.keys(manifest.cloudFunctions).sort(), ['portfolioAi', 'portfolioAiCleanup', 'portfolioMarket']);
  for (const [name, expected] of Object.entries(manifest.cloudFunctions)) {
    assert.deepEqual(hashTree(new URL(`cloudfunctions/${name}/`, dist)), expected);
  }
});
