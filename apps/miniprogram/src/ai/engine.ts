import {
  analysisRequestV2Schema,
  finalManifestV2Schema,
  instrumentCatalogEntrySchema,
  validateAnalysisResultV2,
  type AnalysisRequestV2,
} from '@portfolio/ai-context';
import { type Runtime, type Snapshot } from '../model.ts';
import { contentHash } from '../workspace/repository.ts';
import { sourceSnapshotSchema, type AnalysisRun, type Conversation, type Message, type SourceSnapshot, type WorkspaceState } from '../journal/model.ts';

type Origin = 'portfolio' | 'instrument' | 'daily_review';
type Mode = AnalysisRequestV2['mode'];
type PreviewInput = { mode: Mode; journalDate: string; question: string; anchorId?: string | null; excludedJournalIds?: string[] };
type AnalyzeInput = PreviewInput & { origin: Origin; scenario?: 'success' | 'failure' | 'timeout' | 'bad_reference' | 'cross_midnight'; conversationId?: string };
type WorkspacePort = {
  read(): WorkspaceState;
  createConversation(input: Pick<Conversation, 'origin' | 'anchor_id' | 'context_mode'>): Conversation;
  archiveAnalysis(input: { conversation: Conversation; user_message: Message; assistant_message: Message; run: AnalysisRun; sources?: SourceSnapshot[] }): unknown;
  conversation(id: string): { conversation: Conversation; messages: Message[]; runs: AnalysisRun[] };
};
type FinancialPort = { snapshot(): Snapshot; overview(): any; records(): any[]; positionDetail(value: string): any };

export const FAKE_PROVIDER_LABEL = '离线合成演示 · 非真实 AI / 非投资建议';

export function createAiEngine(workspace: WorkspacePort, financial: FinancialPort, runtime: Runtime) {
  function source(id: string, revision: string, type: SourceSnapshot['type'], content: string, asOf = runtime.now()) {
    return sourceSnapshotSchema.parse({ id, revision, type, as_of: asOf, available_at: asOf, content_hash: contentHash(content), content });
  }
  function previewContext(input: PreviewInput) {
    const snapshot = financial.snapshot(), state = workspace.read(), overview = financial.overview();
    const excluded = new Set(input.excludedJournalIds ?? []), sources: SourceSnapshot[] = [], facts: Array<{ id: string; name: string; value: string; source_ids: string[]; freshness: 'current'; completeness: 'partial' | 'complete' }> = [];
    const positions = input.anchorId && input.anchorId !== snapshot.portfolio.id ? overview.positions.filter((item: any) => item.symbol === input.anchorId || item.id === input.anchorId) : overview.positions;
    const ledgerContent = JSON.stringify({ portfolio_id: snapshot.portfolio.id, through_date: overview.throughDate, positions: positions.map((item: any) => ({ symbol: item.symbol, quantity: item.quantity, remaining_cost_usd: item.cost, realized_pnl_usd: item.realized })), cash_state: snapshot.portfolio.cash_state, history_complete: snapshot.portfolio.history_complete });
    const ledgerSource = source(snapshot.portfolio.id, snapshot.device_id, 'ledger', ledgerContent, overview.knownAt);
    sources.push(ledgerSource);
    facts.push({ id: runtime.id(), name: '当前账本持仓', value: positions.length ? positions.map((item: any) => `${item.symbol} ${item.quantity} 股，剩余成本 ${item.cost} USD`).join('；') : '当前无持仓', source_ids: [ledgerSource.id], freshness: 'current', completeness: snapshot.portfolio.history_complete ? 'complete' : 'partial' });
    const headParents = new Set(state.journal.map(item => item.parent_revision).filter(Boolean));
    const notes = state.journal.filter(item => !headParents.has(item.revision_id) && item.type === 'personal_note' && item.journal_date === input.journalDate && !excluded.has(item.id));
    const recordReasons = financial.records().filter(record => record.note && (!input.anchorId || input.anchorId === snapshot.portfolio.id || record.symbol === input.anchorId)).map(record => ({ id: record.id, revision_id: record.revisionId, text: record.note, updated_at: record.recordedAt }));
    const excerpts = [...notes.map(item => ({ id: item.id, revision: item.revision_id, text: item.body!, asOf: item.updated_at })), ...recordReasons.map(item => ({ id: item.id, revision: item.revision_id, text: item.text, asOf: item.updated_at }))]
      .slice(0, 20).map(item => { const ref = source(item.id, item.revision, 'journal', item.text, item.asOf); sources.push(ref); return { id: runtime.id(), text: item.text, source_id: ref.id, classification: 'user_original' as const }; });
    const policy = state.policies.at(-1), missingInformation: string[] = [];
    if (snapshot.portfolio.cash_state === 'unknown') missingInformation.push('现金余额');
    if (!policy || policy.status === 'unknown') missingInformation.push('确认的投资计划');
    else {
      const policyContent = JSON.stringify(policy), policySource = source(policy.id, policy.revision_id, 'policy', policyContent, policy.confirmed_at);
      sources.push(policySource);
      facts.push({ id: runtime.id(), name: '用户确认的投资计划', value: `期限：${policy.horizon ?? '未填写'}；最大单标的权重：${policy.max_single_weight ?? '未填写'}`, source_ids: [policySource.id], freshness: 'current', completeness: policy.horizon && policy.max_single_weight ? 'complete' : 'partial' });
    }
    missingInformation.push('实时报价');
    const approximateCharacters = JSON.stringify({ facts, excerpts }).length;
    return { facts, excerpts, sources, missingInformation, approximateCharacters, omissions: missingInformation.map(description => ({ reason: 'missing' as const, description })) };
  }
  function provider(request: AnalysisRequestV2, manifest: any, missing: string[], scenario: AnalyzeInput['scenario']) {
    if (scenario === 'failure') throw Error('离线合成 Provider 故障。');
    if (scenario === 'timeout') throw Error('离线合成 Provider 超时。');
    const citation = scenario === 'bad_reference' ? runtime.id() : manifest.sources.find((item: any) => item.type === 'ledger')?.id;
    return { schema_version: 2 as const, request_id: request.request_id, classification: 'ai_generated' as const, mode: request.mode, summary: `【离线合成演示】仅根据本地已选上下文生成，未连接真实模型或行情。`, stance: 'insufficient_data' as const, evidence: [{ statement: '账本持仓与成本为用户录入后的本地确定性计算。', source_ids: [citation] }], counterarguments: [{ statement: '缺少实时报价与完整现金，不能推导精确仓位或交易数量。', source_ids: [citation] }], conditions: [{ text: '获取有时点的真实报价后再重新分析。', basis: 'observed' as const }], missing_information: missing, candidates: [], next_questions: ['要继续回看相关买入理由吗？'] };
  }
  function analyze(input: AnalyzeInput) {
    const state = workspace.read();
    const conversation = input.conversationId ? workspace.conversation(input.conversationId).conversation : workspace.createConversation({ origin: input.origin, anchor_id: input.anchorId ?? null, context_mode: 'current' });
    const preview = previewContext(input), requestId = runtime.id(), clientTurnId = runtime.id(), personalSnapshotAt = runtime.now();
    const request = analysisRequestV2Schema.parse({ schema_version: 2, request_id: requestId, workspace_instance_id: state.instance_id, portfolio_id: state.portfolio_id, conversation_id: conversation.id, client_turn_id: clientTurnId, mode: input.mode, journal_date: input.journalDate, personal_snapshot_at: personalSnapshotAt, question: input.question, facts: preview.facts, excerpts: preview.excerpts, excluded_source_ids: input.excludedJournalIds ?? [] });
    const completedAt = input.scenario === 'cross_midnight' ? '2026-09-11T00:00:01.000Z' : runtime.now();
    const manifest = finalManifestV2Schema.parse({ schema_version: 2, request_id: request.request_id, workspace_instance_id: request.workspace_instance_id, portfolio_id: request.portfolio_id, built_at: completedAt, known_at: completedAt, personal_snapshot_at: request.personal_snapshot_at, sources: preview.sources.map(item => ({ id: item.id, revision: item.revision, type: item.type, as_of: item.as_of, available_at: item.available_at, content_hash: item.content_hash, quality: item.type === 'ledger' ? 'client_computed' : 'user_reported' })), omissions: preview.omissions });
    const result = validateAnalysisResultV2(provider(request, manifest, preview.missingInformation, input.scenario), request, manifest);
    const runId = runtime.id();
    const run = { id: runId, request_id: request.request_id, conversation_id: conversation.id, parent_run_id: workspace.conversation(conversation.id).runs.at(-1)?.id ?? null, mode: request.mode, journal_date: input.journalDate, state: 'succeeded' as const, output_validated: true as const, local_saved: true as const, provider: 'fake' as const, demo: true as const, source_ids: manifest.sources.map(item => item.id), result, created_at: personalSnapshotAt, completed_at: completedAt };
    const previous = workspace.conversation(conversation.id).messages.at(-1);
    const userMessage = { id: runtime.id(), conversation_id: conversation.id, role: 'user' as const, content: input.question, parent_message_id: previous?.id ?? null, client_turn_id: clientTurnId, run_id: null, status: 'saved' as const, classification: 'user_original' as const, created_at: personalSnapshotAt };
    const assistantMessage = { id: runtime.id(), conversation_id: conversation.id, role: 'assistant' as const, content: result.summary, parent_message_id: userMessage.id, client_turn_id: clientTurnId, run_id: runId, status: 'saved' as const, classification: 'ai_generated' as const, created_at: completedAt };
    const archive = { conversation, user_message: userMessage, assistant_message: assistantMessage, run, sources: preview.sources };
    workspace.archiveAnalysis(archive);
    return { conversation, request, manifest, result, run, archive };
  }
  function followUp(input: { conversationId: string; journalDate: string; question: string; scenario?: AnalyzeInput['scenario'] }) {
    const current = workspace.conversation(input.conversationId).conversation;
    return analyze({ origin: current.origin, anchorId: current.anchor_id, mode: 'follow_up', journalDate: input.journalDate, question: input.question, scenario: input.scenario, conversationId: input.conversationId });
  }
  function confirmResearchInstrument(symbolInput: string, assetType: 'STOCK' | 'ETF') {
    const symbol = symbolInput.trim().toUpperCase(); if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) throw Error('请输入有效美股代码。');
    const existing = financial.snapshot().instruments.find(item => item.symbol === symbol);
    return instrumentCatalogEntrySchema.parse({ instrument_ref: existing?.id ?? runtime.id(), symbol, market: 'US', asset_type: existing?.asset_type ?? assetType, confirmed_at: runtime.now(), source: existing ? 'ledger_confirmed' : 'user_confirmed' });
  }
  return { previewContext, analyze, followUp, conversation: workspace.conversation, archiveResponse: (value: any) => workspace.archiveAnalysis(value.archive), confirmResearchInstrument, capabilities: () => ({ realProviderConfigured: false, fakeProviderAvailable: true, label: FAKE_PROVIDER_LABEL }) };
}
