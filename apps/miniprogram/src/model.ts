import { z } from 'zod';
import { portfolioSchema, instrumentSchema, ledgerEventSchema, idSchema, dateSchema, timestampSchema, projectLedger, type LedgerEvent, type ProjectionCutoff } from '@portfolio/domain';

const reviewSchema = z.strictObject({ date: dateSchema, text: z.string().min(1).max(4000), updated_at: timestampSchema });
const snapshotFields = { mode: z.enum(['personal', 'demo']), device_id: idSchema, portfolio: portfolioSchema,
  instruments: z.array(instrumentSchema).max(500), reviews: z.array(reviewSchema).max(1000) };
const supportedEvents = (kinds: readonly string[]) => z.array(ledgerEventSchema).max(2000).superRefine((events, context) => {
  events.forEach((event, index) => { if (!kinds.includes(event.kind)) context.addIssue({ code: 'custom', path: [index, 'kind'], message: 'unsupported_event_kind' }); });
});
export const snapshotV1Schema = z.strictObject({ version: z.literal(1), ...snapshotFields, events: supportedEvents(['buy', 'sell']) });
export const snapshotSchema = z.strictObject({ version: z.literal(2), ...snapshotFields, events: supportedEvents(['opening_position', 'buy', 'sell']) });
export const backupV1Schema = z.strictObject({ format: z.literal('portfolio-wechat-backup'), version: z.literal(1), data: snapshotV1Schema });
export const backupSchema = z.strictObject({ format: z.literal('portfolio-wechat-backup'), version: z.literal(2), data: snapshotSchema });
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Runtime = { now(): string; today(): string; id(): string };
export type ValidationOptions = { external?: boolean };
export const MAX_BYTES = 800 * 1024;
export function utf8Size(value: string) { let size = 0; for (const char of value) { const n = char.codePointAt(0)!; size += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4; } return size; }
export function assertSize(text: string) { if (utf8Size(text) > MAX_BYTES) throw Error('数据过大，测试版最多保存 800 KiB，请先导出备份。'); }
export function emptySnapshot(runtime: Runtime): Snapshot {
  return { version: 2, mode: 'personal', device_id: runtime.id(), portfolio: { schema_version: 1, id: runtime.id(), name: '我的交易日记', base_currency: 'USD', timezone: 'Asia/Shanghai', cash_state: 'unknown', history_complete: false, cost_method: 'opening_aggregate_then_fifo', opening_date: '1970-01-01' }, instruments: [], events: [], reviews: [] };
}
export function migrateV1Snapshot(input: z.infer<typeof snapshotV1Schema>): Snapshot { return snapshotSchema.parse({ ...input, version: 2 }); }

const errors: Record<string, string> = { oversell: '卖出数量超过当时持仓，请核对该日期前后的数量和同日顺序，调整后重新预览', invalid_schema: '记录格式不正确', order_conflict: '同日记录顺序冲突', revision_conflict: '记录存在冲突版本', revision_collision: '版本编号与不同内容碰撞', missing_parent_revision: '记录缺少上一个版本', invalid_revision_parent: '记录版本关系无效', invalid_opening_position: '期初持仓日期或顺序无效', event_before_opening: '记录早于账本期初日期' };
function timestamps(data: Snapshot) { return [...data.instruments.map(i => i.confirmed_at), ...data.events.flatMap(e => [e.recorded_at, e.provenance.confirmed_at, ...(e.executed_at ? [e.executed_at] : [])]), ...data.reviews.map(r => r.updated_at)]; }
function maximum(values: string[], fallback: string) { return values.reduce((max, value) => Date.parse(value) > Date.parse(max) ? value : max, fallback); }
function structuralCutoff(data: Snapshot): ProjectionCutoff { const eventDate = data.events.reduce((max, event) => event.trade_date > max ? event.trade_date : max, data.portfolio.opening_date); return { through_date: data.reviews.reduce((max, review) => review.date > max ? review.date : max, eventDate), known_at: maximum(timestamps(data), '1970-01-01T00:00:00.000Z') }; }
function eventDetail(data: Snapshot, recordId?: string) {
  const revisions = data.events.filter(item => item.record_id === recordId);
  const parents = new Set(revisions.map(item => item.parent_revision));
  // A clock can record several revisions at the same instant; follow ancestry,
  // not timestamp/sequence sorting, when naming the conflicting current fact.
  const event = revisions.find(item => !parents.has(item.revision_id)) ?? revisions[0];
  const symbol = event && 'instrument_id' in event ? data.instruments.find(item => item.id === event.instrument_id)?.symbol : undefined;
  return [recordId && `记录 ${recordId}`, event?.trade_date && `日期 ${event.trade_date}`, symbol && `标的 ${symbol}`].filter(Boolean).join('，');
}
function projectOrThrow(data: Snapshot, cutoff: ProjectionCutoff) {
  const result = projectLedger(data.portfolio, data.instruments, data.events, cutoff);
  if (!result.ok) { const detail = eventDetail(data, result.error.record_id); throw Error(`${errors[result.error.code] ?? `账本校验失败：${result.error.code}`}${detail ? `；${detail}` : ''}。`); }
  return result.value;
}
function assertExternalTime(data: Snapshot, runtime: Runtime) {
  const now = Date.parse(runtime.now());
  if (data.portfolio.opening_date > runtime.today()) throw Error(`外部备份包含未来账本期初日期 ${data.portfolio.opening_date}。`);
  for (const instrument of data.instruments) if (Date.parse(instrument.confirmed_at) > now) throw Error(`外部备份包含未来确认时间 ${instrument.confirmed_at}；标的 ${instrument.symbol}。`);
  for (const event of data.events) { const symbol = 'instrument_id' in event ? data.instruments.find(i => i.id === event.instrument_id)?.symbol ?? '未知' : '无'; const future = [event.recorded_at, event.provenance.confirmed_at, event.executed_at].filter((v): v is string => !!v).find(v => Date.parse(v) > now); if (event.trade_date > runtime.today() || future) throw Error(`外部备份记录 ${event.record_id} 包含未来日期 ${event.trade_date}${future ? ` / ${future}` : ''}；标的 ${symbol}。`); }
  for (const review of data.reviews) if (review.date > runtime.today() || Date.parse(review.updated_at) > now) throw Error(`外部备份包含未来复盘日期 ${review.date}。`);
}
export function validateSnapshot(input: unknown, runtime: Runtime, options: ValidationOptions = {}): Snapshot {
  const parsed = snapshotSchema.safeParse(input); if (!parsed.success) throw Error('账本格式不正确或版本不受支持。'); const data = parsed.data;
  const ids = new Set(data.instruments.map(i => i.id)); const dangling = data.events.find(e => 'instrument_id' in e && !ids.has(e.instrument_id));
  if (dangling) throw Error(`记录引用的标的不存在；记录 ${dangling.record_id}，日期 ${dangling.trade_date}。`);
  if (data.portfolio.cash_state !== 'unknown' || data.portfolio.history_complete || data.portfolio.timezone !== 'Asia/Shanghai') throw Error('当前测试版仅支持现金未知、历史不完整的本地账本。');
  if (new Set(data.instruments.map(i => i.symbol)).size !== data.instruments.length) throw Error('备份存在重复标的代码。');
  if (new Set(data.reviews.map(r => r.date)).size !== data.reviews.length) throw Error('备份存在重复复盘日期。');
  projectOrThrow(data, structuralCutoff(data)); if (options.external) assertExternalTime(data, runtime); return data;
}
export function clockState(data: Snapshot, runtime: Runtime) { const cutoff = structuralCutoff(data); const through_date = cutoff.through_date > runtime.today() ? cutoff.through_date : runtime.today(); const known_at = Date.parse(cutoff.known_at) > Date.parse(runtime.now()) ? cutoff.known_at : runtime.now(); return { clock_anomaly: cutoff.through_date > runtime.today() || Date.parse(cutoff.known_at) > Date.parse(runtime.now()), through_date, known_at }; }
export function projection(data: Snapshot, runtime: Runtime, cutoff?: ProjectionCutoff) { const selected = cutoff ?? clockState(data, runtime); return projectOrThrow(data, { through_date: selected.through_date, known_at: selected.known_at }); }
export function activeEvents(data: Snapshot, runtime: Runtime): LedgerEvent[] { const heads = new Set(projection(data, runtime).input_head.map(head => head.revision_id)); const unique = new Map(data.events.map(event => [event.revision_id, event])); return [...heads].map(id => unique.get(id)!).sort((a, b) => b.trade_date.localeCompare(a.trade_date) || b.sequence - a.sequence || a.record_id.localeCompare(b.record_id)); }
