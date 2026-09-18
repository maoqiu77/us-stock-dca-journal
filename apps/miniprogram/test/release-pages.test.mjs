import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const source = new URL('../miniprogram/', import.meta.url);
function page(name, service) {
  const calls = { routes: [], notices: [], titles: [] };
  const wx = { navigateTo: value => calls.routes.push(value.url), setNavigationBarTitle: value => calls.titles.push(value.title), showToast: value => calls.notices.push(value), showModal: value => { calls.notices.push(value); value.success?.({ confirm: true }); } };
  const context = vm.createContext({ module: { exports: {} }, console, wx, require: () => ({ service, today: () => '2026-09-10', showError: error => calls.notices.push({ content: error.message }) }), Page: definition => { context.result = definition; definition.setData = update => Object.assign(definition.data, update); } });
  vm.runInContext(`(function(){${readFileSync(new URL(`pages/${name}/index.js`, source), 'utf8')}\n})()`, context);
  return { controller: context.result, calls };
}

test('research preview is readonly and editing invalidates the exact confirmed draft', async () => {
  const seen = []; const ai = {
    capabilities: () => ({ realProviderConfigured: true, enabled: true, providerConfigured: true, enrolled: true, consented: true, authorized: true, label: '真实模型服务' }),
    pending: () => [],
    previewContext: input => { seen.push(['preview', input]); return { facts: [], excerpts: [], missingInformation: [], historyOmittedCount: 0, approximateCharacters: 1, omissions: [] }; },
    prepare: (input, preview) => { seen.push(['prepare', input, preview]); return { conversation: { id: 'conversation-1' }, envelope: { payload_digest: 'a'.repeat(64) } }; },
    submitPrepared: async prepared => ({ conversation: prepared.conversation }),
    confirmResearchInstrument: symbol => ({ symbol, instrument_ref: 'instrument-1' }),
  };
  const service = { ai: () => ai, journal: () => ({ read: () => ({ instance_id: 'instance-1', runs: [] }) }) };
  const { controller } = page('research', service); controller.onLoad(); await controller.onShow(); controller.preview();
  assert.deepEqual(seen.map(item => item[0]), ['preview']);
  controller.onQuestion({ detail: { value: '新问题' } });
  await controller.runCloud();
  assert.deepEqual(seen.map(item => item[0]), ['preview']);
  assert.ok(controller.data.error.includes('查看'));
  controller.preview(); const confirmedPreview = controller._confirmedPreview; await controller.runCloud();
  assert.equal(seen.at(-1)[0], 'prepare'); assert.equal(seen.at(-1)[1].question, '新问题'); assert.equal(seen.at(-1)[2], confirmedPreview);
});

test('research checkbox group applies the actual selected values and invalidates preview', () => {
  const service = { ai: () => ({ capabilities: () => ({ realProviderConfigured: true, label: '' }), pending: () => [], previewContext: () => ({ facts: [], excerpts: [], missingInformation: [], historyOmittedCount: 0, approximateCharacters: 1, omissions: [] }) }), journal: () => ({ read: () => ({ runs: [] }) }) };
  const { controller } = page('research', service); controller.onLoad(); controller.preview();
  controller.toggleSelections({ detail: { value: ['includeJournal', 'includePolicy'] } });
  assert.equal(controller.data.includeJournal, true); assert.equal(controller.data.includeTradeReasons, false); assert.equal(controller.data.includePolicy, true); assert.equal(controller.data.previewData, null);
});

test('follow-up requires a fresh readonly preview before creating the request', async () => {
  const seen = []; const conversation = { id: 'conversation-1', origin: 'portfolio', anchor_id: null };
  const ai = { capabilities: () => ({ realProviderConfigured: true, enabled: true, providerConfigured: true, enrolled: true, consented: true, authorized: true, label: '' }), conversation: () => ({ conversation, messages: [], runs: [] }), pending: () => [], previewContext: input => { seen.push(['preview', input]); return { facts: [], excerpts: [], missingInformation: [], historyOmittedCount: 0, approximateCharacters: 1, omissions: [] }; }, prepare: input => { seen.push(['prepare', input]); return { conversation, envelope: { payload_digest: 'a'.repeat(64) } }; }, submitPrepared: async prepared => ({ conversation: prepared.conversation }) };
  const { controller } = page('conversation', { ai: () => ai }); controller.onLoad({ id: conversation.id }); controller.onQuestion({ detail: { value: '继续分析' } });
  await controller.send(); assert.deepEqual(seen, []);
  controller.preview(); assert.equal(seen[0][0], 'preview'); await controller.send(); assert.equal(seen[1][0], 'prepare');
});

test('a submitted pending request cannot be sent again as a new request', async () => {
  let prepares = 0; const preview = { facts: [], excerpts: [], missingInformation: [], historyOmittedCount: 0, approximateCharacters: 1, omissions: [] };
  const ai = { capabilities: () => ({ realProviderConfigured: true, enabled: true, providerConfigured: true, enrolled: true, consented: true, authorized: true, label: '' }), pending: () => [], previewContext: () => preview, prepare: () => { prepares++; return { conversation: { id: 'conversation-1' }, envelope: { payload_digest: 'a'.repeat(64) } }; }, submitPrepared: async () => ({ requestId: 'request-1', status: 'running' }) };
  const service = { ai: () => ai, journal: () => ({ read: () => ({ instance_id: 'instance-1', runs: [] }) }) };
  const { controller } = page('research', service); controller.onLoad(); await controller.onShow(); controller.preview(); await controller.runCloud(); await controller.runCloud();
  assert.equal(prepares, 1); assert.ok(controller.data.error.includes('先查看'));
});

test('settings labels and restores the current v5 backup and owns its navigation title', () => {
  const workspace = { policies: [], journal: [], conversations: [], runs: [], sources: [] };
  const service = {
    snapshot: () => ({ mode: 'personal' }), journal: () => ({ read: () => workspace }), overview: () => ({ clockAnomaly: null }), records: () => [],
    ai: () => ({ capabilities: async () => ({ label: '服务关闭', usage: null }) }), pendingSave: () => null, workspacePending: () => null,
    previewCompleteBackup: () => ({ version: 5, openings: 0, trades: 0, personalNotes: 0, runs: 0, complete: true }), restoreCompleteBackup: () => {},
  };
  const { controller, calls } = page('settings', service);
  controller.onShow();
  assert.deepEqual(calls.titles, ['数据与设置']);
  const template = readFileSync(new URL('pages/settings/index.wxml', source), 'utf8');
  assert.match(template, /导出 v5 完整备份/);
  assert.doesNotMatch(template, /导出 v4 完整备份/);
  controller.setData({ preview: service.previewCompleteBackup(), backupText: '{}' });
  controller.restoreBackup();
  assert.match(calls.notices.find(item => item.title === '用备份替换当前完整工作区？').content, /这是 v5 完整备份/);
});
