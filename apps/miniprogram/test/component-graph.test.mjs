import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { componentGraph } from '../scripts/component-graph.mjs';

test('packaged page-local chart and global quote component are complete', async () => {
  const graph = await componentGraph(fileURLToPath(new URL('../dist/miniprogram', import.meta.url)));
  assert.ok(graph.includes('components/market-chart/index'));
  assert.ok(graph.includes('components/quote-card/index'));
});
test('nested relative dependencies are included and missing packaged files fail validation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'weapp-components-'));
  const put = async (path, text) => { await mkdir(dirname(join(root, path)), {recursive:true}); await writeFile(join(root,path),text); };
  try {
    await put('app.json', JSON.stringify({pages:['pages/detail/index']}));
    await put('pages/detail/index.json', JSON.stringify({usingComponents:{chart:'/components/chart/index'}}));
    for (const name of ['chart','axis']) {
      await put(`components/${name}/index.json`,JSON.stringify({component:true,usingComponents:name==='chart'?{axis:'../axis/index'}:{}}));
      for (const ext of ['js','wxml','wxss']) await put(`components/${name}/index.${ext}`,'');
    }
    assert.deepEqual(await componentGraph(root),['components/chart/index','components/axis/index']);
    await rm(join(root,'components/axis/index.wxml'));
    await assert.rejects(componentGraph(root),/missing_component:components\/chart\/index:components\/axis\/index.wxml/);
  } finally { await rm(root,{recursive:true,force:true}); }
});
