import { z } from 'zod';

const timestamp = z.string().datetime({ offset: true });
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const decimal = z.string().regex(/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/);
const positiveDecimal = decimal.refine(value => Number(value) > 0, 'must_be_positive');
export const instrumentKeySchema = z.string().regex(/^US:[A-Z0-9]{4}:[A-Z][A-Z0-9.-]{0,14}$/);

export const canonicalInstrumentSchema = z.strictObject({
  schema_version: z.literal(1), instrument_key: instrumentKeySchema, symbol: z.string().regex(/^[A-Z][A-Z0-9.-]{0,14}$/),
  name: z.string().min(1).max(200), mic: z.string().regex(/^[A-Z0-9]{4}$/), exchange: z.string().min(1).max(80), market: z.literal('US'),
  currency: z.literal('USD'), asset_type: z.enum(['STOCK', 'ETF']), provider_symbol: z.string().min(1).max(80),
  provider_catalog_version: z.string().min(1).max(80), status: z.enum(['active', 'inactive', 'delisted']),
});

export const quoteV1Schema = z.strictObject({
  schema_version: z.literal(1), instrument_key: instrumentKeySchema, symbol: z.string().min(1).max(16), currency: z.literal('USD'),
  price: positiveDecimal.nullable(), price_kind: z.enum(['last_trade', 'official_close', 'indicative']), previous_close: positiveDecimal.nullable(),
  previous_close_date: date.nullable(), change: decimal.nullable(), change_percent: decimal.nullable(), volume: z.string().regex(/^\d+$/).nullable(),
  volume_scope: z.enum(['consolidated', 'feed_only', 'unknown']), session: z.enum(['regular', 'pre', 'post', 'closed', 'unknown']),
  market_status: z.enum(['open', 'closed', 'halted', 'unknown']), trading_date: date.nullable(), exchange_timezone: z.literal('America/New_York'),
  provider: z.string().min(1).max(80), feed: z.string().min(1).max(80), coverage: z.enum(['consolidated', 'venue_subset', 'indicative', 'unknown']),
  timeliness: z.enum(['realtime', 'delayed', 'eod', 'unknown']), delay_seconds: z.number().int().nonnegative().nullable(), as_of: timestamp.nullable(),
  received_at: timestamp, served_at: timestamp, freshness: z.enum(['current', 'stale', 'unknown']), cache_state: z.enum(['miss', 'fresh_hit', 'stale_hit']),
  status: z.enum(['available', 'unavailable']), reason: z.string().min(1).max(160).nullable(), adjustment: z.literal('unadjusted'), attribution: z.string().min(1).max(240),
}).superRefine((quote, context) => {
  if (Date.parse(quote.received_at) > Date.parse(quote.served_at)) context.addIssue({ code: 'custom', path: ['served_at'], message: 'served_before_received' });
  if (quote.as_of && Date.parse(quote.as_of) > Date.parse(quote.received_at) + 60_000) context.addIssue({ code: 'custom', path: ['as_of'], message: 'market_clock_ahead' });
  if (quote.status === 'available' && (!quote.price || !quote.as_of)) context.addIssue({ code: 'custom', path: ['status'], message: 'available_requires_price_and_time' });
  if (quote.status === 'available' && quote.reason !== null) context.addIssue({ code: 'custom', path: ['reason'], message: 'available_has_error_reason' });
  if (quote.status === 'unavailable' && (!quote.reason || quote.price !== null || quote.previous_close !== null || quote.change !== null || quote.change_percent !== null || quote.volume !== null)) context.addIssue({ code: 'custom', path: ['status'], message: 'invalid_unavailable_payload' });
  if (quote.timeliness === 'unknown' && quote.delay_seconds !== null) context.addIssue({ code: 'custom', path: ['delay_seconds'], message: 'unknown_delay_must_be_null' });
});

export const barV1Schema = z.strictObject({ trading_date: date, starts_at: timestamp.nullable(), open: positiveDecimal, high: positiveDecimal, low: positiveDecimal, close: positiveDecimal, volume: z.string().regex(/^\d+$/).nullable(), is_final: z.boolean() }).superRefine((bar, context) => {
  const values = [bar.open, bar.close, bar.low, bar.high].map(Number);
  if (Number(bar.low) > Math.min(...values) || Number(bar.high) < Math.max(...values)) context.addIssue({ code: 'custom', path: ['high'], message: 'invalid_ohlc_range' });
});
export const barsV1Schema = z.strictObject({
  schema_version: z.literal(1), instrument_key: instrumentKeySchema, currency: z.literal('USD'), interval: z.literal('1day'), range: z.enum(['1M', '3M', '1Y']),
  adjustment: z.literal('unadjusted'), provider: z.string().min(1).max(80), feed: z.string().min(1).max(80), coverage: z.enum(['consolidated', 'venue_subset', 'indicative', 'unknown']),
  timezone: z.literal('America/New_York'), as_of: timestamp.nullable(), received_at: timestamp, served_at: timestamp, status: z.enum(['available', 'unavailable']), reason: z.string().min(1).max(160).nullable(), bars: z.array(barV1Schema).max(400),
}).superRefine((value, context) => {
  if (Date.parse(value.received_at) > Date.parse(value.served_at)) context.addIssue({ code: 'custom', path: ['served_at'], message: 'served_before_received' });
  if (value.as_of && Date.parse(value.as_of) > Date.parse(value.received_at) + 60_000) context.addIssue({ code: 'custom', path: ['as_of'], message: 'market_clock_ahead' });
  for (let index = 1; index < value.bars.length; index++) if (value.bars[index - 1].trading_date >= value.bars[index].trading_date) context.addIssue({ code: 'custom', path: ['bars', index], message: 'bars_not_strictly_ascending' });
  for (let index = 0; index < value.bars.length; index++) if (value.bars[index].trading_date > value.received_at.slice(0, 10)) context.addIssue({ code: 'custom', path: ['bars', index, 'trading_date'], message: 'future_bar' });
  if (value.status === 'available' && (!value.bars.length || !value.as_of || value.reason !== null)) context.addIssue({ code: 'custom', path: ['status'], message: 'invalid_available_bars' });
  if (value.status === 'unavailable' && (value.bars.length || !value.reason)) context.addIssue({ code: 'custom', path: ['bars'], message: 'invalid_unavailable_bars' });
});

export const marketCapabilitiesSchema = z.strictObject({
  schema_version: z.literal(1), enabled: z.boolean(), provider_configured: z.boolean(), authorized: z.boolean(), access_mode: z.enum(['closed_beta', 'public']),
  quote_access: z.boolean(), bars_access: z.boolean(), search_access: z.boolean(), ai_source_access: z.boolean(), archive_access: z.boolean(),
  provider: z.string().max(80).nullable(), feed: z.string().max(80).nullable(), coverage: z.enum(['consolidated', 'venue_subset', 'indicative', 'unknown']),
  timeliness: z.enum(['realtime', 'delayed', 'eod', 'unknown']), delay_seconds: z.number().int().nonnegative().nullable(), attribution: z.string().max(240),
  limits: z.strictObject({ quote_batch: z.number().int().min(1).max(30), search_results: z.number().int().min(1).max(10), bars: z.number().int().min(1).max(400) }),
});

export type CanonicalInstrument = z.infer<typeof canonicalInstrumentSchema>;
export type QuoteV1 = z.infer<typeof quoteV1Schema>;
export type BarsV1 = z.infer<typeof barsV1Schema>;
export type MarketCapabilities = z.infer<typeof marketCapabilitiesSchema>;
