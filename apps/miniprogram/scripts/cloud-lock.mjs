import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export async function checkCloudLock(directory) {
  const pkg = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
  const root = lock.packages?.[''];
  if (lock.lockfileVersion !== 3 || !root || root.name !== pkg.name || root.version !== pkg.version)
    throw Error('cloud_lock_identity_mismatch');
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    if (!isDeepStrictEqual(root[field] ?? {}, pkg[field] ?? {})) throw Error(`cloud_lock_manifest_mismatch:${field}`);
  }
  for (const [name, entry] of Object.entries(lock.packages)) {
    if (!name) continue;
    if (entry.link || !entry.version || !entry.integrity || !entry.resolved?.startsWith('https://registry.npmjs.org/'))
      throw Error(`cloud_dependency_not_locked:${name}`);
  }
}
