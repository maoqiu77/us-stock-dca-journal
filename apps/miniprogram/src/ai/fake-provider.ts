import type { ResearchTurnEnvelopeV1, ResearchTurnEnvelopeV2 } from '@portfolio/ai-context';

export type FakeScenario = 'success' | 'failure' | 'timeout' | 'bad_reference' | 'cross_midnight';
export type FakeAiProvider = { label: string; providerId: string; protocol: string; model: string; result(envelope: ResearchTurnEnvelopeV1 | ResearchTurnEnvelopeV2, scenario?: FakeScenario): unknown };

export const fakeAiProvider: FakeAiProvider = {
  label: '离线合成演示 · 非真实 AI / 非投资建议',
  providerId: 'deterministic-fake', protocol: 'local', model: 'deterministic-fake',
  result(envelope, scenario) {
    if (scenario === 'failure') throw Error('离线合成 Provider 故障。');
    if (scenario === 'timeout') throw Error('离线合成 Provider 超时。');
    const citation = scenario === 'bad_reference' ? 'ffffffff-ffff-4fff-8fff-ffffffffffff' : envelope.source_snapshots.find(item => item.type === 'ledger')!.id;
    return { schema_version: 2, request_id: envelope.request.request_id, classification: 'ai_generated', mode: envelope.request.mode, summary: '【离线合成演示】仅根据已确认的上下文生成，未连接真实模型或行情。', stance: 'insufficient_data', evidence: [{ statement: '账本持仓与成本为用户录入后的本地确定性计算。', source_ids: [citation] }], counterarguments: [{ statement: '缺少实时报价与完整现金，不能推导精确仓位或交易数量。', source_ids: [citation] }], conditions: [{ text: '获取有时点的真实报价后再重新分析。', basis: 'observed' }], missing_information: ['实时报价'], candidates: [], next_questions: ['要继续回看相关买入理由吗？'] };
  },
};
