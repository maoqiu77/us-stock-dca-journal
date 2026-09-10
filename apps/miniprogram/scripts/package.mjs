import { mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '../..');
const dist = join(app, 'dist');
const release = join(repo, 'dist/wechat');
await mkdir(release, { recursive: true });
await copyFile(join(repo, 'docs/miniprogram/README.md'), join(dist, '使用说明.md'));
await copyFile(join(repo, 'LICENSE'), join(dist, 'LICENSE'));
const archive = join(release, '交易日记-微信小程序-0.1.0-测试版.zip');
await rm(archive, { force: true });
// Explicit list excludes project.private.config.json and any user-added files.
execFileSync('zip', ['-q', '-r', archive, 'project.config.json', 'README.txt', '使用说明.md', 'LICENSE', 'miniprogram'], { cwd: dist });
const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${hash}  ${archive.split('/').pop()}\n`);
console.log(`Package: ${archive}\nSHA-256: ${hash}`);
