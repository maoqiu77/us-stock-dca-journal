import { cp, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { checkCloudLock } from './cloud-lock.mjs';

const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist');
const manifest = JSON.parse(await readFile(join(dist, 'release-manifest.json'), 'utf8'));
if (manifest.profile !== 'production') throw Error('production_profile_required');
const temporary = await mkdtemp(join(tmpdir(), 'portfolio-cloud-install-'));
// Install only public dependencies; never inherit service credentials into entry loading.
const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG', 'SystemRoot'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
try {
  for (const name of ['portfolioAi', 'portfolioAiCleanup', 'portfolioMarket']) {
    const source = join(dist, 'cloudfunctions', name), target = join(temporary, name);
    await checkCloudLock(source);
    await cp(source, target, { recursive: true });
    execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: target, env, stdio: 'inherit' });
    // Node 24 denies writes/subprocesses here, but does not restrict networking.
    // macOS additionally provides the network-denied sandbox used in our audit.
    const args = ['--permission', '--allow-fs-read=*', '-e', "const entry = require('./index.js'); if (typeof entry.main !== 'function') throw Error('missing_main');"];
    if (process.platform === 'darwin') {
      execFileSync('/usr/bin/sandbox-exec', ['-p', '(version 1)(allow default)(deny network*)', process.execPath, ...args], { cwd: target, env, stdio: 'inherit' });
    } else {
      execFileSync(process.execPath, args, { cwd: target, env, stdio: 'inherit' });
    }
    console.log(`${name}: locked clean install and entry loading passed (main not invoked; network sandbox: ${process.platform === 'darwin'}).`);
  }
} finally {
  await rm(temporary, { recursive: true, force: true });
}
