import { decimal, decimalText, dateSchema, ledgerEventSchema, projectLedger, valuePortfolio, type LedgerEvent } from '@portfolio/domain';
import { createRepository, type StoragePort } from './repository.ts';
import { screenshotMetricsSchema, activeEvents, clockState, emptySnapshot, projection, validateSnapshot, type Runtime, type Snapshot } from './model.ts';
import { createWorkspaceRepository } from './workspace/repository.ts';
import { backupPreview, encodeFullBackup, parseCompleteBackup } from './workspace/backup.ts';
import { createAiEngine } from './ai/engine.ts';
import type { AiTransport } from './ai/transport.ts';
import type { FakeAiProvider } from './ai/fake-provider.ts';
import { createMarketClient } from './market/client.ts';
import type { MarketTransport } from './market/transport.ts';
import { createMarketDiscovery } from './market/discovery.ts';
import { sha256 } from '@portfolio/ai-context';
import type { VisionTransport } from './vision/transport.ts';

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
export type HoldingInput = Omit<Guard, 'expectedRevision'> & {
  batchId: string;
  expectedRevision: number;
  observedAt: string;
  instrument: { symbol: string; name: string; market: string; currency: string; assetType: 'STOCK' | 'ETF' | 'FUND'; status: 'verified' | 'unverified'; instrumentKey?: string };
  quantity: string;
  unitCost?: string | null;
  replaceApproved?: boolean;
};
export type HoldingImportInput = Omit<Guard, 'expectedRevision'> & {
  batchId: string;
  expectedRevision: number;
  observedAt: string;
  rows: Array<{
    rowId: string;
    instrument: HoldingInput['instrument'];
    quantity: string;
    unitCost?: string | null;
    replaceApproved?: boolean;
    costRemovalApproved?: boolean;
    screenshotMetrics?: Snapshot['holding_checkpoints'][number]['screenshot_metrics'];
  }>;
};

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
function holdingDecimal(value: unknown, nullable = false) {
  const raw = String(value ?? '').trim();
  if (!raw && nullable) return null;
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw)) throw new ServiceError('INVALID_INPUT', '请输入有效数字；千分位必须完整，不能使用指数、百分号或负数。');
  const text = raw.replaceAll(',', '').replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '') || '0';
  if (text.length > 40 || (text.split('.')[1]?.length ?? 0) > 12) throw new ServiceError('INVALID_INPUT', '数字格式过长，最多 12 位小数。');
  return decimalText(decimal(text));
}
const ledgerMessages: Record<string, string> = {
  oversell: '卖出数量超过当时持仓；请检查日期、标的、同日顺序或后续卖出记录。',
  invalid_opening_position: '期初持仓必须位于统一期初日，且不能叠加到已有交易历史。',
  order_conflict: '同日记录顺序冲突，请重新预览后保存。',
};

export type ServiceOptions = { aiTransport?: AiTransport; fakeProvider?: FakeAiProvider; demoFactory?: (runtime: Runtime) => Snapshot; marketTransport?: MarketTransport; visionTransport?: VisionTransport };
export function createService(storage: StoragePort, runtime: Runtime, options: ServiceOptions = {}) {
  const repo = createRepository(storage, runtime);
  const workspace = createWorkspaceRepository(storage, runtime, { readFinancial: repo.ensurePersisted, ledgerPending: repo.pendingSave });
  let aiEngine: ReturnType<typeof createAiEngine> | undefined;
  const marketClient = createMarketClient(storage, options.marketTransport, { now: runtime.now });
  const marketDiscovery = createMarketDiscovery(storage, options.marketTransport, { now: runtime.now });
  // Exact content plus replacement generation: never rely on a short hash for stale edits.
  function snapshotToken(data: Snapshot) { return `${repo.generation()}:${JSON.stringify(data)}`; }
  function fail(code: string, message: string): never { throw new ServiceError(code, message); }
  function active(data: Snapshot) { return activeEvents(data, runtime); }
  function uniqueId(data: Snapshot, additional: string[] = []) {
    const ids = new Set([data.device_id, data.portfolio.id, ...additional, ...data.instruments.map(item => item.id), ...data.holding_assets.map(item => item.id), ...data.holding_checkpoints.map(item => item.id), ...data.events.flatMap(event => [event.record_id, event.revision_id])]);
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
  function currentPositions(data: Snapshot, ledger = replay(data)) {
    const ledgerById = new Map(ledger.positions.map(item => [item.instrument_id, item]));
    const visibleHeads = new Set(ledger.input_head.map(item => item.revision_id));
    const activeRows = active(data).filter(item => !item.voided && visibleHeads.has(item.revision_id));
    const activeByRecord = new Map(activeRows.map(item => [item.record_id, item]));
    const checkpoints = new Map<string, Snapshot['holding_checkpoints'][number]>();
    for (const item of data.holding_checkpoints.filter(item => Date.parse(item.observed_at) <= Date.parse(ledger.known_at))) {
      const old = checkpoints.get(item.instrument_id);
      if (!old || old.observed_at < item.observed_at || old.observed_at === item.observed_at) checkpoints.set(item.instrument_id, item);
    }
    const ids = new Set([...ledgerById.keys(), ...checkpoints.keys()]);
    return [...ids].map(instrumentId => {
      const base = ledgerById.get(instrumentId), checkpoint = checkpoints.get(instrumentId);
      if (!checkpoint) return { instrumentId, quantity: base?.quantity ?? '0', remainingCost: base?.remaining_cost ?? '0', unitCost: base?.unit_cost ?? null, realized: base?.realized_pnl ?? '0', checkpoint: null, checkpointConflict: false };
      const included = new Map(checkpoint.baseline_heads.map(item => [item.record_id, item.revision_id]));
      const checkpointConflict = [...included].some(([recordId, revisionId]) => activeByRecord.get(recordId)?.revision_id !== revisionId);
      let quantity = decimal(checkpoint.quantity);
      let cost = checkpoint.unit_cost === null ? null : quantity.times(decimal(checkpoint.unit_cost));
      const after = activeRows.filter(item => 'instrument_id' in item && item.instrument_id === instrumentId && !included.has(item.record_id) && (item.kind === 'buy' || item.kind === 'sell'));
      for (const event of after) {
        if (event.kind === 'buy') {
          quantity = quantity.plus(event.quantity);
          if (cost !== null) cost = cost.plus(decimal(event.amount)).plus(event.fee);
        } else if (event.kind === 'sell') {
          const sold = decimal(event.quantity);
          if (sold.gt(quantity)) fail('HISTORY_INVALID', '校准后的真实卖出超过当前持仓，请重新校准。');
          if (cost !== null && quantity.gt(0)) cost = cost.minus(cost.times(sold).div(quantity));
          quantity = quantity.minus(sold);
        }
      }
      return { instrumentId, quantity: decimalText(quantity), remainingCost: cost === null ? null : decimalText(cost), unitCost: cost === null || quantity.isZero() ? null : decimalText(cost.div(quantity)), realized: checkpoint ? null : base?.realized_pnl ?? '0', checkpoint, checkpointConflict };
    });
  }
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
    if (old && data.holding_checkpoints.some(item => item.baseline_heads.some(head => head.record_id === old.record_id))) fail('CHECKPOINT_CONFLICT', '该交易已包含在持仓校准中；请新建校准，不能静默改写校准前流水。');
    if (old && old.kind !== 'buy' && old.kind !== 'sell') fail('INVALID_INPUT', '记录类型不匹配。');
    const { instrument, instruments } = instrumentFor(data, input.symbol, input.assetType);
    const quantity = numberText(input.quantity), price = numberText(input.price), fee = numberText(input.fee || '0', 4, false);
    const amount = decimalText(decimal(quantity).times(price), 4);
    const draft = parseEvent({ ...base({ ...data, instruments }, old), kind: input.kind, instrument_id: instrument.id, trade_date: input.date, sequence: old?.sequence ?? 0,
      note: String(input.note ?? '').trim(), quantity, price, amount, fee });
    const order = reorder({ ...data, instruments }, draft, old, input.position);
    return { candidate: validateCandidate({ ...data, instruments, events: order.events, revision: data.revision + 1 }), instrument, old, order: { date: input.date, position: order.position, maxPosition: order.maxPosition }, amount, fee };
  }
  function buildOpening(data: Snapshot, input: OpeningInput) {
    checkDate(data, input.date);
    const old = head(data, input.recordId); guard(data, input, old);
    if (old && data.holding_checkpoints.some(item => item.baseline_heads.some(head => head.record_id === old.record_id))) fail('CHECKPOINT_CONFLICT', '该期初记录已包含在持仓校准中；请新建校准，不能静默改写。');
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
    const candidate = { ...data, portfolio: { ...data.portfolio, opening_date: input.date }, instruments, events: order.events, revision: data.revision + 1 };
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

  function holdingAsset(data: Snapshot, input: HoldingInput) {
    const symbol = normalizeSymbol(input.instrument.symbol), market = String(input.instrument.market ?? '').trim().toUpperCase(), currency = String(input.instrument.currency ?? '').trim().toUpperCase();
    const name = String(input.instrument.name ?? '').trim();
    if (!name || name.length > 120 || !/^[A-Z]{3}$/.test(currency) || !market || market.length > 32) fail('INVALID_INPUT', '请填写有效的名称、市场和三位币种代码。');
    const metadata = data.holding_assets.find(item => item.symbol === symbol && item.market === market && item.currency === currency);
    const legacy = data.instruments.find(item => item.symbol === symbol && market === 'US' && currency === 'USD');
    const id = metadata?.id ?? legacy?.id ?? uniqueId(data);
    const catalog = [...marketDiscovery.view().results, ...marketDiscovery.view().watchlist].find(item => item.instrument_key === input.instrument.instrumentKey && item.symbol === symbol && item.name === name && item.market === market && item.currency === currency && item.asset_type === input.instrument.assetType);
    const trustedExisting = legacy || metadata?.status === 'verified' && metadata.name === name && metadata.asset_type === input.instrument.assetType;
    const asset = { id, symbol, name, market, currency, asset_type: input.instrument.assetType, status: catalog || trustedExisting ? 'verified' as const : 'unverified' as const, confirmed_at: runtime.now() };
    const holding_assets = [...data.holding_assets.filter(item => item.id !== id), asset];
    let instruments = data.instruments;
    if (!legacy && market === 'US' && currency === 'USD' && input.instrument.assetType !== 'FUND') {
      instruments = [...instruments, { id, symbol, exchange: 'UNSPECIFIED', market: 'US' as const, quote_currency: 'USD' as const, asset_type: input.instrument.assetType, confirmed_at: runtime.now() }];
    }
    return { asset, holding_assets, instruments };
  }
  function holdingSignature(input: HoldingInput, quantity: string, unitCost: string | null) {
    return JSON.stringify({ expectedRevision: input.expectedRevision, observedAt: input.observedAt, instrument: { symbol: normalizeSymbol(input.instrument.symbol), name: input.instrument.name.trim(), market: input.instrument.market.trim().toUpperCase(), currency: input.instrument.currency.trim().toUpperCase(), assetType: input.instrument.assetType, instrumentKey: input.instrument.instrumentKey ?? null }, quantity, unitCost });
  }
  function buildHolding(data: Snapshot, input: HoldingInput) {
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(input.batchId ?? ''))) fail('INVALID_INPUT', '本次保存标识无效，请重新打开表单。');
    const quantity = holdingDecimal(input.quantity)!;
    const unitCost = holdingDecimal(input.unitCost, true);
    if (!Number.isSafeInteger(input.expectedRevision)) fail('REVISION_CONFLICT', '持仓版本无效，请刷新后重试。');
    if (!Number.isFinite(Date.parse(input.observedAt)) || new Date(input.observedAt).toISOString() !== input.observedAt || input.observedAt > runtime.now()) fail('INVALID_INPUT', '当前持仓日期无效。');
    const signature = holdingSignature(input, quantity, unitCost);
    const receipt = data.import_receipts.find(item => item.batch_id === input.batchId);
    if (receipt) {
      if (receipt.payload_signature !== signature) fail('IDEMPOTENCY_CONFLICT', '重复保存标识对应了不同内容，已拒绝冲突写入。');
      return { kind: 'already_applied' as const, candidate: data, receipt, contentToken: snapshotToken(data) };
    }
    guard(data, { contentToken: input.contentToken });
    if (input.expectedRevision !== data.revision) fail('REVISION_CONFLICT', '持仓已变化，请重新查看旧值和新值后确认。');
    const resolved = holdingAsset(data, input);
    const before = currentPositions(data).find(item => item.instrumentId === resolved.asset.id);
    // Zero-quantity history is retained after deletion but is not an active holding.
    if (before && calculated(before.quantity).gt(0) && !input.replaceApproved) fail('CONFIRM_REPLACE', '已有持仓必须明确确认旧值到新值。');
    if (!before && quantity === '0') fail('INVALID_INPUT', '新持仓数量必须大于零。');
    const baseline_heads = active(data).map(item => ({ record_id: item.record_id, revision_id: item.revision_id }));
    const checkpoint = { id: uniqueId(data, [resolved.asset.id]), instrument_id: resolved.asset.id, quantity, unit_cost: unitCost, observed_at: input.observedAt, baseline_heads, source: 'manual' as const, batch_id: input.batchId, history_coverage: before ? 'reconciled' as const : 'snapshot_only' as const };
    const resulting_revision = data.revision + 1;
    const nextReceipt = { batch_id: input.batchId, payload_signature: signature, resulting_revision };
    const candidate = validateCandidate({ ...data, instruments: resolved.instruments, holding_assets: resolved.holding_assets, holding_checkpoints: [...data.holding_checkpoints, checkpoint], import_receipts: [...data.import_receipts, nextReceipt], revision: resulting_revision });
    return { kind: 'commit' as const, candidate, receipt: nextReceipt, contentToken: snapshotToken(data) };
  }

  function buildHoldingImport(data: Snapshot, input: HoldingImportInput) {
    if (!/^[A-Za-z0-9_-]{8,80}$/.test(String(input.batchId ?? ''))) fail('INVALID_INPUT', '本次导入标识无效，请重新选择截图。');
    if (!Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 20) fail('INVALID_INPUT', '每次只能导入 1–20 项持仓。');
    if (!Number.isSafeInteger(input.expectedRevision)) fail('REVISION_CONFLICT', '持仓版本无效，请刷新后重试。');
    if (!Number.isFinite(Date.parse(input.observedAt)) || new Date(input.observedAt).toISOString() !== input.observedAt || input.observedAt > runtime.now()) fail('INVALID_INPUT', '当前持仓日期无效。');
    const normalized = input.rows.map(row => {
      const rowId = String(row.rowId ?? '').trim();
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(rowId)) fail('INVALID_INPUT', '识别行标识无效。');
      const screenshotMetrics = row.screenshotMetrics === undefined ? undefined : screenshotMetricsSchema.parse(row.screenshotMetrics);
      if (screenshotMetrics) for (const [field, value] of Object.entries(screenshotMetrics)) {
        if (value == null || value === '') continue;
        const text = value.trim();
        const percent = field === 'holdingReturnRateText' || field === 'dailyChangeRateText';
        if (field === 'navDateText') continue;
        if (!(percent ? /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/ : /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/).test(text)) fail('INVALID_INPUT', '请核对截图中的金额、净值和百分比。');
        if ((field === 'marketValueText' || field === 'navText') && text.startsWith('-')) fail('INVALID_INPUT', '持有金额和净值不能为负数。');
      }
      return { ...row, screenshotMetrics, rowId, quantity: holdingDecimal(row.quantity)!, unitCost: holdingDecimal(row.unitCost, true) };
    });
    if (new Set(normalized.map(row => row.rowId)).size !== normalized.length) fail('INVALID_INPUT', '识别结果包含重复行。');
    const identities = normalized.map(row => `${normalizeSymbol(row.instrument.symbol)}|${String(row.instrument.market).trim().toUpperCase()}|${String(row.instrument.currency).trim().toUpperCase()}`);
    if (new Set(identities).size !== identities.length) fail('DUPLICATE_INSTRUMENT', '同一截图中存在重复标的，请只保留正确的一行，不会自动相加。');
    const signature = sha256(JSON.stringify({ expectedRevision: input.expectedRevision, observedAt: input.observedAt, rows: normalized.map(row => ({ rowId: row.rowId, instrument: { symbol: normalizeSymbol(row.instrument.symbol), name: row.instrument.name.trim(), market: row.instrument.market.trim().toUpperCase(), currency: row.instrument.currency.trim().toUpperCase(), assetType: row.instrument.assetType, instrumentKey: row.instrument.instrumentKey ?? null }, quantity: row.quantity, unitCost: row.unitCost, replaceApproved: !!row.replaceApproved, costRemovalApproved: !!row.costRemovalApproved, ...(row.screenshotMetrics ? { screenshotMetrics: row.screenshotMetrics } : {}) })) }));
    const receipt = data.import_receipts.find(item => item.batch_id === input.batchId);
    if (receipt) {
      if (receipt.payload_signature !== signature) fail('IDEMPOTENCY_CONFLICT', '本次导入内容已变化，请重新检查。');
      const current = new Map(currentPositions(data).map(item => [item.instrumentId, item]));
      const rows = data.holding_checkpoints.filter(item => item.batch_id === input.batchId).map(item => { const value = current.get(item.instrument_id); const result = { quantity: value?.quantity ?? item.quantity, unitCost: value?.unitCost ?? item.unit_cost }; return { rowId: item.id, instrumentId: item.instrument_id, before: result, after: result }; });
      return { kind: 'already_applied' as const, candidate: data, receipt, rows, contentToken: snapshotToken(data) };
    }
    guard(data, { contentToken: input.contentToken });
    if (input.expectedRevision !== data.revision) fail('REVISION_CONFLICT', '持仓刚刚有变化，请确认本次更新差异。');
    const beforeRows = new Map(currentPositions(data).map(item => [item.instrumentId, item]));
    const baseline_heads = active(data).map(item => ({ record_id: item.record_id, revision_id: item.revision_id }));
    let candidate = data;
    const checkpoints: Snapshot['holding_checkpoints'] = [];
    const previews: Array<{ rowId: string; before: { quantity: string; unitCost: string | null }; after: { quantity: string; unitCost: string | null }; instrumentId: string }> = [];
    for (const row of normalized) {
      const resolved = holdingAsset(candidate, { batchId: input.batchId, expectedRevision: input.expectedRevision, observedAt: input.observedAt, instrument: row.instrument, quantity: row.quantity, unitCost: row.unitCost });
      const before = beforeRows.get(resolved.asset.id);
      if (before && calculated(before.quantity).gt(0) && !row.replaceApproved) fail('CONFIRM_REPLACE', `已有持仓 ${resolved.asset.symbol} 必须明确确认旧值到新值。`);
      if (!before && row.quantity === '0') fail('INVALID_INPUT', '新持仓数量必须大于零。');
      let unitCost = row.unitCost;
      if (before && unitCost === null && row.quantity === before.quantity) unitCost = before.unitCost;
      if (before && before.unitCost !== null && unitCost === null && row.quantity !== before.quantity && !row.costRemovalApproved) fail('CONFIRM_COST_UNKNOWN', `${resolved.asset.symbol} 数量已变化且成本将从已知变为未知，请明确确认。`);
      const checkpoint = { id: uniqueId(candidate, [resolved.asset.id, ...checkpoints.map(item => item.id)]), instrument_id: resolved.asset.id, quantity: row.quantity, unit_cost: unitCost, observed_at: input.observedAt, baseline_heads, source: 'screenshot' as const, ...(row.screenshotMetrics ? { screenshot_metrics: row.screenshotMetrics } : {}), batch_id: input.batchId, history_coverage: before ? 'reconciled' as const : 'snapshot_only' as const };
      checkpoints.push(checkpoint);
      previews.push({ rowId: row.rowId, instrumentId: resolved.asset.id, before: { quantity: before?.quantity ?? '0', unitCost: before?.unitCost ?? null }, after: { quantity: row.quantity, unitCost } });
      candidate = { ...candidate, instruments: resolved.instruments, holding_assets: resolved.holding_assets, holding_checkpoints: [...candidate.holding_checkpoints, checkpoint] };
    }
    const resulting_revision = data.revision + 1;
    const nextReceipt = { batch_id: input.batchId, payload_signature: signature, resulting_revision };
    candidate = validateCandidate({ ...candidate, import_receipts: [...candidate.import_receipts, nextReceipt], revision: resulting_revision });
    return { kind: 'commit' as const, candidate, receipt: nextReceipt, rows: previews, contentToken: snapshotToken(data) };
  }

  function overview(cutoff?: { throughDate: string; knownAt: string }, requestedCurrency?: string) {
    const data = repo.read(), projected = cutoff ? projection(data, runtime, { through_date: cutoff.throughDate, known_at: cutoff.knownAt }) : projection(data, runtime), state = clockState(data, runtime);
    const current = currentPositions(data, projected).filter(item => calculated(item.quantity).gt(0));
    const assetById = new Map(data.holding_assets.map(item => [item.id, item]));
    const currencyOf = (id: string) => assetById.get(id)?.currency ?? 'USD';
    const currencies = [...new Set(current.map(item => currencyOf(item.instrumentId)))].sort();
    const selectedCurrency = requestedCurrency && currencies.includes(requestedCurrency) ? requestedCurrency : currencies.includes('CNY') ? 'CNY' : currencies[0] ?? data.portfolio.base_currency;
    const held = current.filter(item => currencyOf(item.instrumentId) === selectedCurrency);
    const instruments = held.map(item => data.instruments.find(candidate => candidate.id === item.instrumentId)).filter((item): item is Snapshot['instruments'][number] => !!item);
    const market = marketClient.snapshot(instruments), { observations: _marketObservations, ...marketView } = market;
    const valuation = valuePortfolio(projected, data.mode === 'demo' ? [] : market.observations, { as_of: projected.known_at, max_age_ms: 20 * 60 * 1000 });
    const valued = new Map(valuation.positions.map(item => [item.instrument_id, item]));
    const observations = new Map(market.observations.map(item => [item.instrument_id, item]));
    const positions = held.map(item => { const legacy = data.instruments.find(candidate => candidate.id === item.instrumentId), asset = assetById.get(item.instrumentId), value = valued.get(item.instrumentId), observation = observations.get(item.instrumentId), marketRow = market.instruments.find(candidate => candidate.id === item.instrumentId); const marketPrice = value?.quote?.price ?? observation?.price ?? null; const marketValue = marketPrice ? money(decimal(item.quantity).times(marketPrice).toString()) : null; const unrealized = marketValue !== null && item.remainingCost !== null ? money(calculated(marketValue).minus(item.remainingCost).toString()) : null; return { id: item.instrumentId, name: asset?.name ?? legacy?.symbol ?? '', symbol: asset?.symbol ?? legacy?.symbol ?? '', market: asset?.market ?? 'US', currency: asset?.currency ?? 'USD', status: asset?.status ?? 'verified', assetType: asset?.asset_type ?? legacy?.asset_type ?? 'ETF', quantity: item.quantity, cost: item.remainingCost === null ? null : money(item.remainingCost), unitCost: item.unitCost ? calculated(item.unitCost).toFixed(4) : null, realized: item.realized === null ? null : money(item.realized), marketPrice, marketValue, unrealized, weightExCash: value?.position_weight_ex_cash ? `${calculated(value.position_weight_ex_cash).times(100).toFixed(2)}%` : null, quoteAsOf: value?.quote?.as_of ?? observation?.as_of ?? null, quoteFreshness: marketRow?.stale ? 'stale' : marketPrice ? 'current' : 'unavailable', mappingStatus: marketRow?.mapping ?? 'not_found', attribution: marketRow?.quote?.attribution ?? '', screenshotMetrics: item.checkpoint?.screenshot_metrics ?? null, screenshotImportedAt: item.checkpoint?.screenshot_metrics ? item.checkpoint.observed_at : null, checkpoint: !!item.checkpoint, checkpointConflict: item.checkpointConflict }; });
    // Display totals use the same quote-first, screenshot-second values as holding cards.
    // Keep market valuation fields separate: screenshot observations are not live quotes.
    const displayTotal = (live: 'marketValue' | 'unrealized', saved: 'marketValueText' | 'holdingPnlText') => {
      let sum = decimal('0'), covered = 0, screenshots = 0;
      for (const item of positions) {
        const fromScreenshot = item[live] === null;
        const raw = fromScreenshot ? item.screenshotMetrics?.[saved] : item[live];
        if (raw == null || raw.trim() === '') continue;
        const text = raw.trim().replace(/,/g, '').replace(/^\+/, '');
        if (!/^-?\d+(?:\.\d+)?$/.test(text)) continue;
        sum = sum.plus(text); covered++; if (fromScreenshot) screenshots++;
      }
      return { value: covered ? sum.toFixed(2) : null, covered, screenshots, partial: covered > 0 && covered < positions.length };
    };
    const displayAmount = displayTotal('marketValue', 'marketValueText');
    const displayPnl = displayTotal('unrealized', 'holdingPnlText');
    const completeMarket = positions.length > 0 && positions.every(item => item.marketValue !== null);
    const marketValue = completeMarket ? money(positions.reduce((sum, item) => sum.plus(item.marketValue!), decimal('0')).toString()) : null;
    const completePnl = completeMarket && positions.every(item => item.unrealized !== null);
    const unrealizedPnl = completePnl ? money(positions.reduce((sum, item) => sum.plus(item.unrealized!), decimal('0')).toString()) : null;
    return { mode: data.mode, positions, currencies, selectedCurrency, totalCost: money(held.reduce((sum, item) => item.remainingCost === null ? sum : sum.plus(item.remainingCost), decimal('0')).toString()), realized: money(projected.realized_pnl), cash: projected.cash, unrealizedPnl,
      displayAmount, displayPnl, displayIncludesScreenshots: displayAmount.screenshots > 0 || displayPnl.screenshots > 0, marketValue, coveredMarketValue: positions.some(item => item.marketValue !== null) ? money(positions.reduce((sum, item) => item.marketValue === null ? sum : sum.plus(item.marketValue), decimal('0')).toString()) : null, netValue: null, market: { ...marketView, total: positions.length, covered: positions.filter(item => item.marketValue !== null).length }, tradeCount: projected.input_head.filter(item => !item.voided && data.events.some(event => event.revision_id === item.revision_id && (event.kind === 'buy' || event.kind === 'sell'))).length, reviewCount: data.reviews.filter(item => item.date <= projected.through_date && Date.parse(item.updated_at) <= Date.parse(projected.known_at)).length,
      clockAnomaly: state.clock_anomaly, throughDate: projected.through_date, knownAt: projected.known_at };
  }
  function positionDetail(idOrSymbol: string) {
    const data = repo.read(), normalized = idOrSymbol.trim().toUpperCase();
    const asset = data.holding_assets.find(item => item.id === idOrSymbol || item.symbol === normalized), instrument = data.instruments.find(item => item.id === (asset?.id ?? idOrSymbol) || item.symbol === normalized);
    if (!asset && !instrument) return fail('NOT_FOUND', '标的不存在。');
    const id = asset?.id ?? instrument!.id, projected = currentPositions(data).find(item => item.instrumentId === id), related = active(data).filter(item => 'instrument_id' in item && item.instrument_id === id).sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.sequence - a.sequence), opening = related.find(item => item.kind === 'opening_position' && !item.voided);
    const time = clockState(data, runtime);
    const currency = asset?.currency ?? 'USD', priced = overview(undefined, currency).positions.find(item => item.id === id), marketIdentity = instrument ? marketClient.snapshot([instrument]).instruments[0]?.canonicalInstrument ?? null : null;
    return { clockAnomaly: time.clock_anomaly, throughDate: time.through_date, knownAt: time.known_at, id, name: asset?.name ?? instrument!.symbol, symbol: asset?.symbol ?? instrument!.symbol, currency, market: asset?.market ?? 'US', status: asset?.status ?? 'verified', assetType: asset?.asset_type ?? instrument!.asset_type, quantity: projected?.quantity ?? '0', cost: projected?.remainingCost === null ? null : money(projected?.remainingCost ?? '0'), unitCost: projected?.unitCost ? calculated(projected.unitCost).toFixed(4) : null, realized: projected?.realized === null ? null : money(projected?.realized ?? '0'), marketPrice: priced?.marketPrice ?? null, marketValue: priced?.marketValue ?? null, unrealized: priced?.unrealized ?? null, weightExCash: priced?.weightExCash ?? null, quoteAsOf: priced?.quoteAsOf ?? null, quoteFreshness: priced?.quoteFreshness ?? 'unavailable', mappingStatus: priced?.mappingStatus ?? 'not_found', attribution: priced?.attribution ?? '', screenshotMetrics: priced?.screenshotMetrics ?? null, screenshotImportedAt: priced?.screenshotImportedAt ?? null, marketIdentity, opening: opening ? row(data, opening) : null, records: related.map(item => row(data, item)), reasons: related.map(item => item.note).filter(Boolean), checkpoint: !!projected?.checkpoint, checkpointConflict: projected?.checkpointConflict ?? false };
  }
  function journalTimeline(date: string) {
    const state = workspace.read(), runs = new Map(state.runs.map(item => [item.id, item]));
    const journal = workspace.timeline(date).map(item => {
      if (item.type === 'analysis_ref') { const run = runs.get(item.ref_id!)!; return { kind: 'analysis' as const, id: item.id, revisionId: item.revision_id, runId: run.id, conversationId: run.conversation_id, summary: run.result.summary, stance: String(run.result.stance ?? 'insufficient_data'), demo: run.execution_kind === 'fake', label: run.execution_kind === 'fake' ? '离线合成 AI 分析' : '模型生成分析', time: item.updated_at }; }
      return { kind: item.type === 'user_decision' ? 'user_decision' as const : 'personal_note' as const, id: item.id, revisionId: item.revision_id, body: item.body ?? '', label: item.type === 'user_decision' ? '我的决定' : '我的记录', time: item.updated_at };
    });
    const trades = records().filter(item => item.date === date).map(item => ({ kind: 'trade' as const, id: item.id, revisionId: item.revisionId, symbol: item.symbol, label: item.label, quantity: item.quantity, note: item.note, time: item.recordedAt }));
    return [...journal, ...trades].sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
  }

  const service = {
    pendingSave: repo.pendingSave, pendingIdentity: repo.pendingIdentity, verifyPending: repo.verifyPending, retryPending: repo.retryPending,
    snapshot: repo.read, generation: repo.generation, records, availableQuantity,
    journal: () => workspace,
    workspacePending: workspace.pendingSave, verifyWorkspacePending: workspace.verifyPending, retryWorkspacePending: workspace.retryPending,
    journalTimeline,
    async refreshMarket() { const data = repo.read(), heldIds = new Set(currentPositions(data).filter(item => calculated(item.quantity).gt(0)).map(item => item.instrumentId)); await marketClient.refresh(data.instruments.filter(item => heldIds.has(item.id))); },
    invalidateMarketRequest: marketClient.invalidate,
    clearMarketCache: marketClient.clear,
    searchMarket: marketDiscovery.search,
    cancelMarketSearch: marketDiscovery.cancelSearch,
    marketDiscovery: marketDiscovery.view,
    addWatchlist: marketDiscovery.add,
    removeWatchlist: marketDiscovery.remove,
    marketBars: marketDiscovery.loadBars,
    vision: () => options.visionTransport,
    async prepareAnalysisMarket(mode: 'portfolio_review' | 'instrument_research' | 'daily_review' | 'follow_up', symbol?: string) {
      if (!options.marketTransport?.prepareAnalysisSnapshot) return null;
      const data = repo.read(), projected = projection(data, runtime);
      const heldIds = new Set(projected.positions.filter(item => calculated(item.quantity).gt(0)).map(item => item.instrument_id));
      const ledger = data.instruments.filter(item => heldIds.has(item.id)), mapped = marketClient.snapshot(ledger).instruments;
      let keys = mapped.map(item => item.instrumentKey).filter((key): key is string => !!key);
      if (symbol) {
        const normalized = symbol.trim().toUpperCase();
        const selected = [...marketDiscovery.view().results, ...marketDiscovery.view().watchlist].find(item => item.symbol === normalized);
        keys = selected ? [selected.instrument_key] : mapped.filter(item => item.symbol === normalized).map(item => item.instrumentKey).filter((key): key is string => !!key);
      }
      keys = [...new Set(keys)];
      if (!keys.length) return null;
      return options.marketTransport.prepareAnalysisSnapshot(keys, mode);
    },
    ai: () => aiEngine ??= createAiEngine(workspace, { snapshot: repo.read, overview, records, positionDetail }, runtime, options.aiTransport, options.fakeProvider),
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
    previewHolding(input: HoldingInput) { repo.assertWritable(); const data = repo.read(), built = buildHolding(data, input); if (built.kind === 'already_applied') { const row = currentPositions(data).find(item => data.import_receipts.some(receipt => receipt.batch_id === input.batchId) && data.holding_checkpoints.some(checkpoint => checkpoint.batch_id === input.batchId && checkpoint.instrument_id === item.instrumentId)); return { before: { quantity: row?.quantity ?? '0', unitCost: row?.unitCost ?? null }, after: { quantity: row?.quantity ?? '0', unitCost: row?.unitCost ?? null }, createsTrade: false, alreadyApplied: true, contentToken: built.contentToken }; } const next = currentPositions(built.candidate).find(item => built.candidate.holding_checkpoints.at(-1)?.instrument_id === item.instrumentId)!; const prior = currentPositions(data).find(item => item.instrumentId === next.instrumentId); return { before: { quantity: prior?.quantity ?? '0', unitCost: prior?.unitCost ?? null }, after: { quantity: next.quantity, unitCost: next.unitCost }, createsTrade: false, alreadyApplied: false, contentToken: built.contentToken }; },
    saveHolding(input: HoldingInput) { repo.assertWritable(); const data = repo.read(), built = buildHolding(data, input); if (built.kind === 'already_applied') return { kind: 'already_applied' as const, revision: built.receipt.resulting_revision }; repo.write(built.candidate); return { kind: 'committed' as const, revision: built.receipt.resulting_revision }; },
    previewHoldingImport(input: HoldingImportInput) { repo.assertWritable(); const built = buildHoldingImport(repo.read(), input); return { rows: built.rows, createsTrade: false, alreadyApplied: built.kind === 'already_applied', contentToken: built.contentToken }; },
    saveHoldingImport(input: HoldingImportInput) { repo.assertWritable(); const built = buildHoldingImport(repo.read(), input); if (built.kind === 'already_applied') return { kind: 'already_applied' as const, revision: built.receipt.resulting_revision, imported: built.rows.length }; repo.write(built.candidate); return { kind: 'committed' as const, revision: built.receipt.resulting_revision, imported: built.rows.length }; },
    overview,
    revisionHistory(id: string) {
      const data = repo.read(), latest = head(data, id);
      if (!latest) return fail('NOT_FOUND', '记录不存在。');
      const revisions = new Map(data.events.map(item => [item.revision_id, item]));
      const chain: LedgerEvent[] = [];
      let current: LedgerEvent | undefined = latest;
      while (current) { chain.push(current); current = current.parent_revision ? revisions.get(current.parent_revision) : undefined; }
      return chain.reverse().map(item => ({ ...row(data, item), current: item.revision_id === latest.revision_id }));
    },
    positionDetail,
    voidTrade(id: string, expectedRevision?: string) {
      const data = repo.read(); checkDate(data, runtime.today()); const event = head(data, id); if (!event || event.voided) fail('NOT_FOUND', '记录不存在或已经作废。'); if (expectedRevision && expectedRevision !== event.revision_id) fail('STALE_REVISION', '该记录已被更正，请刷新后重试。');
      if (data.holding_checkpoints.some(item => item.baseline_heads.some(head => head.record_id === id))) fail('CHECKPOINT_CONFLICT', '该交易已包含在持仓校准中；请先重新校准当前持仓，不能静默改写。');
      const revised = parseEvent({ ...event, revision_id: uniqueId(data), parent_revision: event.revision_id, recorded_at: runtime.now(), provenance: { ...event.provenance, confirmed_at: runtime.now() }, voided: true }); repo.write(validateCandidate({ ...data, events: [...data.events, revised], revision: data.revision + 1 }));
    },
    saveReview(date: string, text: string) { const data = repo.read(); checkDate(data, date); const trimmed = text.trim(); if (!trimmed || trimmed.length > 4000) fail('INVALID_INPUT', '请填写 1–4000 字的复盘内容。'); repo.write({ ...data, reviews: [...data.reviews.filter(item => item.date !== date), { date, text: trimmed, updated_at: runtime.now() }].sort((a, b) => b.date.localeCompare(a.date)) }); },
    exportBackup: repo.exportBackup, exportRaw: repo.exportRaw,
    previewBackup(text: string) { const data = repo.parseBackup(text); return { openings: active(data).filter(item => !item.voided && item.kind === 'opening_position').length, trades: active(data).filter(item => !item.voided && (item.kind === 'buy' || item.kind === 'sell')).length, reviews: data.reviews.length, mode: data.mode }; },
    exportFullBackup() { return encodeFullBackup(repo.read(), workspace.read(), runtime, marketDiscovery.exportWatchlist()); },
    previewCompleteBackup(text: string) { return backupPreview(parseCompleteBackup(text, runtime), runtime); },
    restoreCompleteBackup(text: string) { const parsed = parseCompleteBackup(text, runtime); const prepared = workspace.prepareReplacement(parsed.workspace, parsed.financial); repo.replace(parsed.financial); prepared.commit(); marketDiscovery.replaceWatchlist(parsed.watchlist); marketClient.clear(); },
    restoreBackup(text: string) { const financial = repo.parseBackup(text); const prepared = workspace.prepareReplacement(undefined, financial); repo.replace(financial); prepared.commit(); },
    recoverPrevious() { const financial = repo.readPrevious(), previousWorkspace = workspace.readPreviousOptional(), prepared = workspace.prepareReplacement(previousWorkspace, financial); repo.recoverPrevious(); prepared.commit(); },
    loadDemo() {
      if (!options.demoFactory) throw Error('当前构建不提供示例数据。');
      const data = repo.read(); if (data.events.length || data.reviews.length || data.mode === 'demo') fail('NOT_EMPTY', '只有空账本可以载入示例。');
      const next = options.demoFactory(runtime); const prepared = workspace.prepareReplacement(undefined, next); repo.replace(next); prepared.commit();
    },
    startEmpty() { const next = emptySnapshot(runtime), prepared = workspace.prepareReplacement(undefined, next); repo.replace(next); prepared.commit(); },
    deleteAllLocalData() { workspace.purge(); repo.purge(); marketClient.clear(); marketDiscovery.replaceWatchlist([]); },
  };
  return service;
}
