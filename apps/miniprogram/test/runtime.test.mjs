import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const root = new URL('../dist/miniprogram/', import.meta.url);
function boot(values = new Map()) {
  const notices = []; let navigated = false; let fail = false; let evalAttempts = 0;
  const wx = {
    getStorageSync: key => values.get(key) ?? '',
    setStorageSync: (key, value) => { if (fail) throw Error('quota'); values.set(key, value); },
    showToast: options => notices.push(options),
    showModal: options => { notices.push(options); if (options.success) options.success({ confirm: true }); },
    navigateBack: () => { navigated = true; }, navigateTo: () => {},
  };
  const context = vm.createContext({ module: { exports: {} }, wx, Intl: undefined, console, Function: function() { evalAttempts++; throw Error('dynamic code disabled'); } }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(readFileSync(new URL('lib/core.js', root), 'utf8'), context);
  const core = context.module.exports;
  return { core, values, notices, context, evalAttempts: () => evalAttempts, failWrites: () => { fail = true; }, navigated: () => navigated,
    page(name) {
      let page;
      context.require = path => { assert.equal(path, '../../lib/core'); return core; };
      context.Page = definition => { page = definition; page.setData = update => Object.assign(page.data, update); };
      vm.runInContext(`(function(){${readFileSync(new URL(`pages/${name}/index.js`, root), 'utf8')}\n})()`, context);
      return page;
    },
  };
}
test('actual packaged runtime works without Intl, DOM, Node or network and reopens saved holdings', () => {
  const env = boot(); const { service, today } = env.core;
  service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: today(), quantity: '2', price: '10', fee: '1', note: '' });
  assert.equal(boot(env.values).core.service.overview().positions[0].cost, '21.00');
});
test('entry controller saves user form and failed persistence keeps user on the form', () => {
  const env = boot(); const entry = env.page('entry'); entry.onLoad();
  entry.onField({ currentTarget: { dataset: { field: 'symbol' } }, detail: { value: 'QQQ' } });
  entry.onField({ currentTarget: { dataset: { field: 'quantity' } }, detail: { value: '2' } });
  entry.onField({ currentTarget: { dataset: { field: 'price' } }, detail: { value: '10' } });
  entry.preview(); env.failWrites(); entry.submit();
  assert.equal(env.navigated(), false); assert.equal(env.core.service.records().length, 0);
  assert.ok(env.notices.some(n => n.content?.includes('保存失败')));
  const good = boot(); const page = good.page('entry'); page.onLoad();
  page.setData({ symbol: 'QQQ', quantity: '2', price: '10' }); page.preview(); page.submit();
  assert.equal(good.navigated(), true); assert.equal(good.core.service.records().length, 1);
});
test('all four tab controllers initialize from an empty store and review edits persist', () => {
  const env = boot();
  for (const name of ['overview', 'records', 'settings']) { const page = env.page(name); page.onShow(); assert.equal(page.data.error, ''); }
  const review = env.page('review'); review.onShow(); review.onText({ detail: { value: '今日坚持计划' } }); review.save();
  assert.equal(boot(env.values).core.service.snapshot().reviews[0].text, '今日坚持计划');
});

test('packaged validation never attempts dynamically generated code in the restricted host', () => {
  const env = boot(); env.core.service.loadDemo(); assert.equal(env.evalAttempts(), 0);
});
test('every WXML event binding resolves to an implemented page handler', () => {
  const env = boot();
  for (const route of JSON.parse(readFileSync(new URL('app.json', root), 'utf8')).pages) {
    const name = route.split('/')[1];
    const page = env.page(name); const template = readFileSync(new URL(`pages/${name}/index.wxml`, root), 'utf8');
    for (const match of template.matchAll(/(?:bind|catch)(?::)?\w+="([A-Za-z]\w*)"/g)) assert.equal(typeof page[match[1]], 'function', `${name}: missing ${match[1]}`);
  }
});
test('double tap during pending navigation cannot save the same trade twice', () => {
  const env = boot(); const entry = env.page('entry'); entry.onLoad();
  entry.setData({ symbol: 'QQQ', quantity: '2', price: '10' }); entry.preview(); entry.submit(); entry.submit();
  assert.equal(env.core.service.records().length, 1);
});
test('restoring even the same portfolio invalidates dirty review drafts', () => {
  const env = boot(); env.core.service.saveReview(env.core.today(), '备份中的笔记');
  const backup = env.core.service.exportBackup(); const review = env.page('review'); review.onShow();
  review.onText({ detail: { value: '旧草稿' } }); env.core.service.restoreBackup(backup); review.onShow();
  assert.equal(review.data.text, '备份中的笔记'); assert.equal(review.data.dirty, false);
});

test('packaged opening and trade pages complete the hand-calculated flow with exact input precision', () => {
  const env = boot(), date = env.core.today();
  const opening = env.page('opening'); opening.onLoad();
  opening.setData({ date, symbol: 'AAPL', assetType: 'STOCK', quantity: '10', totalCost: '1000.0001' }); opening.preview(); opening.submit();
  const id = env.core.service.records()[0].id;
  const edit = env.page('opening'); edit.onLoad({ recordId: id });
  assert.equal(edit.data.totalCost, '1000.0001'); edit.onField({ currentTarget: { dataset: { field: 'note' } }, detail: { value: '只更正备注' } }); edit.preview(); edit.submit();
  assert.equal(env.core.service.records()[0].totalCost, '1000.0001');
  const entry = env.page('entry'); entry.onLoad({ symbol: 'AAPL', kind: 'sell' });
  assert.equal(entry.data.assetType, 'STOCK'); assert.equal(entry.data.availableQuantity, '10');
  entry.setData({ quantity: '3', price: '130', fee: '1' }); entry.preview(); entry.submit();
  assert.equal(env.core.service.overview().positions[0].quantity, '7');
  assert.equal(env.core.service.overview().realized, '89.00');
});

test('packaged clock anomaly pages label their saved-fact time and keep normal backup available', () => {
  const env = boot(), date = env.core.today();
  env.core.service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date, quantity: '2', price: '10', fee: '1', note: '' });
  const key = 'portfolio.wechat.v1', saved = JSON.parse(env.values.get(key));
  const observed = new Date(Date.now() + 24 * 3600000).toISOString();
  saved.events[0].recorded_at = observed; saved.events[0].provenance.confirmed_at = observed;
  env.values.set(key, JSON.stringify(saved));
  const overview = env.page('overview'); overview.onShow();
  assert.equal(overview.data.clockAnomaly.asOf, observed); assert.equal(overview.data.view, null);
  const settings = env.page('settings'); settings.onShow();
  assert.equal(settings.data.clockAnomaly.asOf, observed); assert.equal(settings.data.canExportRaw, false);
  assert.ok(env.core.service.exportBackup().includes(observed));
  const detail = env.page('position-detail'); detail.onLoad({ symbol: 'QQQ' });
  assert.equal(detail.data.detail.knownAt, observed); assert.equal(detail.data.detail.clockAnomaly, true);
});
