import { z } from 'zod';
import { portfolioSchema, instrumentSchema, ledgerEventSchema, idSchema, dateSchema, timestampSchema, projectLedger } from '@portfolio/domain';

export const snapshotSchema = z.strictObject({
  version: z.literal(1), mode: z.enum(['personal', 'demo']), device_id: idSchema,
  portfolio: portfolioSchema, instruments: z.array(instrumentSchema).max(500),
  events: z.array(ledgerEventSchema).max(2000),
  reviews: z.array(z.strictObject({ date: dateSchema, text: z.string().min(1).max(4000), updated_at: timestampSchema })).max(1000),
});
export const backupSchema = z.strictObject({ format: z.literal('portfolio-wechat-backup'), version: z.literal(1), data: snapshotSchema });
export type Snapshot = z.infer<typeof snapshotSchema>;
export type Runtime = { now(): string; today(): string; id(): string };
export const MAX_BYTES = 800 * 1024;
export function utf8Size(value: string) {
  let size = 0;
  for (const char of value) { const n = char.codePointAt(0)!; size += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4; }
  return size;
}
export function assertSize(text: string) { if (utf8Size(text) > MAX_BYTES) throw Error('数据过大，测试版最多保存 800 KiB，请先导出备份。'); }
export function emptySnapshot(runtime: Runtime): Snapshot {
  return { version: 1, mode: 'personal', device_id: runtime.id(),
    portfolio: { schema_version: 1, id: runtime.id(), name: '我的交易日记', base_currency: 'USD', timezone: 'Asia/Shanghai', cash_state: 'unknown', history_complete: false, cost_method: 'opening_aggregate_then_fifo', opening_date: '1970-01-01' },
    instruments: [], events: [], reviews: [] };
}
const errors: Record<string, string> = {
  oversell: '卖出数量超过当时持仓；请检查日期、数量或后续卖出记录。',
  invalid_schema: '记录格式不正确，请检查金额、日期和标的。',
  order_conflict: '同日记录顺序冲突，请检查备份。',
  revision_conflict: '记录存在冲突版本，不能自动选择。',
};
export function validateSnapshot(input: unknown, runtime: Runtime): Snapshot {
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) throw Error('账本格式不正确或版本不受支持。');
  const data = parsed.data;
  const instrumentIds = new Set(data.instruments.map(i => i.id));
  if (data.events.some(e => "instrument_id" in e && !instrumentIds.has(e.instrument_id))) throw Error("记录引用的标的不存在，包括已作废的历史记录。");
  if (data.portfolio.cash_state !== 'unknown' || data.portfolio.history_complete || data.portfolio.timezone !== 'Asia/Shanghai') throw Error('当前测试版仅支持现金未知、历史不完整的本地账本。');
  if (new Set(data.instruments.map(i => i.symbol)).size !== data.instruments.length || new Set(data.reviews.map(r => r.date)).size !== data.reviews.length) throw Error('备份存在重复标的或复盘日期。');
  if (data.events.some(e => !['buy', 'sell'].includes(e.kind) || e.trade_date > runtime.today() || Date.parse(e.recorded_at) > Date.parse(runtime.now()))) throw Error('备份包含未来日期或当前测试版不支持的交易类型。');
  if (data.reviews.some(r => r.date > runtime.today() || Date.parse(r.updated_at) > Date.parse(runtime.now()))) throw Error('复盘不能使用未来日期。');
  const result = projectLedger(data.portfolio, data.instruments, data.events, { through_date: runtime.today(), known_at: runtime.now() });
  if (!result.ok) throw Error(errors[result.error.code] ?? `账本校验失败：${result.error.code}`);
  return data;
}
export function projection(data: Snapshot, runtime: Runtime) {
  const result = projectLedger(data.portfolio, data.instruments, data.events, { through_date: runtime.today(), known_at: runtime.now() });
  if (!result.ok) throw Error(errors[result.error.code] ?? `账本校验失败：${result.error.code}`);
  return result.value;
}
