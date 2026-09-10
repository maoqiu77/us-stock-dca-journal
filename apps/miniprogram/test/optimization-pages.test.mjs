import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = new URL('../miniprogram/', import.meta.url);

function boot(service, options = {}) {
  const calls = { navigate: [], back: 0, notices: [], clipboard: [] };
  const wx = {
    navigateTo: value => calls.navigate.push(value.url),
    navigateBack: () => { calls.back += 1; },
    showToast: value => calls.notices.push(value),
    showModal: value => { calls.notices.push(value); value.success?.({ confirm: true }); },
    setClipboardData: value => { calls.clipboard.push(value.data); value.success?.(); },
    getFileSystemManager: () => ({ writeFile: value => value.success?.() }),
    shareFileMessage: () => {}, env: { USER_DATA_PATH: '/tmp' },
  };
  const context = vm.createContext({ module: { exports: {} }, console, wx, require: () => ({ service, today: () => '2026-09-10', showError: e => calls.notices.push({ content: e.message }) }), Page: definition => { context.page = definition; definition.setData = update => Object.assign(definition.data, update); } });
  return { calls, page(name) { vm.runInContext(`(function(){${readFileSync(new URL(`pages/${name}/index.js`, source), 'utf8')}\n})()`, context); return context.page; }, options };
}

test('overview exposes first-use choices and never renders fake totals during a clock anomaly', () => {
  const service = { firstUse: () => ({ isEmpty: true, openingDate: null, hasOpeningPositions: false }), overview: () => ({ clockAnomaly: true, knownAt: '2026-09-09T23:59:59+08:00', throughDate: '2026-09-09', positions: [], tradeCount: 0 }) };
  const env = boot(service); const page = env.page('overview'); page.onShow();
  assert.equal(page.data.clockAnomaly.asOf, '2026-09-09T23:59:59+08:00');
  assert.equal(page.data.view, null);
  page.startWithOpening(); page.startWithTrade();
  assert.deepEqual(env.calls.navigate, ['/pages/opening/index', '/pages/entry/index']);
});

test('entry autofills existing type, previews selected same-day order, and commits the exact preview token', () => {
  const seen = [];
  const service = {
    records: () => [{ id: 'old', revisionId: 'rev-2', kind: 'buy', symbol: 'AAPL', assetType: 'STOCK', date: '2026-09-09', sequence: 1, quantity: '2', price: '100', fee: '1', note: '' }, { id: 'a', date: '2026-09-09', sequence: 0 }, { id: 'b', date: '2026-09-09', sequence: 2 }],
    availableQuantity: input => { seen.push(['available', input]); return '7'; },
    previewTrade: input => { seen.push(['preview', input]); return { amount: '250.00', fee: '1.00', net: '-251.00', availableQuantity: '7', before: { quantity: '2', cost: '201.00', realized: '0.00' }, after: { quantity: '4', cost: '452.00', realized: '0.00' }, deltas: { quantity: '2', cost: '251.00', realized: '0.00' }, order: { date: input.date, position: input.position, maxPosition: 2 }, contentToken: 'token-1' }; },
    saveTrade: input => seen.push(['save', input]),
  };
  const env = boot(service); const page = env.page('entry'); page.onLoad({ recordId: 'old' });
  assert.equal(page.data.assetType, 'STOCK'); assert.equal(page.data.expectedRevision, 'rev-2');
  page.onOrder({ detail: { value: '2' } }); page.preview(); page.submit();
  assert.equal(seen.at(-1)[1].contentToken, 'token-1'); assert.equal(seen.at(-1)[1].expectedRevision, 'rev-2'); assert.equal(seen.at(-1)[1].position, 2); assert.equal(page.data.preview.contentToken, undefined);
});

test('editing any field invalidates a preview and stale previews cannot be submitted', () => {
  const service = { records: () => [], availableQuantity: () => '0', previewTrade: () => ({ contentToken: 'token' }), saveTrade: () => assert.fail('must not save stale preview') };
  const env = boot(service); const page = env.page('entry'); page.onLoad({}); page.setData({ symbol: 'QQQ', quantity: '1', price: '10' }); page.preview();
  page.onField({ currentTarget: { dataset: { field: 'price' } }, detail: { value: '11' } }); page.submit();
  assert.equal(page.data.preview, null); assert.ok(env.calls.notices.some(value => value.content?.includes('预览')));
});

test('opening page uses a common date and confirmed total cost', () => {
  const seen = [];
  const service = { firstUse: () => ({ isEmpty: true, openingDate: null }), previewOpening: input => ({ amount: input.totalCost, fee: '0.00', net: input.totalCost, before: {}, after: {}, deltas: {}, order: {}, contentToken: 'opening-token' }), saveOpening: input => seen.push(input) };
  const env = boot(service); const page = env.page('opening'); page.onLoad(); page.setData({ date: '2026-09-01', symbol: 'QQQ', quantity: '10', totalCost: '1000' }); page.preview(); page.submit();
  assert.equal(seen[0].totalCost, '1000'); assert.equal(seen[0].date, '2026-09-01'); assert.equal(seen[0].contentToken, 'opening-token');
});

test('records link to edit, revision history, and symbol detail including closed positions', () => {
  const service = { snapshot: () => ({ mode: 'personal' }), records: () => [{ id: 'r1', revisionId: 'v2', symbol: 'QQQ', assetType: 'ETF', isOpening: false }] };
  const env = boot(service); const page = env.page('records'); page.onShow();
  page.editRecord({ currentTarget: { dataset: { id: 'r1' } } }); page.showHistory({ currentTarget: { dataset: { id: 'r1' } } }); page.showPosition({ currentTarget: { dataset: { symbol: 'QQQ' } } });
  assert.deepEqual(env.calls.navigate, ['/pages/entry/index?recordId=r1', '/pages/revision-detail/index?recordId=r1', '/pages/position-detail/index?symbol=QQQ']);
});

test('position detail offers a prefilled sell and revision detail exposes the full audit chain', () => {
  const service = { positionDetail: () => ({ symbol: 'AAPL', assetType: 'STOCK', quantity: '3', records: [] }), revisionHistory: () => [{ revisionId: 'v1' }, { revisionId: 'v2' }] };
  const env = boot(service); const detail = env.page('position-detail'); detail.onLoad({ symbol: 'AAPL' }); detail.sell();
  assert.match(env.calls.navigate[0], /kind=sell/); assert.match(env.calls.navigate[0], /assetType=STOCK/);
  const history = env.page('revision-detail'); history.onLoad({ recordId: 'r1' }); assert.equal(history.data.revisions.length, 2);
});

test('settings keeps raw corrupt export independent from normal backup', () => {
  const service = { snapshot: () => { throw Error('账本结构损坏'); }, exportRaw: () => '{broken', exportBackup: () => assert.fail('normal backup must not parse corrupt data') };
  const env = boot(service); const page = env.page('settings'); page.onShow(); page.copyRaw();
  assert.equal(page.data.canExportRaw, true); assert.equal(env.calls.clipboard[0], '{broken');
  assert.ok(env.calls.notices.some(value => value.content?.includes('不保证')));
});

test('all MP0/MP1 WXML bindings resolve to controller handlers', () => {
  const service = new Proxy({}, { get: () => () => ({}) }); const env = boot(service);
  const manifest = JSON.parse(readFileSync(new URL('app.json', source), 'utf8'));
  for (const route of manifest.pages) {
    const name = route.replace(/^pages\//, '').replace(/\/index$/, '');
    const page = env.page(name); const template = readFileSync(new URL(`pages/${name}/index.wxml`, source), 'utf8');
    for (const match of template.matchAll(/(?:bind|catch)(?::)?\w+="([A-Za-z]\w*)"/g)) assert.equal(typeof page[match[1]], 'function', `${name}: missing ${match[1]}`);
  }
});
