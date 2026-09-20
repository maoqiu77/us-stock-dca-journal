import assert from 'node:assert/strict';
import test from 'node:test';
import { createService } from '../src/service.ts';
import { fakeAiProvider } from '../src/ai/fake-provider.ts';
import { shanghaiDayKey } from '../src/journal/model.ts';

function fixture() {
  const values = new Map<string, string>(); let id = 3000, now = '2026-09-20T15:59:59.000Z';
  const runtime = { now: () => now, today: () => shanghaiDayKey(now), id: () => `94000000-0000-4000-8000-${String(++id).padStart(12, '0')}` };
  const storage = { get: (key: string) => values.get(key) ?? '', set: (key: string, value: string) => { values.set(key, value); }, info: () => ({ currentSize: 0, limitSize: 10240 }) };
  const service = createService(storage, runtime, { fakeProvider: fakeAiProvider });
  service.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: '2026-09-20', quantity: '2', price: '10', fee: '0', note: '真实交易理由' });
  return { service, setTime(value: string) { now = value; } };
}

test('Shanghai day keys and calendar index use message time while one conversation continues across days', () => {
  assert.equal(shanghaiDayKey('2026-09-20T15:59:59.000Z'), '2026-09-20');
  assert.equal(shanghaiDayKey('2026-09-20T16:00:00.000Z'), '2026-09-21');
  const f = fixture();
  const first = f.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-20', question: '第一天的问题' });
  f.setTime('2026-09-20T16:00:00.000Z');
  f.service.ai().followUp({ conversationId: first.conversation.id, journalDate: '2026-09-21', question: '第二天继续' });
  const calendar = f.service.journal().calendarMonth('2026-09');
  assert.deepEqual(calendar.days, ['2026-09-20', '2026-09-21']);
  assert.equal(f.service.journal().history('2026-09-20').some(item => item.conversationId === first.conversation.id && item.text === '第一天的问题'), true);
  assert.equal(f.service.journal().history('2026-09-21').some(item => item.conversationId === first.conversation.id && item.text === '第二天继续'), true);
  assert.equal(f.service.ai().conversation(first.conversation.id).messages.length, 4);
});

test('legacy dated notes remain on their date and personal note save never invokes a model', () => {
  const f = fixture();
  f.service.saveReview('2026-09-18', '仅有日期的旧记录');
  const beforeRuns = f.service.journal().read().runs.length;
  const note = f.service.journal().read().journal.find(item => item.body === '仅有日期的旧记录')!;
  const item = f.service.journal().history('2026-09-18').find(row => row.id === note.id)!;
  assert.equal(item.legacyDayKey, '2026-09-18');
  assert.equal(item.createdAt, null);
  assert.equal(f.service.journal().read().runs.length, beforeRuns);
});

test('AI text is copied into an edited personal note without overwriting the AI original', () => {
  const f = fixture();
  const analysis = f.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-20', question: '分析' });
  const assistant = f.service.ai().conversation(analysis.conversation.id).messages.find(item => item.role === 'assistant')!;
  const note = f.service.journal().saveAiMessageAsNote(assistant.id, '2026-09-20', '我编辑后确认的手记');
  assert.equal(note.body, '我编辑后确认的手记');
  assert.equal(note.classification, 'user_original');
  assert.equal(f.service.ai().conversation(analysis.conversation.id).messages.find(item => item.id === assistant.id)?.content, assistant.content);
});

test('deleting a conversation removes its derived text from context and new backup but keeps trades', () => {
  const f = fixture(), financial = f.service.exportBackup();
  const analysis = f.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-20', question: '需要彻底删除的问题' });
  const beforeEpoch = f.service.journal().read().privacy_epoch;
  f.service.journal().deleteConversation(analysis.conversation.id);
  const state = f.service.journal().read(), backup = f.service.exportFullBackup();
  assert.equal(state.privacy_epoch, beforeEpoch + 1);
  assert.equal(state.conversations.some(item => item.id === analysis.conversation.id), false);
  assert.equal(state.messages.some(item => item.conversation_id === analysis.conversation.id), false);
  assert.equal(state.runs.some(item => item.conversation_id === analysis.conversation.id), false);
  assert.equal(backup.includes('需要彻底删除的问题'), false);
  assert.equal(f.service.exportBackup(), financial);
  assert.equal(f.service.records().length, 1);
});

test('deleting a note invalidates AI output derived from it and late responses cannot archive', () => {
  const f = fixture();
  const note = f.service.journal().savePersonalNote('2026-09-20', '敏感的个人判断');
  const analysis = f.service.ai().analyze({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-20', question: '请结合手记' });
  assert.equal(f.service.journal().read().runs.length, 1);
  f.service.journal().deletePersonalNote(note.id);
  const after = f.service.journal().read();
  assert.equal(after.journal.some(item => item.id === note.id), false);
  assert.equal(after.runs.some(item => item.id === analysis.run.id), false);
  assert.equal(after.messages.some(item => item.run_id === analysis.run.id), false);
  assert.equal(f.service.exportFullBackup().includes('敏感的个人判断'), false);

  const prepared = f.service.ai().prepare({ origin: 'portfolio', mode: 'portfolio_review', journalDate: '2026-09-20', question: '正在生成' });
  f.service.journal().deleteConversation(prepared.conversation.id);
  assert.throws(() => f.service.ai().runPreparedFake(prepared), /删除|迟到|隐私/);
  assert.equal(f.service.journal().read().messages.some(item => item.content === '正在生成'), false);
});
