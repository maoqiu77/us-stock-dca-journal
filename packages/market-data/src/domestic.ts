import { z } from 'zod';
const decimal = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/).refine(value => Number.isFinite(Number(value)) && Number(value) > 0);
export const domesticInstrumentSchema = z.strictObject({
  instrument_key: z.string().regex(/^CN:(XSHG|XSHE|FUND):\d{6}$/), symbol: z.string().regex(/^\d{6}$/), name: z.string().min(1).max(200),
  market: z.literal('CN'), currency: z.literal('CNY'), asset_type: z.enum(['ETF', 'FUND']), exchange: z.enum(['XSHG', 'XSHE', 'FUND']),
  provider_symbol: z.string().regex(/^\d{6}\.(SH|SZ|OF)$/), provider_catalog_version: z.string().datetime({ offset: true }),
}).superRefine((item, ctx) => {
  if (item.instrument_key !== `CN:${item.exchange}:${item.symbol}` || item.provider_symbol !== `${item.symbol}.${item.exchange === 'XSHG' ? 'SH' : item.exchange === 'XSHE' ? 'SZ' : 'OF'}` || (item.asset_type === 'FUND') !== (item.exchange === 'FUND')) ctx.addIssue({ code: 'custom', message: 'identity_mismatch' });
});
export const domesticRowSchema = z.strictObject({
  instrument: domesticInstrumentSchema, metrics: z.strictObject({ quotedPremiumPct: z.number().finite().nullable(), percentile60: z.number().min(0).max(100).nullable(), sampleDays: z.number().int().min(0).max(60), shares: z.number().finite().nonnegative().nullable(), sharesChange: z.number().finite().nullable(), sharesDate: z.string().date().nullable(), sharesPreviousDate: z.string().date().nullable().optional(), sharesSource: z.string().max(80).optional(), referenceValue: decimal.nullable(), label: z.string().max(100) }).optional(), price: decimal.nullable(), tradeDate: z.string().date().nullable(),
  changePct: z.number().finite().nullable(), nav: decimal.nullable(), navDate: z.string().date().nullable(), announcementDate: z.string().date().nullable(),
  premiumPct: z.number().finite().nullable(), premiumLabel: z.string().max(80), source: z.string().min(1), fetchedAt: z.string().datetime({ offset: true }),
  quality: z.enum(['available', 'partial', 'stale', 'missing']),
}).superRefine((row, ctx) => {
  if (row.instrument.asset_type === 'FUND' && (row.price !== null || row.premiumPct !== null || row.tradeDate !== null) || row.price !== null && !row.tradeDate || row.nav !== null && !row.navDate || row.premiumPct !== null && (!row.price || !row.nav || !row.tradeDate || !row.announcementDate || row.navDate! > row.tradeDate || row.announcementDate! > row.tradeDate)) ctx.addIssue({ code: 'custom', message: 'invalid_domestic_observation' });
});
export const domesticBoardSchema = z.strictObject({
  tradingDates: z.array(z.string().date()).max(60).optional(), benchmarks: z.array(z.strictObject({ symbol: z.string().max(20), name: z.string().max(50), price: decimal.nullable(), change: z.number().finite().nullable(), changePct: z.number().finite().nullable(), asOf: z.string().datetime({ offset: true }).nullable(), source: z.string().max(80) })).max(3).optional(), segment: z.enum(['etf', 'fund']), status: z.enum(['available', 'partial', 'unavailable']), reason: z.string().max(240), rows: z.array(domesticRowSchema).max(20),
}).superRefine((board, ctx) => { if (board.rows.some(row => row.instrument.asset_type !== (board.segment === 'etf' ? 'ETF' : 'FUND'))) ctx.addIssue({ code: 'custom', message: 'segment_mismatch' }); });
export type DomesticInstrument = z.infer<typeof domesticInstrumentSchema>;
export type DomesticBoard = z.infer<typeof domesticBoardSchema>;
