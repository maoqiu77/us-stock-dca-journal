import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

test('market-data package stays pure and independent of network and platform SDKs', () => {
  const directory = fileURLToPath(new URL('../src/', import.meta.url));
  const source = readdirSync(directory).filter(name => name.endsWith('.ts')).map(name => readFileSync(`${directory}/${name}`, 'utf8')).join('\n');
  assert.doesNotMatch(source, /\bfetch\s*\(|wx-server-sdk|wx\.cloud|process\.env|https?:\/\//);
});
