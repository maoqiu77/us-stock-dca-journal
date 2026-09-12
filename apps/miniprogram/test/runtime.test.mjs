import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
const root = new URL('../dist/miniprogram/', import.meta.url);
function boot(values = new Map()) {
  let failReadback = false, unreadable = false, failPrimaryBefore = false, cleanupFault = false, cleanupRead = false, manifestFault = false, failManifestOnWrite = false;
  const notices = []; const routes = []; let navigated = false; let fail = false; let evalAttempts = 0;
  const wx = {
    getStorageSync: key => { if (key === 'portfolio.wechat.v1.pending-v1' && manifestFault) throw Error('manifest unavailable'); if (key === 'portfolio.wechat.v1.pending-v1' && cleanupRead) { cleanupRead = false; throw Error('cleanup readback'); } if (key === 'portfolio.wechat.v1' && unreadable) throw Error('readback'); return values.get(key) ?? ''; },
    setStorageSync: (key, value) => { if (fail || (failPrimaryBefore && key === 'portfolio.wechat.v1')) throw Error('quota'); values.set(key, value); if (failManifestOnWrite && key === 'portfolio.wechat.v1.pending-v1' && value) manifestFault = true; if (cleanupFault && key === 'portfolio.wechat.v1.pending-v1' && !value) cleanupRead = true; if (key === 'portfolio.wechat.v1' && failReadback) unreadable = true; },
    showToast: options => notices.push(options),
    showModal: options => { notices.push(options); if (options.success) options.success({ confirm: true }); },
    navigateBack: () => { navigated = true; }, navigateTo: options => { routes.push(options.url); },
  };
  const context = vm.createContext({ module: { exports: {} }, wx, Intl: undefined, console, Function: function() { evalAttempts++; throw Error('dynamic code disabled'); } }, { codeGeneration: { strings: false, wasm: false } });
  vm.runInContext(readFileSync(new URL('lib/core.js', root), 'utf8'), context);
  const core = context.module.exports;
  return { manifestFault: () => { failManifestOnWrite = true; }, cleanupFault: () => { cleanupFault = true; }, failPrimaryBefore: () => { failPrimaryBefore = true; }, readbackFault: () => { failReadback = true; }, restoreReads: () => { failReadback = false; unreadable = false; failPrimaryBefore = false; manifestFault = false; failManifestOnWrite = false; }, core, values, notices, routes, context, evalAttempts: () => evalAttempts, failWrites: () => { fail = true; }, navigated: () => navigated,
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
test('all five tab controllers initialize and review creates an independent timeline note', () => {
  const env = boot();
  for (const name of ['overview', 'records', 'research', 'settings']) { const page = env.page(name); page.onShow(); assert.equal(page.data.error, ''); }
  const review = env.page('review'); review.onShow(); review.onText({ detail: { value: '今日坚持计划' } }); review.save();
  const reopened = boot(env.values).core.service;
  assert.equal(reopened.journal().timeline(env.core.today())[0].body, '今日坚持计划');
  assert.equal(reopened.snapshot().reviews.length, 0);
});

test('packaged fake research archives and conversation follows up in the same engine', () => {
  const env = boot(); env.core.service.loadDemo();
  const research = env.page('research'); research.onLoad(); research.onShow(); research.setData({ question: '分析我的持仓' }); research.preview(); research.runDemo();
  assert.match(research.data.result.summary, /离线合成演示/);
  assert.ok(env.routes.at(-1).startsWith('/pages/conversation/index?id='));
  const id = research.data.conversationId, conversation = env.page('conversation'); conversation.onLoad({ id });
  conversation.onQuestion({ detail: { value: '还缺什么？' } }); conversation.send();
  assert.equal(env.core.service.ai().conversation(id).messages.length, 4);
  assert.equal(env.core.service.snapshot().events.length, 2);
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
  assert.equal(review.data.text, ''); assert.equal(review.data.timeline.find(item => item.kind === 'personal_note').body, '备份中的笔记'); assert.equal(review.data.dirty, false);
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

for (const name of ['entry', 'opening']) test(`packaged ${name} keeps unknown submission across repreview, verification and restart`, () => {
  const env = boot(), page = env.page(name); page.onLoad();
  page.setData({ symbol: 'QQQ', quantity: '2', price: '10', fee: '1', totalCost: '21' }); page.preview(); env.readbackFault(); page.submit();
  assert.equal(page.data.pendingSave, true); assert.equal(env.navigated(), false);
  page.preview(); page.submit(); page.verifySave(); assert.equal(page.data.pendingSave, true);
  env.restoreReads(); const reopened = boot(env.values), resumed = reopened.page(name); resumed.onLoad();
  assert.equal(resumed.data.pendingSave, true); resumed.verifySave(); resumed.submit();
  assert.equal(reopened.core.service.records().length, 1); assert.equal(reopened.core.service.overview().totalCost, '21.00');
});

for (const name of ['entry', 'opening']) test(`packaged ${name} offers explicit safe retry without changing the staged identity`, () => {
  const env = boot(), page = env.page(name); page.onLoad();
  page.setData({ symbol: 'QQQ', quantity: '2', price: '10', fee: '1', totalCost: '21' }); page.preview(); env.failPrimaryBefore(); page.submit();
  assert.equal(page.data.quantity, '2'); assert.equal(page.data.pendingSave, true);
  const staged = JSON.parse(env.values.get('portfolio.wechat.v1.pending-v1.next')).events[0].revision_id;
  env.restoreReads(); page.verifySave(); assert.equal(page.data.retryable, true); assert.equal(env.core.service.records().length, 0);
  page.retrySave(); page.submit(); page.retrySave();
  assert.equal(env.core.service.records().length, 1); assert.equal(env.core.service.records()[0].revisionId, staged);
});
test('packaged settings verifies unknown replacement without replacing its original recovery point', () => {
  const env = boot(); env.core.service.saveReview(env.core.today(), '恢复前合成复盘');
  const before = env.values.get('portfolio.wechat.v1');
  const settings = env.page('settings'); settings.onShow(); env.readbackFault(); settings.startEmpty();
  assert.equal(settings.data.pendingSave, true); settings.startEmpty(); env.restoreReads(); settings.verifySave();
  assert.equal(settings.data.pendingSave, false); assert.equal(env.core.service.snapshot().reviews.length, 0);
  assert.equal(env.values.get('portfolio.wechat.v1.previous'), before);
});
test('packaged entry correction reconciles the exact revision after readback failure', () => {
  const env = boot(), service = env.core.service;
  service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: env.core.today(), quantity: '2', price: '10', fee: '1' });
  const record = service.records()[0], page = env.page('entry'); page.onLoad({ recordId: record.id }); page.setData({ price: '12' }); page.preview(); env.readbackFault(); page.submit();
  env.restoreReads(); page.verifySave(); page.submit();
  assert.equal(service.records().length, 1); assert.equal(service.revisionHistory(record.id).length, 2); assert.equal(service.overview().totalCost, '25.00');
});

for (const name of ['entry', 'opening']) test(`packaged ${name} cannot repreview an operation verified from another page`, () => {
  const env = boot(), page = env.page(name); page.onLoad();
  page.setData({ symbol: 'QQQ', quantity: '2', price: '10', fee: '1', totalCost: '21' }); page.preview(); env.readbackFault(); page.submit();
  env.restoreReads(); assert.equal(env.core.service.verifyPending(), 'confirmed');
  page.onShow(); page.preview(); page.submit();
  assert.equal(env.core.service.records().length, 1); assert.equal(env.core.service.overview().totalCost, '21.00');
});

for (const name of ['entry', 'opening']) test(`packaged ${name} retains successful-save lock after cleanup readback failure`, () => {
  const env = boot(), page = env.page(name); page.onLoad();
  page.setData({ symbol: 'QQQ', quantity: '2', price: '10', fee: '1', totalCost: '21' }); page.preview(); env.cleanupFault(); page.submit();
  assert.equal(env.navigated(), true); assert.equal(page.data.saving, true);
  page.onShow(); page.preview(); page.submit(); assert.equal(env.core.service.records().length, 1);
});
test('old entry cannot verify a different pending operation created after its own was resolved', () => {
  const env = boot(), page = env.page('entry'); page.onLoad();
  page.setData({ symbol: 'QQQ', quantity: '2', price: '10', fee: '1' }); page.preview(); env.readbackFault(); page.submit();
  env.restoreReads(); env.core.service.verifyPending(); env.readbackFault();
  assert.throws(() => env.core.service.saveTrade({ kind: 'buy', symbol: 'AAPL', assetType: 'STOCK', date: env.core.today(), quantity: '1', price: '12' })); env.restoreReads();
  page.onShow(); page.verifySave(); page.preview(); page.submit();
  assert.equal(env.core.service.pendingSave(), true); assert.equal(env.core.service.records().length, 2);
});

test('entry retains its own in-memory identity when manifest reads fail and another submission follows', () => {
  const env = boot(), page = env.page('entry'); page.onLoad();
  page.setData({ symbol: 'QQQ', quantity: '2', price: '10', fee: '1' }); page.preview(); env.manifestFault(); page.submit();
  assert.ok(page._pendingIdentity); assert.equal(page.data.pendingSave, true);
  env.restoreReads(); assert.equal(env.core.service.verifyPending(), 'retryable'); env.core.service.retryPending();
  env.readbackFault(); assert.throws(() => env.core.service.saveTrade({ kind: 'buy', symbol: 'AAPL', assetType: 'STOCK', date: env.core.today(), quantity: '1', price: '12' })); env.restoreReads();
  page.onShow(); page.verifySave(); page.retrySave();
  assert.equal(page.data.saving, true); assert.equal(env.core.service.pendingSave(), true); assert.equal(env.core.service.records().length, 2);
});
