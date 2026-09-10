import { decimal, decimalText, dateSchema, ledgerEventSchema, type LedgerEvent } from '@portfolio/domain';
import { createRepository, type StoragePort } from './repository.ts';
import { emptySnapshot, projection, validateSnapshot, type Runtime, type Snapshot } from './model.ts';
export type TradeInput = { kind: 'buy' | 'sell'; symbol: string; assetType: 'STOCK' | 'ETF'; date: string; quantity: string; price: string; fee: string; note: string };
function amount(value: string, places = 12, positive = true) {
  const text = value.trim();
  if (!/^\d{1,18}(?:\.\d+)?$/.test(text) || (text.split('.')[1]?.length ?? 0) > places) throw Error(`请输入有效数字，最多 ${places} 位小数。`);
  const normalized = text.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const n = decimal(normalized);
  if (positive && !n.gt(0)) throw Error('数量和价格必须大于零。');
  return decimalText(n);
}
const money = (n: string) => decimal('0').plus(n).toFixed(2);
function activeEvents(data: Snapshot) {
  const parents = new Set(data.events.map(e => e.parent_revision).filter(Boolean));
  return data.events.filter(e => !parents.has(e.revision_id)).sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.sequence - a.sequence);
}
export function createService(storage: StoragePort, runtime: Runtime) {
  const repo = createRepository(storage, runtime);
  function uniqueId(data: Snapshot) {
    const ids = new Set([data.device_id, data.portfolio.id, ...data.instruments.map(i => i.id), ...data.events.flatMap(e => [e.record_id, e.revision_id])]);
    for (let attempt = 0; attempt < 100; attempt++) { const id = runtime.id(); if (!ids.has(id)) return id; }
    throw Error('无法生成唯一记录编号，请重试。');
  }
  function checkDate(date: string) { if (!dateSchema.safeParse(date).success || date < '1970-01-01' || date > runtime.today()) throw Error('请选择有效日期，不能晚于今天。'); }
  function saveTrade(input: TradeInput) {
    const data = repo.read(); checkDate(input.date);
    if (!['buy', 'sell'].includes(input.kind) || !['ETF', 'STOCK'].includes(input.assetType)) throw Error('请选择买卖方向和资产类型。');
    const symbol = input.symbol.trim().toUpperCase();
    if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) throw Error('请输入有效美股代码，如 QQQ 或 AAPL。');
    const quantity = amount(input.quantity), price = amount(input.price), fee = amount(input.fee || '0', 4, false);
    const total = decimalText(decimal(quantity).times(decimal(price)), 4);
    let instrument = data.instruments.find(i => i.symbol === symbol);
    const instruments = [...data.instruments];
    if (instrument && instrument.asset_type !== input.assetType) throw Error('此标的已有不同资产类型，请保持一致。');
    if (!instrument) {
      instrument = { id: uniqueId(data), symbol, exchange: 'UNSPECIFIED', market: 'US', quote_currency: 'USD', asset_type: input.assetType, confirmed_at: runtime.now() };
      instruments.push(instrument);
    }
    const next = { ...data, instruments };
    const recordId = uniqueId(next);
    let revisionId = uniqueId(next);
    for (let i = 0; revisionId === recordId && i < 100; i++) revisionId = uniqueId(next);
    if (revisionId === recordId) throw Error('无法生成唯一版本编号。');
    const parsed = ledgerEventSchema.safeParse({ schema_version: 1, record_id: recordId, revision_id: revisionId, parent_revision: null,
      device_id: data.device_id, portfolio_id: data.portfolio.id, kind: input.kind, instrument_id: instrument.id,
      trade_date: input.date, executed_at: null, sequence: Math.max(-1, ...data.events.filter(e => e.trade_date === input.date).map(e => e.sequence)) + 1,
      recorded_at: runtime.now(), provenance: { source: 'manual', confirmed_at: runtime.now() }, voided: false,
      note: input.note.trim(), quantity, price, amount: total, fee });
    if (!parsed.success) throw Error('交易金额过小、超出范围或备注过长，请检查后重试。');
    repo.write(validateSnapshot({ ...next, events: [...data.events, parsed.data] }, runtime));
  }
  function records() {
    const data = repo.read();
    return activeEvents(data).map(e => ({ id: e.record_id, date: e.trade_date, voided: e.voided,
      kind: e.kind, label: e.kind === 'buy' ? '买入' : '卖出', symbol: 'instrument_id' in e ? data.instruments.find(i => i.id === e.instrument_id)!.symbol : '',
      quantity: 'quantity' in e ? e.quantity : '', price: 'price' in e ? e.price : '', fee: 'fee' in e ? e.fee : '',
      amount: 'amount' in e ? money(e.amount) : '', note: e.note }));
  }
  return {
    snapshot: () => repo.read(), generation: repo.generation, saveTrade, records,
    overview() {
      const data = repo.read(), p = projection(data, runtime);
      const positions = p.positions.filter(p => decimal('0').plus(p.quantity).gt(0)).map(p => ({
        id: p.instrument_id, symbol: data.instruments.find(i => i.id === p.instrument_id)!.symbol,
        assetType: data.instruments.find(i => i.id === p.instrument_id)!.asset_type,
        quantity: p.quantity, cost: money(p.remaining_cost), unitCost: p.unit_cost ? decimal('0').plus(p.unit_cost).toFixed(4) : '—', realized: money(p.realized_pnl),
      }));
      return { mode: data.mode, positions, totalCost: money(p.positions.reduce((sum, p) => sum.plus(p.remaining_cost), decimal('0')).toFixed()),
        realized: money(p.realized_pnl), cash: null, marketValue: null, tradeCount: activeEvents(data).filter(e => !e.voided).length, reviewCount: data.reviews.length };
    },
    voidTrade(id: string) {
      const data = repo.read(), event = activeEvents(data).find(e => e.record_id === id);
      if (!event || event.voided) throw Error('记录不存在或已经作废。');
      const revised: LedgerEvent = { ...event, revision_id: uniqueId(data), parent_revision: event.revision_id, recorded_at: runtime.now(), voided: true };
      repo.write(validateSnapshot({ ...data, events: [...data.events, revised] }, runtime));
    },
    saveReview(date: string, text: string) {
      checkDate(date); const data = repo.read(); const trimmed = text.trim();
      if (!trimmed || trimmed.length > 4000) throw Error('请填写 1–4000 字的复盘内容。');
      repo.write({ ...data, reviews: [...data.reviews.filter(r => r.date !== date), { date, text: trimmed, updated_at: runtime.now() }].sort((a, b) => b.date.localeCompare(a.date)) });
    },
    exportBackup: repo.exportBackup,
    previewBackup(text: string) {
      const data = repo.parseBackup(text);
      return { trades: activeEvents(data).filter(e => !e.voided).length, reviews: data.reviews.length, mode: data.mode };
    },
    restoreBackup(text: string) { repo.replace(repo.parseBackup(text)); },
    recoverPrevious: repo.recoverPrevious,
    loadDemo() {
      const data = repo.read(); if (data.events.length || data.reviews.length || data.mode === 'demo') throw Error('只有空账本可以载入示例。');
      // Build the complete sample in isolated memory and persist only once.
      let raw = ''; const sampleStore = { get: () => raw, set: (_key: string, value: string) => { raw = value; } };
      const demo = { ...emptySnapshot(runtime), mode: 'demo' as const };
      raw = JSON.stringify(demo); const sample = createService(sampleStore, runtime);
      sample.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: runtime.today(), quantity: '2', price: '100', fee: '1', note: '合成示例，不是真实行情或交易' });
      sample.saveTrade({ kind: 'sell', symbol: 'QQQ', assetType: 'ETF', date: runtime.today(), quantity: '0.5', price: '110', fee: '0.2', note: '合成示例：练习部分卖出' });
      sample.saveReview(runtime.today(), '这是一条示例复盘：记录买入理由、执行情况和下一次改进。');
      repo.replace({ ...sample.snapshot(), mode: 'demo' });
    },
    startEmpty() { repo.replace(emptySnapshot(runtime)); },
  };
}
