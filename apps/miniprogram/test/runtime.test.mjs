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
  env.failWrites(); entry.submit();
  assert.equal(env.navigated(), false); assert.equal(env.core.service.records().length, 0);
  assert.ok(env.notices.some(n => n.content?.includes('保存失败')));
  const good = boot(); const page = good.page('entry'); page.onLoad();
  page.setData({ symbol: 'QQQ', quantity: '2', price: '10' }); page.submit();
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
  for (const name of ['overview', 'records', 'entry', 'review', 'settings']) {
    const page = env.page(name); const template = readFileSync(new URL(`pages/${name}/index.wxml`, root), 'utf8');
    for (const match of template.matchAll(/(?:bind|catch)(?::)?\w+="([A-Za-z]\w*)"/g)) assert.equal(typeof page[match[1]], 'function', `${name}: missing ${match[1]}`);
  }
});
test('double tap during pending navigation cannot save the same trade twice', () => {
  const env = boot(); const entry = env.page('entry'); entry.onLoad();
  entry.setData({ symbol: 'QQQ', quantity: '2', price: '10' }); entry.submit(); entry.submit();
  assert.equal(env.core.service.records().length, 1);
});
test('restoring even the same portfolio invalidates dirty review drafts', () => {
  const env = boot(); env.core.service.saveReview(env.core.today(), '备份中的笔记');
  const backup = env.core.service.exportBackup(); const review = env.page('review'); review.onShow();
  review.onText({ detail: { value: '旧草稿' } }); env.core.service.restoreBackup(backup); review.onShow();
  assert.equal(review.data.text, '备份中的笔记'); assert.equal(review.data.dirty, false);
});
