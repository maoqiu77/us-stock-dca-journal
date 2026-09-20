import { z } from 'zod';
// Separate from the licensed US quote API: admitting a fact never enables a provider.
const positive = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(value => Number.isFinite(Number(value)) && Number(value) > 0);
export const referenceFactSchema = z.strictObject({
  instrumentId: z.string().min(1), currency: z.string().min(3).max(8), kind: z.enum(['market_price', 'nav', 'iopv']),
  value: positive.nullable(), asOf: z.string().datetime({ offset: true }), fetchedAt: z.string().datetime({ offset: true }),
  tradeDate: z.string().date().optional(), valuationDate: z.string().date().optional(), sourceId: z.string().min(1),
  quality: z.enum(['available', 'stale', 'missing', 'error']),
});
export function premiumView(priceInput: unknown, referenceInput: unknown, maxSkewMs = 120000) {
  const unavailable = (reason: string) => ({ valuePct: null, label: '--', reason, referenceDate: null });
  const p = referenceFactSchema.safeParse(priceInput), r = referenceFactSchema.safeParse(referenceInput);
  if (!p.success || !r.success) return unavailable('INVALID_FACT');
  const price = p.data, reference = r.data;
  if (price.kind !== 'market_price' || !['nav', 'iopv'].includes(reference.kind) || price.instrumentId !== reference.instrumentId || price.currency !== reference.currency || !price.value || !reference.value || price.quality !== 'available' || reference.quality !== 'available') return unavailable('NOT_COMPARABLE');
  if (!price.tradeDate) return unavailable('MISSING_TRADE_DATE');
  if (reference.kind === 'iopv' && (reference.tradeDate !== price.tradeDate || Math.abs(Date.parse(price.asOf) - Date.parse(reference.asOf)) > maxSkewMs)) return unavailable('IOPV_TIME_MISMATCH');
  if (reference.kind === 'nav' && (!reference.valuationDate || reference.valuationDate > price.tradeDate || Date.parse(reference.asOf) > Date.parse(price.asOf))) return unavailable('INVALID_NAV_DATE');
  const valuePct = (Number(price.value) / Number(reference.value) - 1) * 100;
  if (!Number.isFinite(valuePct)) return unavailable('INVALID_RATIO');
  return { valuePct, label: reference.kind === 'nav' ? '相对已公布净值（非实时）' : '相对同期 IOPV', reason: null, referenceDate: reference.valuationDate ?? reference.asOf };
}
