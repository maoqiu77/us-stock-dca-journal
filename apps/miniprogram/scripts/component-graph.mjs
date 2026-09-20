import { readFile, stat } from 'node:fs/promises';
import { posix, join } from 'node:path';

// Follow app, page and nested component declarations, rather than a manual allowlist.
export async function componentGraph(root) {
  const app = JSON.parse(await readFile(join(root, 'app.json'), 'utf8'));
  const pages = [...app.pages, ...(app.subPackages ?? app.subpackages ?? []).flatMap(pkg => pkg.pages.map(page => `${pkg.root}/${page}`))];
  const queue = ['app', ...pages], visited = new Set(), components = new Set();
  for (let i = 0; i < queue.length; i++) {
    const owner = queue[i];
    if (visited.has(owner)) continue;
    visited.add(owner);
    const config = JSON.parse(await readFile(join(root, `${owner}.json`), 'utf8'));
    for (const ref of Object.values(config.usingComponents ?? {})) {
      if (typeof ref !== 'string' || !ref || ref.includes('://')) throw Error(`unsupported_component:${owner}:${ref}`);
      const target = posix.normalize(ref.startsWith('/') ? ref.slice(1) : posix.join(posix.dirname(owner), ref));
      if (target === '..' || target.startsWith('../') || target.includes('\\')) throw Error(`invalid_component:${owner}:${ref}`);
      if (components.has(target)) continue;
      for (const ext of ['js', 'json', 'wxml', 'wxss']) {
        try { if (!(await stat(join(root, `${target}.${ext}`))).isFile()) throw Error('not_file'); }
        catch { throw Error(`missing_component:${owner}:${target}.${ext}`); }
      }
      const definition = JSON.parse(await readFile(join(root, `${target}.json`), 'utf8'));
      if (definition.component !== true) throw Error(`invalid_component_definition:${target}`);
      components.add(target); queue.push(target);
    }
  }
  return [...components];
}
