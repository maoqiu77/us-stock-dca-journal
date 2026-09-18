import { emptySnapshot, type Runtime, type Snapshot } from './model.ts';
import { createService } from './service.ts';

export function demoSnapshot(runtime: Runtime): Snapshot {
  const values = new Map<string, string>();
  values.set('portfolio.wechat.v1', JSON.stringify({ ...emptySnapshot(runtime), mode: 'demo' as const }));
  const sample = createService({ get: key => values.get(key) ?? '', set: (key, value) => { values.set(key, value); } }, runtime);
  sample.saveTrade({ kind: 'buy', symbol: 'QQQ', assetType: 'ETF', date: runtime.today(), quantity: '2', price: '100', fee: '1', note: '合成示例，不是真实行情或交易' });
  sample.saveTrade({ kind: 'sell', symbol: 'QQQ', date: runtime.today(), quantity: '0.5', price: '110', fee: '0.2', note: '合成示例：练习部分卖出' });
  sample.saveReview(runtime.today(), '这是一条示例复盘：记录买入理由、执行情况和下一次改进。');
  return { ...sample.snapshot(), mode: 'demo' };
}
