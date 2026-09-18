import { access, mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repo = resolve(app, '../..');
const dist = join(app, 'dist');
const release = join(repo, 'dist/wechat');
const metadata = JSON.parse(await readFile(join(dist, 'release-manifest.json'), 'utf8'));
if (metadata.profile !== 'production') throw Error('只能打包已通过检查的 production 构建。');
await mkdir(release, { recursive: true });
await copyFile(join(repo, 'docs/miniprogram/README.md'), join(dist, '使用说明.md'));
await copyFile(join(repo, 'LICENSE'), join(dist, 'LICENSE'));
const archive = join(release, `交易日记-微信小程序-${metadata.version}-production.zip`);
const rollbackArchive = join(release, `交易日记-微信小程序-${metadata.version}-round4-rollback.zip`);
try {
  await access(archive);
  try { await access(rollbackArchive); } catch {
    await copyFile(archive, rollbackArchive);
    const rollbackHash = createHash('sha256').update(await readFile(rollbackArchive)).digest('hex');
    await writeFile(`${rollbackArchive}.sha256`, `${rollbackHash}  ${rollbackArchive.split('/').pop()}\n`);
  }
} catch {}
await rm(archive, { force: true });
execFileSync('zip', ['-q', '-r', archive, 'project.config.json', 'release-manifest.json', 'README.txt', '使用说明.md', 'LICENSE', 'miniprogram'], { cwd: dist });
const hash = createHash('sha256').update(await readFile(archive)).digest('hex');
await writeFile(`${archive}.sha256`, `${hash}  ${archive.split('/').pop()}\n`);
const cloudArchive = join(release, `交易日记-微信云函数-${metadata.version}-production.zip`);
await rm(cloudArchive, { force: true });
execFileSync('zip', ['-q', '-r', cloudArchive, 'release-manifest.json', 'cloudfunctions'], { cwd: dist });
const cloudHash = createHash('sha256').update(await readFile(cloudArchive)).digest('hex');
await writeFile(`${cloudArchive}.sha256`, `${cloudHash}  ${cloudArchive.split('/').pop()}\n`);
let rollback = null;
try {
  const rollbackHash = createHash('sha256').update(await readFile(rollbackArchive)).digest('hex');
  rollback = { file: rollbackArchive.split('/').pop(), sha256: rollbackHash };
} catch {}
const manifestHash = createHash('sha256').update(await readFile(join(dist, 'release-manifest.json'))).digest('hex');
const candidate = {
  schemaVersion: 1,
  version: metadata.version,
  commit: metadata.commit,
  workingTreeDirty: metadata.workingTreeDirty,
  releaseManifestSha256: manifestHash,
  client: { file: archive.split('/').pop(), sha256: hash, mainPackageBytes: metadata.mainPackageBytes, pageCount: metadata.pageCount, subpackages: metadata.subpackages },
  cloud: { file: cloudArchive.split('/').pop(), sha256: cloudHash, functions: metadata.cloudFunctions },
  rollback,
  deploymentState: 'not_deployed',
  deviceAcceptance: 'pending'
};
await writeFile(join(release, 'release-candidate.json'), `${JSON.stringify(candidate, null, 2)}\n`);
console.log(`Client package: ${archive}\nSHA-256: ${hash}\nCloud package: ${cloudArchive}\nSHA-256: ${cloudHash}\nRelease candidate: ${join(release, 'release-candidate.json')}`);
