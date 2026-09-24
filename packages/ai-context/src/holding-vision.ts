import { z } from 'zod';

// Raw observations are never executable instructions or computed ledger values.
export const screenshotFieldSchema = z.strictObject({
  label: z.string().trim().min(1).max(80), value: z.string().max(160),
  unit: z.string().max(16).nullable().optional(), date: z.string().max(40).nullable().optional(),
});
export const screenshotDocumentSchema = z.strictObject({
  pageType: z.enum(['holdings', 'watchlist', 'other', 'unknown']),
  platform: z.string().max(80).nullable(),
  accountType: z.enum(['cash', 'margin', 'unknown']),
  accountLabel: z.string().max(80).nullable(),
  currency: z.string().max(8).nullable(),
  observedAtText: z.string().max(60).nullable(),
  coverage: z.enum(['complete', 'partial', 'unknown']),
  fields: z.array(screenshotFieldSchema).max(24),
  groups: z.array(z.strictObject({ label: z.string().max(80), currency: z.string().max(8).nullable(), fields: z.array(screenshotFieldSchema).max(12) })).max(12),
});
export const screenshotMetricFields = {
  marketValueText: z.string().max(40).nullable().optional(),
  holdingPnlText: z.string().max(40).nullable().optional(),
  holdingReturnRateText: z.string().max(40).nullable().optional(),
  dailyChangeRateText: z.string().max(40).nullable().optional(),
  navText: z.string().max(40).nullable().optional(),
  navDateText: z.string().max(40).nullable().optional(),
  originalFields: z.array(screenshotFieldSchema).max(24).optional(),
  source: screenshotDocumentSchema.optional(),
};
export const screenshotMetricsSchema = z.strictObject(screenshotMetricFields);
export const holdingVisionRowSchema = z.strictObject({
  name: z.string().max(120).nullable(), code: z.string().max(32).nullable(),
  quantityText: z.string().max(40).nullable(), unitCostText: z.string().max(40).nullable(),
  costBasis: z.enum(['average_cost', 'breakeven', 'unknown']),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(), accountLabel: z.string().max(80).nullable(),
  ...screenshotMetricFields,
  assetType: z.enum(['STOCK', 'ETF', 'FUND', 'OPTION', 'OTHER', 'UNKNOWN']).optional(),
  market: z.string().max(32).nullable().optional(),
  groupLabel: z.string().max(80).nullable().optional(),
  issues: z.array(z.string().max(120)).max(8).optional(),
});

// A daily holding return is not an instrument price change, even when both are percentages.
export function normalizeScreenshotMetrics<T extends z.infer<typeof screenshotMetricsSchema>>(metrics: T): T {
  if (!metrics.dailyChangeRateText || !metrics.originalFields?.length) return metrics;
  const fields = metrics.originalFields;
  const priceChange = fields.some(field => /涨跌幅|日涨幅|日涨跌|price.*change/i.test(field.label));
  const dailyPnl = fields.some(field => /(?:当日|今日|日内|本日|daily|today).*(?:盈亏|收益|profit|pnl|return)|^day\s*chg$/i.test(field.label));
  return dailyPnl && !priceChange ? { ...metrics, dailyChangeRateText: null } : metrics;
}

export function normalizeScreenshotDocument<T extends z.infer<typeof screenshotDocumentSchema>>(document: T): T {
  if (document.accountType !== 'margin') return document;
  const evidence = document.fields.some(field => /负债|保证金|担保比例|融资|融券|margin|liabilit/i.test(field.label));
  if (evidence) return document;
  return { ...document, accountType: /普通|现金|cash/i.test(document.accountLabel || '') ? 'cash' : 'unknown' };
}
