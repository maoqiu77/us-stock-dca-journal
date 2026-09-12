import { decimal, decimalText, dateSchema, ledgerEventSchema, projectLedger, type LedgerEvent } from '@portfolio/domain';
import { createRepository, type StoragePort } from './repository.ts';
import { activeEvents, clockState, emptySnapshot, projection, validateSnapshot, type Runtime, type Snapshot } from './model.ts';

export class ServiceError extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'ServiceError'; this.code = code; }
}
type AssetType = 'STOCK' | 'ETF';
type Guard = { recordId?: string; expectedRevision?: string; contentToken?: string };
export type TradeInput = Guard & { kind: 'buy' | 'sell'; symbol: string; assetType?: AssetType; date: string; quantity: string; price: string; fee?: string; note?: string; position?: number };
export type OpeningInput = Guard & { date: string; symbol: string; assetType?: AssetType; quantity: string; totalCost: string; note?: string };
type Position = { quantity: string; cost: string; realized: string };
export type MutationPreview = { amount: string; fee: string; net: string; availableQuantity: string; before: Position; after: Position; deltas: Position; order: { date: string; position: number; maxPosition: number }; contentToken: string; affectedPositions: Array<{ symbol: string; before: Position; after: Position }> };

function numberText(value: string, places = 12, positive = true) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,18}(?:\.\d+)?$/.test(text) || (text.split('.')[1]?.length ?? 0) > places) throw new ServiceError('INVALID_INPUT', `请输入有效数字，最多 ${places} 位小数。`);
  const normalized = text.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const parsed = decimal(normalized);
  if ((positive && !parsed.gt(0)) || (!positive && parsed.lt(0))) throw new ServiceError('INVALID_INPUT', positive ? '数量和价格必须大于零。' : '金额不能小于零。');
  return decimalText(parsed);
}
const calculated = (value: string) => decimal('0').plus(value);
const money = (value: string) => calculated(value).toFixed(2);
const preciseMoney = (value: string) => { const n = calculated(value); return n.toFixed(Math.max(2, n.decimalPlaces())); };
function normalizeSymbol(value: string) {
  const symbol = String(value ?? '').trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) throw new ServiceError('INVALID_INPUT', '请输入有效美股代码，如 QQQ 或 AAPL。');
  return symbol;
}
const ledgerMessages: Record<string, string> = {
  oversell: '卖出数量超过当时持仓；请检查日期、标的、同日顺序或后续卖出记录。',
  invalid_opening_position: '期初持仓必须位于统一期初日，且不能叠加到已有交易历史。',
  order_conflict: '同日记录顺序冲突，请重新预览后保存。',
};

export function createService(storage: StoragePort, runtime: Runtime) {
  const repo = createRepository(storage, runtime);
  // Exact content plus replacement generation: never rely on a short hash for stale edits.
  function snapshotToken(data: Snapshot) { return `${repo.generation()}:${JSON.stringify(data)}`; }
  function fail(code: string, message: string): never { throw new ServiceError(code, message); }
  function active(data: Snapshot) { return activeEvents(data, runtime); }
  function uniqueId(data: Snapshot, additional: string[] = []) {
    const ids = new Set([data.device_id, data.portfolio.id, ...additional, ...data.instruments.map(item => item.id), ...data.events.flatMap(event => [event.record_id, event.revision_id])]);
    for (let attempt = 0; attempt < 100; attempt++) { const id = runtime.id(); if (!ids.has(id)) return id; }
    return fail('ID_UNAVAILABLE', '无法生成唯一记录编号，请重试。');
  }
  function checkDate(data: Snapshot, date: string) {
    if (!dateSchema.safeParse(date).success || date < '1970-01-01' || date > runtime.today()) fail('INVALID_INPUT', '请选择有效日期，不能晚于今天。');
    if (clockState(data, runtime).clock_anomaly) fail('CLOCK_ANOMALY', '设备时间早于账本最近记录，请校准时间后再保存。');
  }
  function head(data: Snapshot, recordId?: string) {
    if (!recordId) return undefined;
    const found = active(data).find(item => item.record_id === recordId);
    if (!found) fail('NOT_FOUND', '记录不存在或已不在当前账本中。');
    return found;
  }
  function guard(data: Snapshot, input: Guard, current?: LedgerEvent) {
    if (input.contentToken && input.contentToken !== snapshotToken(data)) fail('STALE_PREVIEW', '账本已变化，请重新预览后保存。');
    if (current && input.expectedRevision !== current.revision_id) fail('STALE_REVISION', '该记录已被更正，请刷新后重试。');
  }
  function parseEvent(value: unknown) {
    const parsed = ledgerEventSchema.safeParse(value);
    if (!parsed.success) fail('INVALID_INPUT', '交易金额过小、超出范围或备注过长，请检查后重试。');
    return parsed.data;
  }
  function validateCandidate(candidate: Snapshot) {
    try { return validateSnapshot(candidate, runtime); }
    catch (error) { throw new ServiceError('HISTORY_INVALID', error instanceof Error ? error.message : String(error)); }
  }
  function instrumentFor(data: Snapshot, rawSymbol: string, rawType: AssetType | undefined) {
    const symbol = normalizeSymbol(rawSymbol), existing = data.instruments.find(item => item.symbol === symbol);
    if (existing && rawType && existing.asset_type !== rawType) fail('INVALID_INPUT', '此标的已有不同资产类型，请保持一致。');
    if (!existing && !rawType) fail('INVALID_INPUT', '请选择资产类型。');
    if (existing) return { instrument: existing, instruments: data.instruments };
    const instrument = { id: uniqueId(data), symbol, exchange: 'UNSPECIFIED', market: 'US' as const, quote_currency: 'USD' as const, asset_type: rawType!, confirmed_at: runtime.now() };
    return { instrument, instruments: [...data.instruments, instrument] };
  }
  function base(data: Snapshot, old?: LedgerEvent, additional: string[] = []) {
    const recordId = old?.record_id ?? uniqueId(data, additional), revisionId = uniqueId(data, [...additional, recordId]);
    return { schema_version: 1 as const, record_id: recordId, revision_id: revisionId, parent_revision: old?.revision_id ?? null, device_id: data.device_id,
      portfolio_id: data.portfolio.id, executed_at: null, recorded_at: runtime.now(), provenance: { source: 'manual' as const, confirmed_at: runtime.now() }, voided: false };
  }
  function replay(data: Snapshot) { return projection(data, runtime); }
  function projectedPosition(data: Snapshot, instrumentId: string): Position {
    const item = replay(data).positions.find(row => row.instrument_id === instrumentId);
    return { quantity: item?.quantity ?? '0', cost: money(item?.remaining_cost ?? '0'), realized: money(item?.realized_pnl ?? '0') };
  }
  function difference(before: Position, after: Position): Position {
    return { quantity: decimal(after.quantity).minus(before.quantity).toString(), cost: money(calculated(after.cost).minus(before.cost).toString()), realized: money(calculated(after.realized).minus(before.realized).toString()) };
  }
  function reorder(data: Snapshot, draft: LedgerEvent, old: LedgerEvent | undefined, requested?: number) {
    const sameDay = active(data).filter(item => !item.voided && item.trade_date === draft.trade_date && item.record_id !== old?.record_id).sort((a, b) => a.sequence - b.sequence);
    const fallback = old?.trade_date === draft.trade_date ? sameDay.filter(item => item.sequence < old.sequence).length : sameDay.length;
    const position = requested ?? fallback;
    if (!Number.isInteger(position) || position < 0 || position > sameDay.length) fail('INVALID_INPUT', '请选择有效的同日记录位置。');
    sameDay.splice(position, 0, draft);
    const revisions: LedgerEvent[] = [], generated = [draft.revision_id];
    for (let sequence = 0; sequence < sameDay.length; sequence++) {
      const item = sameDay[sequence];
      if (item.record_id === draft.record_id) revisions.push({ ...draft, sequence });
      else if (item.sequence !== sequence) {
        const revision_id = uniqueId(data, generated); generated.push(revision_id);
        revisions.push(parseEvent({ ...item, revision_id, parent_revision: item.revision_id, sequence, recorded_at: runtime.now(), provenance: { ...item.provenance, confirmed_at: runtime.now() } }));
      }
    }
    return { events: [...data.events, ...revisions], position, maxPosition: sameDay.length - 1 };
  }
  function buildTrade(data: Snapshot, input: TradeInput) {
    checkDate(data, input.date);
    if (input.kind !== 'buy' && input.kind !== 'sell') fail('INVALID_INPUT', '请选择买入或卖出。');
    const old = head(data, input.recordId); guard(data, input, old);
    if (old && old.kind !== 'buy' && old.kind !== 'sell') fail('INVALID_INPUT', '记录类型不匹配。');
    const { instrument, instruments } = instrumentFor(data, input.symbol, input.assetType);
    const quantity = numberText(input.quantity), price = numberText(input.price), fee = numberText(input.fee || '0', 4, false);
    const amount = decimalText(decimal(quantity).times(price), 4);
    const draft = parseEvent({ ...base({ ...data, instruments }, old), kind: input.kind, instrument_id: instrument.id, trade_date: input.date, sequence: old?.sequence ?? 0,
      note: String(input.note ?? '').trim(), quantity, price, amount, fee });
    const order = reorder({ ...data, instruments }, draft, old, input.position);
    return { candidate: validateCandidate({ ...data, instruments, events: order.events }), instrument, old, order: { date: input.date, position: order.position, maxPosition: order.maxPosition }, amount, fee };
  }
  function buildOpening(data: Snapshot, input: OpeningInput) {
    checkDate(data, input.date);
    const old = head(data, input.recordId); guard(data, input, old);
    if (old && old.kind !== 'opening_position') fail('INVALID_INPUT', '记录类型不匹配。');
    const openings = active(data).filter(item => item.kind === 'opening_position' && !item.voided && item.record_id !== old?.record_id);
    if (openings.some(item => item.trade_date !== input.date)) fail('OPENING_DATE_CONFLICT', '所有期初持仓必须使用同一个期初日期。');
    const trades = active(data).filter(item => (item.kind === 'buy' || item.kind === 'sell') && !item.voided);
    if (trades.some(item => item.trade_date < input.date)) fail('OPENING_DATE_CONFLICT', '期初日期不得晚于已有交易；请调整期初日期或新建账本。');
    const { instrument, instruments } = instrumentFor(data, input.symbol, input.assetType);
    if (!old && openings.some(item => 'instrument_id' in item && item.instrument_id === instrument.id)) fail('INVALID_INPUT', '该标的已有期初持仓，请更正原记录。');
    const quantity = numberText(input.quantity), totalCost = numberText(input.totalCost, 4, false), sequence = old?.sequence ?? openings.length;
    const draft = parseEvent({ ...base({ ...data, instruments }, old), kind: 'opening_position', instrument_id: instrument.id, trade_date: input.date, sequence,
      note: String(input.note ?? '').trim(), quantity, total_cost: totalCost });
    const order = reorder({ ...data, instruments }, draft, old, old ? undefined : openings.length);
    const candidate = { ...data, portfolio: { ...data.portfolio, opening_date: input.date }, instruments, events: order.events };
    return { candidate: validateCandidate(candidate), instrument, order: { date: input.date, position: order.position, maxPosition: order.maxPosition }, totalCost };
  }
  function preview(data: Snapshot, candidate: Snapshot, instrumentId: string, order: MutationPreview['order'], amount: string, fee: string, net: string, availableQuantity: string): MutationPreview {
    const before = projectedPosition(data, instrumentId), after = projectedPosition(candidate, instrumentId);
    const previous = replay(data), next = replay(candidate);
    const state = (items: typeof previous.positions, id: string): Position => {
      const item = items.find(position => position.instrument_id === id);
      return { quantity: item?.quantity ?? '0', cost: money(item?.remaining_cost ?? '0'), realized: money(item?.realized_pnl ?? '0') };
    };
    const affectedPositions = candidate.instruments.map(instrument => ({ symbol: instrument.symbol, before: state(previous.positions, instrument.id), after: state(next.positions, instrument.id), id: instrument.id }))
      .filter(item => item.id === instrumentId || JSON.stringify(item.before) !== JSON.stringify(item.after))
      .map(({ symbol, before, after }) => ({ symbol, before, after }));
    return { amount: preciseMoney(amount), fee: preciseMoney(fee), net: preciseMoney(net), availableQuantity, before, after, deltas: difference(before, after), order, affectedPositions, contentToken: snapshotToken(data) };
  }
  function availableQuantity(query: { symbol: string; date: string; position?: number; excludeRecordId?: string }) {
    const data = repo.read(); checkDate(data, query.date);
    const instrument = data.instruments.find(item => item.symbol === normalizeSymbol(query.symbol)); if (!instrument) return '0';
    const sameDay = active(data).filter(item => !item.voided && item.trade_date === query.date && item.record_id !== query.excludeRecordId).sort((a, b) => a.sequence - b.sequence);
    const position = query.position ?? sameDay.length;
    if (!Number.isInteger(position) || position < 0 || position > sameDay.length) fail('INVALID_INPUT', '请选择有效的同日记录位置。');
    const ids = new Set([...active(data).filter(item => !item.voided && item.record_id !== query.excludeRecordId && item.trade_date < query.date), ...sameDay.slice(0, position)].map(item => item.record_id));
    const partial = { ...data, events: data.events.filter(item => ids.has(item.record_id)) };
    const result = projectLedger(partial.portfolio, partial.instruments, partial.events, { through_date: query.date, known_at: runtime.now() });
    if (!result.ok) fail('HISTORY_INVALID', ledgerMessages[result.error.code] ?? `账本校验失败：${result.error.code}`);
    return result.value.positions.find(item => item.instrument_id === instrument.id)?.quantity ?? '0';
  }
  function row(data: Snapshot, event: LedgerEvent) {
    const instrument = 'instrument_id' in event ? data.instruments.find(item => item.id === event.instrument_id) : undefined;
    return { id: event.record_id, revisionId: event.revision_id, parentRevision: event.parent_revision, recordedAt: event.recorded_at, date: event.trade_date, sequence: event.sequence, voided: event.voided,
      kind: event.kind, label: event.kind === 'buy' ? '买入' : event.kind === 'sell' ? '卖出' : '期初持仓', symbol: instrument?.symbol ?? '', assetType: instrument?.asset_type ?? null,
      quantity: 'quantity' in event ? event.quantity : '', price: 'price' in event ? event.price : '', fee: 'fee' in event ? event.fee : '',
      amount: 'amount' in event ? money(event.amount) : event.kind === 'opening_position' ? money(event.total_cost) : '', totalCost: event.kind === 'opening_position' ? event.total_cost : '', note: event.note, isOpening: event.kind === 'opening_position' };
  }
  function records() { const data = repo.read(); return active(data).sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.sequence - a.sequence).map(item => row(data, item)); }

  return {
    pendingSave: repo.pendingSave, pendingIdentity: repo.pendingIdentity, verifyPending: repo.verifyPending, retryPending: repo.retryPending,
    snapshot: repo.read, generation: repo.generation, records, availableQuantity,
    firstUse() { const data = repo.read(), events = active(data).filter(item => !item.voided); const hasOpeningPositions = events.some(item => item.kind === 'opening_position'); return { isEmpty: events.length === 0, openingDate: hasOpeningPositions ? data.portfolio.opening_date : null, hasOpeningPositions }; },
    previewTrade(input: TradeInput) {
      repo.assertWritable(); const data = repo.read(), built = buildTrade(data, input);
      const available = availableQuantity({ symbol: built.instrument.symbol, date: input.date, position: built.order.position, excludeRecordId: input.recordId });
      const net = input.kind === 'buy' ? decimal(built.amount).plus(built.fee).negated() : decimal(built.amount).minus(built.fee);
      return preview(data, built.candidate, built.instrument.id, built.order, built.amount, built.fee, net.toString(), available);
    },
    saveTrade(input: TradeInput) { repo.assertWritable(); const data = repo.read(); repo.write(buildTrade(data, input).candidate); },
    previewOpening(input: OpeningInput) { repo.assertWritable(); const data = repo.read(), built = buildOpening(data, input); return preview(data, built.candidate, built.instrument.id, built.order, built.totalCost, '0', decimal(built.totalCost).negated().toString(), '0'); },
    saveOpening(input: OpeningInput) { repo.assertWritable(); const data = repo.read(); repo.write(buildOpening(data, input).candidate); },
    overview(cutoff?: { throughDate: string; knownAt: string }) {
      const data = repo.read(), projected = cutoff ? projection(data, runtime, { through_date: cutoff.throughDate, known_at: cutoff.knownAt }) : projection(data, runtime), state = clockState(data, runtime);
      const positions = projected.positions.filter(item => calculated(item.quantity).gt(0)).map(item => { const instrument = data.instruments.find(candidate => candidate.id === item.instrument_id)!; return { id: item.instrument_id, symbol: instrument.symbol, assetType: instrument.asset_type, quantity: item.quantity, cost: money(item.remaining_cost), unitCost: item.unit_cost ? calculated(item.unit_cost).toFixed(4) : '—', realized: money(item.realized_pnl) }; });
      return { mode: data.mode, positions, totalCost: money(projected.positions.reduce((sum, item) => sum.plus(item.remaining_cost), decimal('0')).toString()), realized: money(projected.realized_pnl), cash: projected.cash,
        marketValue: null, tradeCount: projected.input_head.filter(item => !item.voided && data.events.some(event => event.revision_id === item.revision_id && (event.kind === 'buy' || event.kind === 'sell'))).length, reviewCount: data.reviews.filter(item => item.date <= projected.through_date && Date.parse(item.updated_at) <= Date.parse(projected.known_at)).length,
        clockAnomaly: state.clock_anomaly, throughDate: projected.through_date, knownAt: projected.known_at };
    },
    revisionHistory(id: string) {
      const data = repo.read(), latest = head(data, id);
      if (!latest) return fail('NOT_FOUND', '记录不存在。');
      const revisions = new Map(data.events.map(item => [item.revision_id, item]));
      const chain: LedgerEvent[] = [];
      let current: LedgerEvent | undefined = latest;
      while (current) { chain.push(current); current = current.parent_revision ? revisions.get(current.parent_revision) : undefined; }
      return chain.reverse().map(item => ({ ...row(data, item), current: item.revision_id === latest.revision_id }));
    },
    positionDetail(idOrSymbol: string) {
      const data = repo.read(), instrument = data.instruments.find(item => item.id === idOrSymbol || item.symbol === idOrSymbol.trim().toUpperCase()); if (!instrument) return fail('NOT_FOUND', '标的不存在。');
      const projected = replay(data).positions.find(item => item.instrument_id === instrument.id), related = active(data).filter(item => 'instrument_id' in item && item.instrument_id === instrument.id).sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.sequence - a.sequence), opening = related.find(item => item.kind === 'opening_position' && !item.voided);
      const time = clockState(data, runtime);
      return { clockAnomaly: time.clock_anomaly, throughDate: time.through_date, knownAt: time.known_at, id: instrument.id, symbol: instrument.symbol, assetType: instrument.asset_type, quantity: projected?.quantity ?? '0', cost: money(projected?.remaining_cost ?? '0'), unitCost: projected?.unit_cost ? calculated(projected.unit_cost).toFixed(4) : '—', realized: money(projected?.realized_pnl ?? '0'), opening: opening ? row(data, opening) : null, records: related.map(item => row(data, item)), reasons: related.map(item => item.note).filter(Boolean) };
    },
    voidTrade(id: string, expectedRevision?: string) {
      const data = repo.read(); checkDate(data, runtime.today()); const event = head(data, id); if (!event || event.voided) fail('NOT_FOUND', '记录不存在或已经作废。'); if (expectedRevision && expectedRevision !== event.revision_id) fail('STALE_REVISION', '该记录已被更正，请刷新后重试。');
      const revised = parseEvent({ ...event, revision_id: uniqueId(data), parent_revision: event.revision_id, recorded_at: runtime.now(), provenance: { ...event.provenance, confirmed_at: runtime.now() }, voided: true }); repo.write(validateCandidate({ ...data, events: [...data.events, revised] }));
    },
    saveReview(date: string, text: string) { const data = repo.read(); checkDate(data, date); const trimmed = text.trim(); if (!trimmed || trimmed.length > 4000) fail('INVALID_INPUT', '请填写 1–4000 字的复盘内容。'); repo.write({ ...data, reviews: [...data.reviews.filter(item => item.date !== date), { date, text: trimmed, updated_at: runtime.now() }].sort((a, b) => b.date.localeCompare(a.date)) }); },
    exportBackup: repo.exportBackup, exportRaw: repo.exportRaw,
    previewBackup(text: string) { const data = repo.parseBackup(text); return { openings: active(data).filter(item => !item.voided && item.kind === 'opening_position').length, trades: active(data).filter(item => !item.voided && (item.kind === 'buy' || item.kind === 'sell')).length, reviews: data.reviews.length, mode: data.mode }; },
    restoreBackup(text: string) { repo.replace(repo.parseBackup(text)); }, recoverPrevious: repo.recoverPrevious,
    loadDemo() {
      const data = repo.read(); if (data.events.length || data.reviews.length || data.mode === 'demo') fail('NOT_EMPTY', '只有空账本可以载入示例。');
      const samples = new Map<string, string>(); const sampleStore = { get: (key: string) => samples.get(key) ?? '', set: (key: string, value: string) => { samples.set(key, value); } }; samples.set('portfolio.wechat.v1', JSON.stringify({ ...emptySnapshot(runtime), mode: 'demo' as const })); const sample = createService(sampleStore, runtime);
      sample.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: runtime.today(), quantity: '2', price: '100', fee: '1', note: '合成示例，不是真实行情或交易' }); sample.saveTrade({ kind: 'sell', symbol: 'QQQ', date: runtime.today(), quantity: '0.5', price: '110', fee: '0.2', note: '合成示例：练习部分卖出' }); sample.saveReview(runtime.today(), '这是一条示例复盘：记录买入理由、执行情况和下一次改进。'); repo.replace({ ...sample.snapshot(), mode: 'demo' });
    },
    startEmpty() { repo.replace(emptySnapshot(runtime)); },
  };
}
