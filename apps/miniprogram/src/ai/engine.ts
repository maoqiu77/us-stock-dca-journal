import {
  analysisRequestV2Schema, finalManifestV2Schema, instrumentCatalogEntrySchema, sealResearchTurnV1, sealResearchTurnV2, sha256,
  validateAnalysisResultV2, type AnalysisRequestV2, type ResearchTurnEnvelopeV1, type ResearchTurnEnvelopeV2, type ResearchTurnResponseV1, type ResearchTurnResponseV2,
} from '@portfolio/ai-context';
import { type Runtime, type Snapshot } from '../model.ts';
import { analysisRunSchema, messageSchema, outboxTurnSchema, sourceSnapshotSchema, type AnalysisRun, type Conversation, type Message, type OutboxTurn, type SourceSnapshot, type WorkspaceState } from '../journal/model.ts';
import { type AiTransport, TransportError } from './transport.ts';
import type { FakeAiProvider, FakeScenario } from './fake-provider.ts';

type Origin = 'portfolio' | 'instrument' | 'daily_review';
type Mode = AnalysisRequestV2['mode'];
type Selection = { includeJournal?: boolean; includeTradeReasons?: boolean; includePolicy?: boolean; includeHistory?: boolean; excludedJournalIds?: string[] };
type PreviewInput = Selection & { mode: Mode; journalDate: string; question: string; anchorId?: string | null; instrument?: ReturnType<typeof instrumentCatalogEntrySchema.parse> };
type MarketPreview = { receipt_id: string; receipt_digest: string; expires_at: string; quotes: Array<{ instrument_key: string; symbol: string; price: string | null; as_of: string | null; timeliness: string; delay_seconds: number | null; status: string; reason: string | null; attribution: string }> };
type AnalyzeInput = PreviewInput & { origin: Origin; scenario?: FakeScenario; conversationId?: string };
type WorkspacePort = {
  read(): WorkspaceState; createConversation(input: Pick<Conversation, 'origin' | 'anchor_id' | 'context_mode'>): Conversation;
  archiveAnalysis(input: { conversation: Conversation; user_message: Message; assistant_message: Message; run: AnalysisRun; sources?: SourceSnapshot[] }): unknown;
  saveOutbox(turn: OutboxTurn): OutboxTurn; updateOutbox(requestId: string, digest: string, change: (turn: OutboxTurn) => OutboxTurn): OutboxTurn;
  conversation(id: string): { conversation: Conversation; messages: Message[]; runs: AnalysisRun[] };
};
type FinancialPort = { snapshot(): Snapshot; overview(): any; records(): any[]; positionDetail(value: string): any };
export function createAiEngine(workspace: WorkspacePort, financial: FinancialPort, runtime: Runtime, transport?: AiTransport, fakeProvider?: FakeAiProvider) {
  function contextRevision(snapshot: Snapshot, state: WorkspaceState) { return sha256(JSON.stringify({ workspace_instance_id: state.instance_id, workspace_generation: state.root_generation, financial: snapshot })); }
  function draftRevision(input: PreviewInput) { return sha256(JSON.stringify(input)); }
  function snapshotSource(originEntityId: string, originRevision: string, type: SourceSnapshot['type'], content: string, asOf = runtime.now()) {
    return sourceSnapshotSchema.parse({ id: runtime.id(), origin_entity_id: originEntityId, origin_revision: originRevision, type, as_of: asOf, available_at: asOf, content_digest: sha256(content), content });
  }
  function target(input: PreviewInput, snapshot: Snapshot) {
    if (input.mode === 'daily_review') return { kind: 'daily_review' as const, portfolio_id: snapshot.portfolio.id, journal_date: input.journalDate };
    if (input.mode === 'instrument_research' || (input.mode === 'follow_up' && input.instrument)) {
      if (!input.instrument) throw Error('单标的分析缺少已确认的标的身份。');
      return { kind: 'instrument' as const, portfolio_id: snapshot.portfolio.id, instrument: instrumentCatalogEntrySchema.parse(input.instrument) };
    }
    return { kind: 'portfolio' as const, portfolio_id: snapshot.portfolio.id };
  }
  function buildContext(input: PreviewInput, conversationId?: string) {
    const snapshot = financial.snapshot(), state = workspace.read(), overview = financial.overview();
    const selectedTarget = target(input, snapshot), excluded = new Set(input.excludedJournalIds ?? []), sources: SourceSnapshot[] = [];
    const facts: Array<{ id: string; name: string; value: string; source_ids: string[]; freshness: 'current'; completeness: 'partial' | 'complete' }> = [];
    const symbol = selectedTarget.kind === 'instrument' ? selectedTarget.instrument.symbol : null;
    const instrumentRef = selectedTarget.kind === 'instrument' ? selectedTarget.instrument.instrument_ref : null;
    const positions = symbol ? overview.positions.filter((item: any) => item.symbol === symbol || item.id === instrumentRef) : overview.positions;
    const ledgerContent = JSON.stringify({ portfolio_id: snapshot.portfolio.id, through_date: overview.throughDate, target_symbol: symbol, positions: positions.map((item: any) => ({ instrument_id: item.id, symbol: item.symbol, quantity: item.quantity, remaining_cost_usd: item.cost, realized_pnl_usd: item.realized })), cash_state: snapshot.portfolio.cash_state, history_complete: snapshot.portfolio.history_complete });
    const ledgerRevision = sha256(JSON.stringify({ device_id: snapshot.device_id, events: snapshot.events.map(item => item.revision_id) }));
    const ledger = snapshotSource(snapshot.portfolio.id, ledgerRevision, 'ledger', ledgerContent, overview.knownAt); sources.push(ledger);
    const positionText = symbol && !positions.length ? `当前未持有 ${symbol}` : positions.length ? positions.map((item: any) => `${item.symbol} ${item.quantity} 股，剩余成本 ${item.cost} USD`).join('；') : '当前无持仓';
    facts.push({ id: runtime.id(), name: symbol ? '目标标的持仓状态' : '当前账本持仓', value: positionText, source_ids: [ledger.id], freshness: 'current', completeness: snapshot.portfolio.history_complete ? 'complete' : 'partial' });
    const headParents = new Set(state.journal.map(item => item.parent_revision).filter(Boolean));
    const notes = (input.includeJournal ?? true) ? state.journal.filter(item => !headParents.has(item.revision_id) && item.type === 'personal_note' && item.journal_date === input.journalDate && !excluded.has(item.id)) : [];
    const reasons = (input.includeTradeReasons ?? true) ? financial.records().filter(record => record.note && (!symbol || record.symbol === symbol)).map(record => ({ id: record.id, revision: record.revisionId, text: record.note, at: record.recordedAt })) : [];
    const excerpts = [...notes.map(item => ({ id: item.id, revision: item.revision_id, text: item.body!, at: item.updated_at })), ...reasons].slice(0, 20).map(item => { const source = snapshotSource(item.id, item.revision, 'journal', item.text, item.at); sources.push(source); return { id: runtime.id(), text: item.text, source_id: source.id, classification: 'user_original' as const }; });
    const missingInformation: string[] = [];
    if (snapshot.portfolio.cash_state === 'unknown') missingInformation.push('现金余额');
    const policy = state.policies.at(-1);
    if (!(input.includePolicy ?? true) || !policy || policy.status === 'unknown') missingInformation.push('确认的投资计划');
    else {
      const content = JSON.stringify(policy), source = snapshotSource(policy.id, policy.revision_id, 'policy', content, policy.confirmed_at); sources.push(source);
      facts.push({ id: runtime.id(), name: '用户确认的投资计划', value: `期限：${policy.horizon ?? '未填写'}；最大单标的权重：${policy.max_single_weight ?? '未填写'}`, source_ids: [source.id], freshness: 'current', completeness: policy.horizon && policy.max_single_weight ? 'complete' : 'partial' });
    }
    missingInformation.push('实时报价');
    const rawHistory = conversationId && (input.includeHistory ?? true) ? workspace.conversation(conversationId).messages : [];
    const fakeTurns = new Set(rawHistory.filter(message => message.role === 'assistant' && message.execution_kind === 'fake').map(message => message.client_turn_id));
    const allHistory = rawHistory.filter(message => message.execution_kind !== 'fake' && !fakeTurns.has(message.client_turn_id));
    const history = allHistory.slice(-12).map(message => ({ id: message.id, role: message.role, content: message.content, parent_message_id: message.parent_message_id, client_turn_id: message.client_turn_id, classification: message.classification, execution_kind: message.execution_kind, created_at: message.created_at }));
    return { target: selectedTarget, facts, excerpts, sources, history, historyOmittedCount: Math.max(0, allHistory.length - history.length), missingInformation, approximateCharacters: JSON.stringify({ facts, excerpts, history }).length, omissions: missingInformation.map(description => ({ reason: 'missing' as const, description })), contextRevision: contextRevision(snapshot, state), draftRevision: draftRevision(input) };
  }
  function previewContext(input: PreviewInput & { conversationId?: string }) { return buildContext(input, input.conversationId); }
  function ensureConversation(input: AnalyzeInput) { return input.conversationId ? workspace.conversation(input.conversationId).conversation : workspace.createConversation({ origin: input.origin, anchor_id: input.anchorId ?? input.instrument?.symbol ?? null, context_mode: 'current' }); }
  function prepare(input: AnalyzeInput, confirmedPreview?: ReturnType<typeof buildContext> & { marketReceipt?: MarketPreview }) {
    const beforeState = workspace.read(), beforeSnapshot = financial.snapshot();
    if (confirmedPreview && (confirmedPreview.contextRevision !== contextRevision(beforeSnapshot, beforeState) || confirmedPreview.draftRevision !== draftRevision(input))) throw Error('本次分析内容已变化，请重新查看后再发送。');
    const conversation = ensureConversation(input), state = workspace.read(), built = confirmedPreview ?? buildContext(input, conversation.id);
    const now = runtime.now(), requestId = runtime.id(), clientTurnId = runtime.id(), userMessageId = runtime.id(), assistantMessageId = runtime.id(), runId = runtime.id();
    const request = analysisRequestV2Schema.parse({ schema_version: 2, request_id: requestId, workspace_instance_id: state.instance_id, portfolio_id: state.portfolio_id, conversation_id: conversation.id, client_turn_id: clientTurnId, mode: input.mode, journal_date: input.journalDate, personal_snapshot_at: now, question: input.question, facts: built.facts, excerpts: built.excerpts, excluded_source_ids: input.excludedJournalIds ?? [] });
    const common = { request, target: built.target, history: built.history, history_omitted_count: built.historyOmittedCount, source_snapshots: built.sources, consent: { scope_version: 1 as const, confirmed_at: now, include_positions: true, include_journal: input.includeJournal ?? true, include_trade_reasons: input.includeTradeReasons ?? true, include_policy: input.includePolicy ?? true, include_history: input.includeHistory ?? true }, prepared_at: now, expires_at: new Date(Date.parse(now) + 10 * 60_000).toISOString() };
    const envelope = confirmedPreview?.marketReceipt ? sealResearchTurnV2({ transport_version: 2, ...common, market: { use_market_data: true, receipt_id: confirmedPreview.marketReceipt.receipt_id, receipt_digest: confirmedPreview.marketReceipt.receipt_digest } }) : sealResearchTurnV1({ transport_version: 1, ...common });
    const turn = workspace.saveOutbox(outboxTurnSchema.parse({ schema_version: 2, request_id: requestId, workspace_instance_id: state.instance_id, conversation_id: conversation.id, client_turn_id: clientTurnId, user_message_id: userMessageId, assistant_message_id: assistantMessageId, run_id: runId, payload_digest: envelope.payload_digest, envelope, status: 'prepared', remote_run_id: null, response_digest: null, error_code: null, created_at: now, updated_at: now, last_checked_at: null, detached_reason: null }));
    return { conversation, envelope, turn, preview: built };
  }
  function archivePrepared(prepared: ReturnType<typeof prepare>, resultInput: unknown, executionKind: 'fake' | 'real', response?: ResearchTurnResponseV1 | ResearchTurnResponseV2, completedAt = runtime.now()) {
    const { envelope, conversation, turn } = prepared;
    if (workspace.read().instance_id !== turn.workspace_instance_id) { workspace.updateOutbox(turn.request_id, turn.payload_digest, old => ({ ...old, status: 'detached', detached_reason: '工作区已变更，迟到结果已隔离。', updated_at: runtime.now() })); throw Error('工作区已变更，迟到结果不会写入。'); }
    const manifest = response?.manifest ?? finalManifestV2Schema.parse({ schema_version: 2, request_id: envelope.request.request_id, workspace_instance_id: envelope.request.workspace_instance_id, portfolio_id: envelope.request.portfolio_id, built_at: completedAt, known_at: completedAt, personal_snapshot_at: envelope.request.personal_snapshot_at, sources: envelope.source_snapshots.map(item => ({ id: item.id, revision: item.id, type: item.type, as_of: item.as_of, available_at: item.available_at, content_hash: item.content_digest, quality: item.type === 'ledger' ? 'client_computed' : 'user_reported' })), omissions: prepared.preview.omissions });
    const result = validateAnalysisResultV2(resultInput, envelope.request, manifest), runId = response?.run_id ?? turn.run_id;
    const run = analysisRunSchema.parse({ schema_version: 2, id: runId, request_id: envelope.request.request_id, conversation_id: conversation.id, parent_run_id: workspace.conversation(conversation.id).runs.at(-1)?.id ?? null, mode: envelope.request.mode, journal_date: envelope.request.journal_date, state: 'succeeded', output_validated: true, local_saved: true, execution_kind: executionKind, data_mode: financial.snapshot().mode, provider_id: response?.execution.provider_id ?? fakeProvider?.providerId, source_integrity: 'verified', source_ids: manifest.sources.map(item => item.id), final_manifest: manifest, provider_metadata: response ? { protocol: response.execution.protocol, model: response.execution.model, credential_mode: response.execution.credential_mode, input_units: response.execution.input_units, output_units: response.execution.output_units } : { protocol: fakeProvider?.protocol, model: fakeProvider?.model, credential_mode: 'not_applicable', input_units: envelope.payload_digest.length, output_units: result.summary.length }, result, created_at: envelope.prepared_at, completed_at: completedAt });
    const previous = workspace.conversation(conversation.id).messages.at(-1);
    const user = messageSchema.parse({ id: turn.user_message_id, conversation_id: conversation.id, role: 'user', content: envelope.request.question, parent_message_id: previous?.id ?? null, client_turn_id: turn.client_turn_id, run_id: null, status: 'saved', classification: 'user_original', execution_kind: null, created_at: envelope.prepared_at });
    const assistant = messageSchema.parse({ id: turn.assistant_message_id, conversation_id: conversation.id, role: 'assistant', content: result.summary, parent_message_id: user.id, client_turn_id: turn.client_turn_id, run_id: run.id, status: 'saved', classification: 'ai_generated', execution_kind: executionKind, created_at: completedAt });
    const archivedSources = [...envelope.source_snapshots, ...(response?.transport_version === 2 ? response.external_source_snapshots : [])];
    workspace.archiveAnalysis({ conversation, user_message: user, assistant_message: assistant, run, sources: archivedSources });
    workspace.updateOutbox(turn.request_id, turn.payload_digest, old => ({ ...old, status: 'saved', remote_run_id: response?.run_id ?? old.remote_run_id, response_digest: response?.response_digest ?? old.response_digest, updated_at: runtime.now() }));
    return { conversation, request: envelope.request, envelope, manifest, result, run, archive: { conversation, user_message: user, assistant_message: assistant, run, sources: archivedSources } };
  }
  function runPreparedFake(prepared: ReturnType<typeof prepare>, scenario?: AnalyzeInput['scenario']) { if (!fakeProvider) throw Error('当前构建不提供合成 AI。'); const completedAt = scenario === 'cross_midnight' ? '2026-09-11T00:00:01.000Z' : runtime.now(); return archivePrepared(prepared, fakeProvider.result(prepared.envelope, scenario), 'fake', undefined, completedAt); }
  function analyze(input: AnalyzeInput) { return runPreparedFake(prepare(input), input.scenario); }
  function errorCode(error: unknown, fallback: string) { return error instanceof TransportError ? error.code : fallback; }
  function currentTurn(requestId: string) { return workspace.read().outbox.find(item => item.request_id === requestId); }
  function preparedFromTurn(turn: OutboxTurn) { return { conversation: workspace.conversation(turn.conversation_id).conversation, envelope: turn.envelope, turn, preview: { omissions: [] } } as unknown as ReturnType<typeof prepare>; }
  async function acknowledge(turn: OutboxTurn, responseDigest: string) {
    try {
      await transport!.ack(turn.request_id, turn.payload_digest, responseDigest);
      workspace.updateOutbox(turn.request_id, turn.payload_digest, old => ({ ...old, status: 'saved', last_ack_error: null, error_code: null, updated_at: runtime.now(), last_checked_at: runtime.now() }));
    } catch (error) {
      workspace.updateOutbox(turn.request_id, turn.payload_digest, old => ({ ...old, status: 'ack_pending', last_ack_error: errorCode(error, 'ACK_FAILED'), updated_at: runtime.now(), last_checked_at: runtime.now() }));
    }
  }
  async function archiveAndAcknowledge(prepared: ReturnType<typeof prepare>, response: ResearchTurnResponseV1 | ResearchTurnResponseV2) {
    let archived;
    try { archived = archivePrepared(prepared, response.result, 'real', response, response.execution.completed_at); }
    catch (error) {
      try { workspace.updateOutbox(prepared.turn.request_id, prepared.turn.payload_digest, old => ({ ...old, status: 'local_save_pending', error_code: errorCode(error, 'LOCAL_ARCHIVE_FAILED'), updated_at: runtime.now() })); } catch { /* the repository's pending-save barrier is the source of truth */ }
      throw error;
    }
    await acknowledge(currentTurn(prepared.turn.request_id) ?? prepared.turn, response.response_digest);
    return archived;
  }
  async function submitPrepared(prepared: ReturnType<typeof prepare>) {
    if (!transport) throw Error('云 transport 未配置，不会静默联网或切换 fake。');
    if (Date.parse(runtime.now()) >= Date.parse(prepared.envelope.expires_at)) { workspace.updateOutbox(prepared.turn.request_id, prepared.turn.payload_digest, old => ({ ...old, status: 'expired', error_code: 'PREPARED_EXPIRED', updated_at: runtime.now() })); throw Error('本次确认内容已过期，请重新查看后再发送。'); }
    workspace.updateOutbox(prepared.turn.request_id, prepared.turn.payload_digest, old => ({ ...old, status: 'submitting', updated_at: runtime.now() }));
    let status;
    try {
      status = await transport.analyze(prepared.envelope);
    } catch (error) {
      const unknown = error instanceof TransportError && error.outcomeUnknown;
      workspace.updateOutbox(prepared.turn.request_id, prepared.turn.payload_digest, old => ({ ...old, status: unknown ? 'outcome_unknown' : 'failed', error_code: error instanceof TransportError ? error.code : 'SUBMIT_FAILED', updated_at: runtime.now() }));
      throw error;
    }
    if (status.status !== 'succeeded') { const localStatus: OutboxTurn['status'] = status.status === 'running' ? 'running' : status.status === 'outcome_unknown' ? 'outcome_unknown' : status.status === 'expired' ? 'expired' : 'failed'; workspace.updateOutbox(prepared.turn.request_id, prepared.turn.payload_digest, old => ({ ...old, status: localStatus, error_code: status.errorCode ?? null, updated_at: runtime.now() })); return status; }
    try {
      const response = await transport.result(prepared.turn.request_id, prepared.turn.payload_digest);
      workspace.updateOutbox(prepared.turn.request_id, prepared.turn.payload_digest, old => ({ ...old, status: 'remote_succeeded', remote_run_id: response.run_id, response_digest: response.response_digest, updated_at: runtime.now() }));
      return await archiveAndAcknowledge(prepared, response);
    } catch (error) {
      const turn = currentTurn(prepared.turn.request_id);
      if (turn?.status === 'remote_succeeded') workspace.updateOutbox(turn.request_id, turn.payload_digest, old => ({ ...old, error_code: errorCode(error, 'RESULT_FETCH_FAILED'), last_checked_at: runtime.now(), updated_at: runtime.now() }));
      throw error;
    }
  }
  function pending() { return workspace.read().outbox.filter(item => !['saved', 'failed', 'expired', 'detached'].includes(item.status)).map(item => ({ requestId: item.request_id, conversationId: item.conversation_id, status: item.status, updatedAt: item.updated_at, question: item.envelope.request.question, ackPending: item.status === 'ack_pending' })); }
  async function recoverPending(requestId?: string) {
    if (!transport) return [];
    const candidates = workspace.read().outbox.filter(item => (!requestId || item.request_id === requestId) && !['saved', 'failed', 'expired', 'detached'].includes(item.status));
    const recovered = [];
    for (const original of candidates) {
      let turn = currentTurn(original.request_id) ?? original;
      if (turn.status === 'prepared') { if (Date.parse(runtime.now()) >= Date.parse(turn.envelope.expires_at)) workspace.updateOutbox(turn.request_id, turn.payload_digest, old => ({ ...old, status: 'expired', error_code: 'PREPARED_EXPIRED', updated_at: runtime.now() })); continue; }
      if (turn.status === 'ack_pending') { if (turn.response_digest) await acknowledge(turn, turn.response_digest); continue; }
      const remote = await transport.status(turn.request_id, turn.payload_digest);
      const localStatus: OutboxTurn['status'] = remote.status === 'succeeded' ? 'remote_succeeded' : remote.status === 'running' ? 'running' : remote.status === 'outcome_unknown' ? 'outcome_unknown' : remote.status === 'expired' ? 'expired' : 'failed';
      turn = workspace.updateOutbox(turn.request_id, turn.payload_digest, old => ({ ...old, status: localStatus, response_digest: remote.responseDigest ?? old.response_digest, error_code: remote.errorCode ?? null, last_checked_at: runtime.now(), updated_at: runtime.now() }));
      if (remote.status !== 'succeeded') continue;
      const response = await transport.result(turn.request_id, turn.payload_digest);
      const archived = await archiveAndAcknowledge(preparedFromTurn(turn), response); recovered.push(archived);
    }
    return recovered;
  }
  function followUp(input: { conversationId: string; journalDate: string; question: string; scenario?: AnalyzeInput['scenario'] }) {
    const current = workspace.conversation(input.conversationId).conversation;
    const instrument = current.origin === 'instrument' && current.anchor_id ? confirmResearchInstrument(current.anchor_id, 'STOCK') : undefined;
    return analyze({ origin: current.origin, anchorId: current.anchor_id, instrument, mode: 'follow_up', journalDate: input.journalDate, question: input.question, scenario: input.scenario, conversationId: input.conversationId, includeHistory: true });
  }
  function confirmResearchInstrument(symbolInput: string, assetType: 'STOCK' | 'ETF') { const symbol = symbolInput.trim().toUpperCase(); if (!/^[A-Z0-9][A-Z0-9.-]{0,14}$/.test(symbol)) throw Error('请输入有效美股代码。'); const existing = financial.snapshot().instruments.find(item => item.symbol === symbol); return instrumentCatalogEntrySchema.parse({ instrument_ref: existing?.id ?? runtime.id(), symbol, market: 'US', asset_type: existing?.asset_type ?? assetType, confirmed_at: runtime.now(), source: existing ? 'ledger_confirmed' : 'user_confirmed' }); }
  async function capabilities() {
    if (!transport) return { realProviderConfigured: false, fakeProviderAvailable: !!fakeProvider, enabled: false, authorized: false, enrolled: false, consented: false, accessMode: 'closed_beta', usage: null, limits: null, consentVersion: 1, label: 'AI 服务暂不可用，你仍可记录交易和查看历史。' };
    try {
      const value = await transport.capabilities();
      const available = value.enabled && value.providerConfigured && value.authorized;
      const reason = !value.enabled ? 'AI 服务当前已关闭。' : !value.providerConfigured ? 'AI 服务尚未完成配置。' : !value.enrolled ? '当前账号尚未加入体验范围。' : !value.consented ? '首次使用前需要确认云处理说明。' : 'AI 服务可用。';
      return { ...value, realProviderConfigured: available, fakeProviderAvailable: !!fakeProvider, label: reason };
    } catch { return { realProviderConfigured: false, fakeProviderAvailable: !!fakeProvider, enabled: false, authorized: false, enrolled: false, consented: false, accessMode: 'closed_beta', usage: null, limits: null, consentVersion: 1, label: '无法取得 AI 服务状态，请检查网络后重试。' }; }
  }
  async function acceptConsent(version: number) { if (!transport?.acceptConsent) throw Error('AI 服务尚未配置云处理同意。'); await transport.acceptConsent(version); return capabilities(); }
  return { previewContext, prepare, runPreparedFake, submitPrepared, recoverPending, pending, analyze, followUp, conversation: workspace.conversation, archiveResponse: (value: any) => workspace.archiveAnalysis(value.archive), confirmResearchInstrument, capabilities, acceptConsent };
}
