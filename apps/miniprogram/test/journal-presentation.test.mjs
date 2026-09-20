import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const helper = vm.runInNewContext(`(function(){const module={exports:{}};${readFileSync(new URL('../miniprogram/utils/journal.js', import.meta.url), 'utf8')};return module.exports;})()`);
const plain = value => JSON.parse(JSON.stringify(value));
function seriesSource(id, bars, overrides = {}) {
  return { id, type: 'quote', origin_entity_id: 'receipt-1', content: JSON.stringify({ symbol: 'AAPL', market: 'US', period: '1day', currency: 'USD', provider: 'fixture', adjustment: 'forward_adjusted', fetchedAt: '2026-09-20T12:00:00.000Z', status: 'available', bars, ...overrides }) };
}
const bars = Array.from({ length: 80 }, (_, index) => ({ time: new Date(Date.UTC(2026, 5, index + 1)).toISOString(), open: index + 100, close: index + 100, high: index + 101, low: index + 99 }));
test('frozen series chunks merge and deduplicate before calculating MA60', () => {
  const result = helper.marketDetails([seriesSource('a', bars.slice(0, 60)), seriesSource('b', bars.slice(50))]);
  assert.equal(result.metrics.length, 1);
  assert.equal(result.details.length, 1);
  const rows = result.metrics[0].rows;
  assert.equal(rows.find(item => item.label === 'MA60').value, '149.50');
  assert.equal(rows.find(item => item.label === '最新收盘').value, '179.00');
  assert.equal(rows.find(item => item.label === '近 20 根低点').value, '159.00');
  assert.match(result.metrics[0].asOf, /交易日/);
  assert.equal(result.missing.length, 0);
});
test('different adjustment or receipt data is never merged; insufficient bars are explicit', () => {
  const result = helper.marketDetails([seriesSource('a', bars.slice(0, 30)), seriesSource('b', bars.slice(30), { adjustment: 'unadjusted' })]);
  assert.equal(result.metrics.length, 2);
  assert.equal(result.metrics[0].rows.find(item => item.label === 'MA60').value, '样本不足');
  assert.ok(result.missing.some(item => item.includes('MA60')));
});
test('unavailable period is an actionable limitation and never a fabricated metric', () => {
  const result = helper.marketDetails([seriesSource('a', [], { period: '60min', status: 'unavailable', reason: '暂不支持' })]);
  assert.equal(result.metrics.length, 0);
  assert.match(result.missing[0], /60 分钟行情暂不可用/);
});
test('each reply keeps its own evidence and conditions, hides empty limitations and keeps optional holdings separate', () => {
  const question = '请分析 US 市场的 AAPL 股票或 ETF。主周期：日线；辅助周期：无。持有数量 未提供 股；成本价 未提供 USD';
  const result = helper.conversationView({ messages: [{ id: 'u1', role: 'user', content: question }, { id: 'a1', parent_message_id: 'u1', role: 'assistant', run_id: 'r1', content: '第一轮', created_at: '2026-09-20T16:00:02Z' }, { id: 'u2', role: 'user', content: '我的原话' }, { id: 'a2', parent_message_id: 'u2', role: 'assistant', run_id: 'r2', content: '第二轮' }], runs: [{ id: 'r1', result: { evidence: [{ statement: '依据一' }], missing_information: ['无'], conditions: [{ text: '突破后观察', basis: 'user_assumption' }], next_questions: ['观察什么？'] } }, { id: 'r2', result: { evidence: [{ statement: '依据二' }], next_questions: ['何时复盘？'] } }] });
  assert.equal(result.title, 'AAPL · 日线分析');
  assert.equal(result.turns[0].missing.length, 0);
  assert.equal(result.turns[0].personal.length, 1);
  assert.equal(result.turns[0].savedDate, '2026-09-21');
  assert.equal(result.turns[0].evidence[0].statement, '依据一');
  assert.equal(result.turns[1].evidence[0].statement, '依据二');
  assert.equal(result.turns[1].generatedQuestion, false);
  assert.deepEqual(plain(result.nextQuestions), ['何时复盘？']);
});
