import { z } from 'zod';
export const researchMarketSchema = z.enum(['CN', 'HK', 'US']);
export const researchPeriodSchema = z.enum(['1day', '60min', '30min', '15min', '5min', '1min']);
export const researchSelectionSchema = z.strictObject({ market: researchMarketSchema, symbol: z.string().trim().toUpperCase().max(15), period: researchPeriodSchema, auxiliary: z.array(researchPeriodSchema).max(5) }).superRefine((v,c) => {
  if (!(v.market === 'CN' ? /^(?:[03658]\d{5})$/ : v.market === 'HK' ? /^\d{5}$/ : /^[A-Z][A-Z0-9.-]{0,14}$/).test(v.symbol)) c.addIssue({code:'custom',message:'请输入当前市场有效的股票或 ETF 代码'});
  if (v.auxiliary.includes(v.period) || new Set(v.auxiliary).size !== v.auxiliary.length) c.addIssue({code:'custom',message:'辅助周期不能重复或与主周期相同'});
});
export const researchSeriesSchema = z.strictObject({ market: researchMarketSchema, symbol: z.string().max(15), name: z.string().max(200), currency: z.enum(['USD','CNY','HKD']), period: researchPeriodSchema, provider: z.string().max(80), adjustment: z.enum(['unadjusted','forward_adjusted','split_adjusted']), timezone: z.string().max(40), volumeUnit: z.enum(['shares','lots','provider_native']).optional(), timeLabel: z.enum(['interval_start','interval_end','trading_date']).optional(), fetchedAt: z.string().datetime(), status: z.enum(['available','unavailable']), reason: z.string().max(240), bars: z.array(z.strictObject({ time:z.string().datetime(),open:z.number().positive().finite(),high:z.number().positive().finite(),low:z.number().positive().finite(),close:z.number().positive().finite(),volume:z.number().nonnegative().finite().nullable() })).max(120) }).superRefine((v,c)=>{
  if (v.status==='available' && (!v.bars.length || v.reason)) c.addIssue({code:'custom',message:'invalid_series'});
  if (v.status==='unavailable' && (v.bars.length || !v.reason)) c.addIssue({code:'custom',message:'invalid_unavailable_series'});
  for(let i=0;i<v.bars.length;i++){const b=v.bars[i];if(b.low>Math.min(b.open,b.close)||b.high<Math.max(b.open,b.close)||b.low>b.high||b.time>v.fetchedAt||i>0&&b.time<=v.bars[i-1].time)c.addIssue({code:'custom',message:'invalid_bar'});}
});
export const researchSnapshotSchema = z.strictObject({receipt_id:z.string().min(1),receipt_digest:z.string().regex(/^[a-f0-9]{64}$/),created_at:z.string().datetime(),expires_at:z.string().datetime(),selection:researchSelectionSchema,series:z.array(researchSeriesSchema).min(1).max(6)});
export type ResearchSelection = z.infer<typeof researchSelectionSchema>;
export type ResearchSeries = z.infer<typeof researchSeriesSchema>;
