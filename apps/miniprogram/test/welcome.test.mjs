import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../miniprogram/app.js', import.meta.url), 'utf8');
function fixture() {
  const values = new Map(), modals = [], routes = [];
  let app, saves = 0, fail = false;
  const wx = {
    getStorageSync: key => values.get(key), setStorageSync: (key, value) => values.set(key, value),
    showModal: options => modals.push(options), showToast() {}, switchTab: options => routes.push(options.url),
  };
  const service = { journal: () => ({ ensureWelcomeNote() { if (fail) throw Error('storage unavailable'); saves++; return '2026-09-21'; }, read: () => ({ instance_id: 'workspace' }) }) };
  const launch = () => { vm.runInNewContext(source, { App: value => { app = value; app.subscribeWelcome(visible => { if (visible) modals.push(true); }); }, require: name => name === './config' ? {} : { service }, wx }); app.onLaunch(); app.onShow(); };
  return { launch, values, modals, routes, app: () => app, saves: () => saves, fail: value => { fail = value; } };
}
test('first visit writes a note, suppresses overlapping modals, opens calendar and remembers confirmation across launches', () => {
  const f = fixture(); f.launch(); f.app().onShow();
  assert.equal(f.saves(), 1); assert.equal(f.modals.length, 1);
  f.app().confirmWelcome(); f.launch();
  assert.equal(f.modals.length, 1); assert.equal(f.saves(), 1);
  assert.deepEqual(f.routes, ['/pages/research/index']);
  assert.equal(f.values.get('portfolio.wechat.navigation-intent.v1').date, '2026-09-21');
});
test('failed note persistence leaves onboarding retryable and does not claim a saved welcome note', () => {
  const f = fixture(); f.fail(true); f.launch();
  assert.equal(f.modals.length, 0); assert.equal(f.values.size, 0);
  f.fail(false); f.app().onShow(); assert.equal(f.modals.length, 1);
});
