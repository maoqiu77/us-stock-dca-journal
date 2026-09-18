import { researchTurnEnvelopeV1Schema, researchTurnEnvelopeV2Schema, sealResearchResponseV1, sealResearchResponseV2, sha256, validateAnalysisResultV2, type ResearchTurnEnvelopeV1, type ResearchTurnEnvelopeV2 } from '@portfolio/ai-context';
import type { ProviderResolver } from './credentials.ts';
import type { RequestStore } from './request-store.ts';
import type { MarketReceipt, MarketReceiptStore } from './market/receipt-store.ts';

export type TrustedContext = { appId: string; openId: string; source: 'wechat-miniprogram' };
export type GatewayConfig = { expectedAppId: string; enabled: boolean; consentVersion: 1; accessMode?: 'closed_beta' | 'public'; dailyLimit: number; globalDailyLimit?: number; maxInflight: number; maxInputBytes: number; maxOutputTokens: number; maxExpiryMs: number; providerConfigured: boolean };
export type AccessPort = { allowed(owner: string): Promise<boolean>; status?(owner: string, mode: 'closed_beta' | 'public', version: number): Promise<{ enrolled: boolean; consented: boolean; allowed: boolean }>; accept?(owner: string, mode: 'closed_beta' | 'public', version: number, now: string): Promise<void> };
type Deps = { config: GatewayConfig; store: RequestStore; providerResolver: ProviderResolver; access: AccessPort; receipts?: MarketReceiptStore; now(): string; id(): string };

function ok(data: unknown) { return { ok: true as const, data }; }
function failure(code: string, message: string, outcomeUnknown = false) { return { ok: false as const, error: { code, message, outcome_unknown: outcomeUnknown } }; }
function safeCode(error: unknown) { const text = error instanceof Error ? error.message : 'PROVIDER_FAILED'; return /^[A-Z0-9_]{3,80}$/.test(text) ? text : 'PROVIDER_FAILED'; }

export function createPortfolioAiHandler(deps: Deps) {
  return async function handle(event: any, context: TrustedContext) {
    if (context.source !== 'wechat-miniprogram' || context.appId !== deps.config.expectedAppId || !context.openId) return failure('UNAUTHORIZED_SOURCE', '调用来源未通过验证。');
    const owner = context.openId, action = event?.action, accessMode = deps.config.accessMode ?? 'closed_beta';
    const access = deps.access.status ? await deps.access.status(owner, accessMode, deps.config.consentVersion) : { enrolled: await deps.access.allowed(owner), consented: await deps.access.allowed(owner), allowed: await deps.access.allowed(owner) };
    const authorized = access.allowed;
    if (action === 'capabilities') { const usage = await deps.store.usage(owner, deps.now()); return ok({ schemaVersion: 1, enabled: deps.config.enabled, authorized, enrolled: access.enrolled, consented: access.consented, accessMode, principalHash: sha256(owner), providerConfigured: deps.providerResolver.configured(), credentialMode: 'sponsored', byokEnabled: deps.providerResolver.byokEnabled(), consentVersion: deps.config.consentVersion, usage: { date: usage.date, used: usage.used, inflight: usage.inflight, timezone: 'UTC' }, limits: { dailyRequests: deps.config.dailyLimit, globalDailyRequests: deps.config.globalDailyLimit ?? deps.config.dailyLimit, maxInflight: deps.config.maxInflight, maxInputBytes: deps.config.maxInputBytes, maxOutputTokens: deps.config.maxOutputTokens } }); }
    if (action === 'consent') {
      if (event?.accepted !== true || event?.consent_version !== deps.config.consentVersion) return failure('CONSENT_REQUIRED', '需要确认当前云处理说明。');
      if (!deps.access.accept) return failure('CONSENT_UNAVAILABLE', '服务端尚未配置同意记录。');
      try { await deps.access.accept(owner, accessMode, deps.config.consentVersion, deps.now()); return ok({ accepted: true, consentVersion: deps.config.consentVersion }); } catch { return failure('ACCESS_DENIED', accessMode === 'closed_beta' ? '当前账号尚未加入体验范围。' : '无法保存云处理同意。'); }
    }
    if (!authorized) return failure('ACCESS_DENIED', '当前用户未在开发许可名单中。');
    if (action === 'analyze') {
      if (!deps.config.enabled || !deps.providerResolver.configured()) return failure('SERVICE_NOT_CONFIGURED', '真实模型服务尚未启用或配置。');
      const parsedV2 = researchTurnEnvelopeV2Schema.safeParse(event.envelope), parsedV1 = researchTurnEnvelopeV1Schema.safeParse(event.envelope);
      let envelope: ResearchTurnEnvelopeV1 | ResearchTurnEnvelopeV2;
      if (parsedV2.success) envelope = parsedV2.data;
      else if (parsedV1.success) envelope = parsedV1.data;
      else return failure('INVALID_ENVELOPE', '请求协议或来源快照校验失败。');
      const now = deps.now(), bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
      if (bytes > deps.config.maxInputBytes) return failure('INPUT_TOO_LARGE', '请求超过服务端输入上限。');
      if (envelope.consent.scope_version !== deps.config.consentVersion || Date.parse(envelope.prepared_at) > Date.parse(now) + 60_000 || Date.parse(envelope.expires_at) < Date.parse(now) || Date.parse(envelope.expires_at) - Date.parse(envelope.prepared_at) > deps.config.maxExpiryMs) return failure('REQUEST_EXPIRED', '请求确认已过期或版本不匹配。');
      const prior = await deps.store.get(owner, envelope.request.request_id);
      if (prior) return prior.digest === envelope.payload_digest ? ok({ requestId: prior.requestId, status: prior.state === 'acked' ? 'succeeded' : prior.state, responseDigest: prior.responseDigest ?? prior.response?.response_digest, errorCode: prior.errorCode }) : failure('IDEMPOTENCY_CONFLICT', '同一请求身份对应了不同内容。');
      let receipt: MarketReceipt | undefined;
      if (envelope.transport_version === 2 && envelope.market.use_market_data) {
        if (!deps.receipts) return failure('MARKET_RECEIPT_UNAVAILABLE', '行情凭据服务不可用。');
        try { receipt = await deps.receipts.resolve(owner, envelope.market.receipt_id, now); }
        catch (error) { return failure(error instanceof Error && error.message === 'RECEIPT_EXPIRED' ? 'RECEIPT_EXPIRED' : 'RECEIPT_INVALID', '行情快照已过期，请重新预览。'); }
        if (!receipt || receipt.digest !== envelope.market.receipt_digest || receipt.purpose !== envelope.request.mode || receipt.acceptedRequestId && receipt.acceptedRequestId !== envelope.request.request_id) return failure('RECEIPT_INVALID', '行情凭据不匹配、已被其他请求使用，或不属于当前用户。');
      }
      const token = deps.id(), claim = await deps.store.claim({ owner, envelope, now, dailyLimit: deps.config.dailyLimit, globalDailyLimit: deps.config.globalDailyLimit, maxInflight: deps.config.maxInflight, executionToken: token });
      if (claim.kind === 'conflict') return failure('IDEMPOTENCY_CONFLICT', '同一请求身份对应了不同内容。');
      if (claim.kind === 'quota') return failure('DAILY_LIMIT', '已达当日真实生成上限。');
      if (claim.kind === 'global_quota') return failure('SERVICE_BUDGET_EXHAUSTED', '今日平台 AI 预算已用完，请稍后再试。');
      if (claim.kind === 'inflight') return failure('INFLIGHT_LIMIT', '已有一个生成任务在进行。');
      if (claim.kind === 'existing') return ok({ requestId: claim.record.requestId, status: claim.record.state === 'acked' ? 'succeeded' : claim.record.state, responseDigest: claim.record.responseDigest ?? claim.record.response?.response_digest, errorCode: claim.record.errorCode });
      try {
        if (receipt && deps.receipts) receipt = await deps.receipts.bind(owner, receipt.id, receipt.digest, envelope.request.request_id, new Date(Date.parse(now) + 24 * 60 * 60_000).toISOString());
        const externalSources = receipt ? receipt.quotes.filter(quote => quote.status === 'available' && quote.as_of).map(quote => {
          const content = JSON.stringify(quote);
          return { id: deps.id(), origin_entity_id: receipt!.id, origin_revision: receipt!.id, type: 'quote' as const, as_of: quote.as_of!, available_at: quote.received_at, content_digest: sha256(content), content };
        }) : [];
        const providerEnvelope = externalSources.length ? { ...envelope, source_snapshots: [...envelope.source_snapshots, ...externalSources] } : envelope;
        const resolved = await deps.providerResolver.resolve(owner, event.credential_mode === 'byok' ? 'byok' : 'sponsored');
        const value = await resolved.provider.invoke(providerEnvelope, token);
        const completedAt = deps.now();
        const manifest = { schema_version: 2 as const, request_id: envelope.request.request_id, workspace_instance_id: envelope.request.workspace_instance_id, portfolio_id: envelope.request.portfolio_id, built_at: completedAt, known_at: completedAt, personal_snapshot_at: envelope.request.personal_snapshot_at, sources: [...envelope.source_snapshots.map(source => ({ id: source.id, revision: source.id, type: source.type, as_of: source.as_of, available_at: source.available_at, content_hash: source.content_digest, quality: source.type === 'ledger' ? 'client_computed' as const : 'user_reported' as const })), ...externalSources.map(source => ({ id: source.id, revision: source.origin_revision, type: source.type, as_of: source.as_of, available_at: source.available_at, content_hash: source.content_digest, quality: 'provider_observed' as const }))], omissions: receipt?.quotes.filter(quote => quote.status === 'unavailable').map(quote => ({ reason: 'missing' as const, description: `${quote.symbol}: ${quote.reason}` })) ?? [] };
        const result = validateAnalysisResultV2(value.result, envelope.request, manifest);
        const execution = { provider_id: value.providerId, protocol: value.protocol, model: value.model, credential_mode: value.credentialMode, started_at: claim.record.createdAt, completed_at: completedAt, input_units: value.inputUnits, output_units: value.outputUnits };
        const response = envelope.transport_version === 2 ? sealResearchResponseV2({ transport_version: 2, request_id: envelope.request.request_id, workspace_instance_id: envelope.request.workspace_instance_id, portfolio_id: envelope.request.portfolio_id, status: 'succeeded', run_id: deps.id(), receipt: receipt ? { receipt_id: receipt.id, receipt_digest: receipt.digest } : null, manifest, external_source_snapshots: externalSources, result, execution }) : sealResearchResponseV1({ transport_version: 1, request_id: envelope.request.request_id, workspace_instance_id: envelope.request.workspace_instance_id, status: 'succeeded', run_id: deps.id(), manifest, result, execution });
        await deps.store.finish(owner, envelope.request.request_id, token, response);
        return ok({ requestId: envelope.request.request_id, status: 'succeeded', responseDigest: response.response_digest });
      } catch (error) {
        const code = safeCode(error); await deps.store.fail(owner, envelope.request.request_id, token, 'outcome_unknown', code);
        return failure(code, '上游调用结果待核验，不会自动重新生成。', true);
      }
    }
    if (!['status', 'result', 'ack'].includes(action)) return failure('UNKNOWN_ACTION', '不支持的云函数 action。');
    const record = await deps.store.get(owner, String(event.request_id ?? ''));
    if (!record) return failure('NOT_FOUND', '请求不存在或不属于当前用户。');
    if (record.digest !== event.payload_digest) return failure('DIGEST_CONFLICT', '请求摘要不匹配。');
    if (action === 'status') return ok({ requestId: record.requestId, status: record.state === 'acked' ? 'succeeded' : record.state, responseDigest: record.responseDigest ?? record.response?.response_digest, errorCode: record.errorCode });
    if (action === 'result') return record.response ? ok(record.response) : failure(record.state === 'acked' ? 'RESULT_ACKED' : 'RESULT_NOT_READY', record.state === 'acked' ? '结果已确认本地保存，云端正文已清理。' : '结果尚未就绪。');
    try {
      const receiptId = record.envelope?.transport_version === 2 && record.envelope.market.use_market_data ? record.envelope.market.receipt_id : null;
      await deps.store.ack(owner, record.requestId, record.digest, String(event.response_digest ?? ''), deps.now());
      if (receiptId && deps.receipts) await deps.receipts.remove(owner, receiptId);
      return ok({ acknowledged: true });
    } catch { return failure('ACK_CONFLICT', '结果确认摘要不匹配。'); }
  };
}
