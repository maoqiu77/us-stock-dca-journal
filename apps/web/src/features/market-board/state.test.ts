import assert from 'node:assert/strict';
import test from 'node:test';
import { sortRows, moveSelection, removeSelection, selectionNeedsReload } from './state.ts';
import { formatAmount, formatFetchedAt, formatPercent, formatNumber, marketTone, metaSummary, observationTime, qualityLabel } from './format.ts';
import type { BoardRow } from './types.ts';
const row = (key: string, value: string | null) => ({instrument: {key, symbol:key, name:key}, quote:{change_pct:value}, quality:'partial'}) as BoardRow;
test('numeric sort is signed, stable, missing last in both directions', () => {
 const rows = [row('a','-2'), row('b','-10'), row('c',null), row('d','-2')];
 assert.deepEqual(sortRows(rows,'change_pct',true).map(r=>r.instrument.key), ['b','a','d','c']);
 assert.deepEqual(sortRows(rows,'change_pct',false).map(r=>r.instrument.key), ['a','d','b','c']);
 assert.equal(rows[0].instrument.key,'a');
});
test('ETF metrics and limits sort, zero retained', () => {
 const rows = [ {...row('a',null), metrics:{premium_pct:'10'}}, {...row('b',null), metrics:{premium_pct:'0'}} ] as BoardRow[];
 assert.equal(sortRows(rows,'premium_pct',true)[0].instrument.key,'b');
});
test('selection operations do not invent identities', () => {
 assert.deepEqual(moveSelection(['a','b'],'missing',0), ['a','b']);
 assert.deepEqual(removeSelection(['a','b'],['a','b']), []);
});
test('adding an unloaded instrument requests fresh board rows', () => {
 const rows = [row('a','1'), row('b','2')];
 assert.equal(selectionNeedsReload(['a','b','c'], rows), true);
 assert.equal(selectionNeedsReload(['b','a'], rows), false);
 assert.equal(selectionNeedsReload(['a'], rows), false);
});
test('formatting preserves missing, partial and currency semantics', () => {
 assert.equal(formatAmount('bad','USD'),'--');
 assert.equal(formatPercent(''),'--');
 assert.equal(formatPercent('0'),'0.00%');
 assert.match(formatAmount('12.34','USD'), /$/);
 assert.equal(formatNumber('12.34'), '12.34');
 assert.equal(formatNumber(null), '--');
 assert.equal(qualityLabel(row('a',null)), '字段不完整');
});
test('market movement is green when positive, red when negative, and neutral when absent or zero', () => {
 assert.equal(marketTone('0.40'), 'text-price-up');
 assert.equal(marketTone('-1.99'), 'text-price-down');
 assert.equal(marketTone('0'), '');
 assert.equal(marketTone(null), '');
 assert.equal(marketTone('bad'), '');
});
test('UTC fetch timestamps are shown in Beijing time', () => {
 assert.equal(formatFetchedAt('2026-09-29T13:17:51Z'), '2026-09-29 21:17 北京时间');
 assert.equal(formatFetchedAt(null), '--');
 assert.equal(observationTime('2026-09-29T13:17:51Z'), '09-29 21:17 北京时间');
 assert.equal(metaSummary({source:'东方财富正式净值档案',as_of:'2026-09-28T00:00:00+08:00',fetched_at:'2026-09-29T13:17:51Z',status:'available',timeliness:'eod',cache_state:'fresh_hit'}), '东方财富正式净值档案 · 可用 · 2026-09-28 净值日期');
});
