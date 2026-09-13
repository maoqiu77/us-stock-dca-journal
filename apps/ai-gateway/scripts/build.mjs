import { build } from 'esbuild';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist'); await rm(out, { recursive: true, force: true }); await mkdir(out, { recursive: true });
await build({ entryPoints: [join(root, 'src/index.ts')], outfile: join(out, 'gateway.cjs'), bundle: true, platform: 'node', format: 'cjs', target: 'node18', minify: true, legalComments: 'none' });
await writeFile(join(out, 'package.json'), JSON.stringify({ name: 'portfolio-ai-gateway-bundle', version: '0.1.0', private: true, main: 'gateway.cjs' }, null, 2));
console.log(`AI gateway bundle built: ${join(out, 'gateway.cjs')}`);
