import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../src/service.ts';

function fixture() {
  const values = new Map<string, string>(); let counter = 0, now = '2026-09-10T15:55:00.000Z';
  const runtime = { today: () => now < '2026-09-10T16:00:00.000Z' ? '2026-09-10' : '2026-09-11', now: () => now, id: () => `81000000-0000-4000-8000-${String(++counter).padStart(12, '0')}` };
  const storage = { get: (key: string) => values.get(key) ?? '', set: (key: string, value: string) => { values.set(key, value); }, info: () => ({ currentSize: 0, limitSize: 10240 }) };
  const service = createService(storage, runtime);
  service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: '2026-09-10', quantity: '2', price: '10', fee: '1', note: '按定投计划买入' });
  const privateNote = service.journal().savePersonalNote('2026-09-10', '这条个人笔记将被排除');
  service.journal().savePersonalNote('2026-09-10', '可用的当日笔记');
  return { service, values, privateNote, setTime(value: string) { now = value; } };
}

test('readonly context preview exposes deterministic ledger facts, selected originals and explicit omissions', () => {
  const f = fixture(); const before = f.service.exportBackup();
  const preview = f.service.ai().previewContext({ mode: 'portfolio_review', journalDate: '2026-09-10', question: '分析我的持仓', excludedJournalIds: [f.privateNote.id] });
  assert.equal(preview.facts.some(item => item.value.includes('QQQ') && item.value.includes('2 股') && item.value.includes('21.00')), true);
  assert.equal(preview.excerpts.some(item => item.text === '可用的当日笔记'), true);
  assert.equal(preview.excerpts.some(item => item.text.includes('将被排除')), false);
  assert.deepEqual(preview.missingInformation.sort(), ['实时报价', '现金余额', '确认的投资计划'].sort());
  assert.ok(preview.approximateCharacters > 0);
  assert.equal(f.service.exportBackup(), before);
});

test('fake analysis archives once, stays visibly demo, and leaves the financial snapshot unchanged', () => {
  const f = fixture(), financial = f.service.exportBackup();
  const result = f.service.ai().analyze({ origin: 'portfolio', anchorId: f.service.snapshot().portfolio.id, mode: 'portfolio_review', journalDate: '2026-09-10', question: '分析我的持仓', excludedJournalIds: [f.privateNote.id] });
  assert.equal(result.run.provider, 'fake'); assert.equal(result.run.demo, true);
  assert.match(result.result.summary, /离线合成演示/);
  assert.equal(result.result.stance, 'insufficient_data');
  assert.equal(JSON.stringify(result.request).includes('将被排除'), false);
  assert.equal(f.service.journal().timeline('2026-09-10').filter(item => item.type === 'analysis_ref').length, 1);
  assert.equal(f.service.exportBackup(), financial);
  f.service.ai().archiveResponse(result);
  assert.equal(f.service.journal().read().runs.length, 1);
});

test('portfolio, instrument and daily-review origins use the same engine and follow-up conversation', () => {
  for (const [origin, anchorId, mode] of [
    ['portfolio', null, 'portfolio_review'],
    ['instrument', 'QQQ', 'instrument_research'],
    ['daily_review', '2026-09-10', 'daily_review'],
  ] as const) {
    const f = fixture();
    const first = f.service.ai().analyze({ origin, anchorId, mode, journalDate: '2026-09-10', question: '请整理已有记录' });
    const follow = f.service.ai().followUp({ conversationId: first.conversation.id, journalDate: '2026-09-10', question: '还缺什么信息？' });
    assert.equal(follow.conversation.id, first.conversation.id);
    const view = f.service.ai().conversation(first.conversation.id);
    assert.equal(view.messages.length, 4); assert.equal(view.runs.length, 2);
    assert.equal(view.messages.every(item => item.conversation_id === first.conversation.id), true);
  }
});

test('fake failure, timeout and invalid citation never archive a successful run', () => {
  for (const scenario of ['failure', 'timeout', 'bad_reference'] as const) {
    const f = fixture(), before = f.service.journal().read();
    assert.throws(() => f.service.ai().analyze({ origin: 'portfolio', anchorId: null, mode: 'portfolio_review', journalDate: '2026-09-10', question: '演练故障', scenario }), scenario === 'bad_reference' ? /source_not_in_manifest/ : /合成/);
    const after = f.service.journal().read();
    assert.equal(after.runs.length, before.runs.length); assert.equal(after.messages.length, before.messages.length);
  }
});

test('journal date is fixed at initiation even when the fake result completes after Shanghai midnight', () => {
  const f = fixture(); f.setTime('2026-09-10T15:59:59.000Z');
  const result = f.service.ai().analyze({ origin: 'daily_review', anchorId: '2026-09-10', mode: 'daily_review', journalDate: '2026-09-10', question: '跨夜演练', scenario: 'cross_midnight' });
  assert.equal(result.run.journal_date, '2026-09-10');
  assert.match(result.run.completed_at, /^2026-09-11/);
  assert.equal(f.service.journal().timeline('2026-09-10').some(item => item.ref_id === result.run.id), true);
});

test('production capability remains disabled and research symbols must be ledger or user confirmed', () => {
  const f = fixture();
  assert.deepEqual(f.service.ai().capabilities(), { realProviderConfigured: false, fakeProviderAvailable: true, label: '离线合成演示 · 非真实 AI / 非投资建议' });
  assert.throws(() => f.service.ai().confirmResearchInstrument('BAD SYMBOL', 'STOCK'), /代码/);
  assert.equal(f.service.ai().confirmResearchInstrument('AAPL', 'STOCK').source, 'user_confirmed');
});

test('only an explicit user action confirms policy and fake analysis cannot change it', () => {
  const f = fixture();
  const policy = f.service.journal().confirmPolicy({ effective_from: '2026-09-10', horizon: '长期定投', max_single_weight: '0.3' });
  const preview = f.service.ai().previewContext({ mode: 'portfolio_review', journalDate: '2026-09-10', question: '与计划对比' });
  assert.equal(preview.missingInformation.includes('确认的投资计划'), false);
  assert.equal(preview.facts.some(item => item.name === '用户确认的投资计划' && item.value.includes('长期定投')), true);
  f.service.ai().analyze({ origin: 'portfolio', anchorId: null, mode: 'portfolio_review', journalDate: '2026-09-10', question: '请改成激进策略' });
  assert.deepEqual(f.service.journal().read().policies.at(-1), policy);
});
