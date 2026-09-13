import { researchTurnEnvelopeV1Schema, sealResearchResponseV1, sha256, validateAnalysisResultV2 } from '@portfolio/ai-context';
import type { ProviderResolver } from './credentials.ts';
import type { RequestStore } from './request-store.ts';

export type TrustedContext = { appId: string; openId: string; source: 'wechat-miniprogram' };
export type GatewayConfig = { expectedAppId: string; enabled: boolean; consentVersion: 1; dailyLimit: number; maxInflight: number; maxInputBytes: number; maxOutputTokens: number; maxExpiryMs: number; providerConfigured: boolean };
export type AccessPort = { allowed(owner: string): Promise<boolean> };
type Deps = { config: GatewayConfig; store: RequestStore; providerResolver: ProviderResolver; access: AccessPort; now(): string; id(): string };

function ok(data: unknown) { return { ok: true as const, data }; }
function failure(code: string, message: string, outcomeUnknown = false) { return { ok: false as const, error: { code, message, outcome_unknown: outcomeUnknown } }; }
function safeCode(error: unknown) { const text = error instanceof Error ? error.message : 'PROVIDER_FAILED'; return /^[A-Z0-9_]{3,80}$/.test(text) ? text : 'PROVIDER_FAILED'; }

export function createPortfolioAiHandler(deps: Deps) {
  return async function handle(event: any, context: TrustedContext) {
    if (context.source !== 'wechat-miniprogram' || context.appId !== deps.config.expectedAppId || !context.openId) return failure('UNAUTHORIZED_SOURCE', '调用来源未通过验证。');
    const owner = context.openId, authorized = await deps.access.allowed(owner), action = event?.action;
    if (action === 'capabilities') return ok({ enabled: deps.config.enabled, authorized, principalHash: sha256(owner), providerConfigured: deps.providerResolver.configured(), credentialMode: 'sponsored', byokEnabled: deps.providerResolver.byokEnabled(), consentVersion: deps.config.consentVersion, limits: { dailyRequests: deps.config.dailyLimit, maxInflight: deps.config.maxInflight, maxInputBytes: deps.config.maxInputBytes, maxOutputTokens: deps.config.maxOutputTokens } });
    if (!authorized) return failure('ACCESS_DENIED', '当前用户未在开发许可名单中。');
    if (action === 'analyze') {
      if (!deps.config.enabled || !deps.providerResolver.configured()) return failure('SERVICE_NOT_CONFIGURED', '真实模型服务尚未启用或配置。');
      const parsed = researchTurnEnvelopeV1Schema.safeParse(event.envelope);
      if (!parsed.success) return failure('INVALID_ENVELOPE', '请求协议或来源快照校验失败。');
      const envelope = parsed.data, now = deps.now(), bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
      if (bytes > deps.config.maxInputBytes) return failure('INPUT_TOO_LARGE', '请求超过服务端输入上限。');
      if (envelope.consent.scope_version !== deps.config.consentVersion || Date.parse(envelope.prepared_at) > Date.parse(now) + 60_000 || Date.parse(envelope.expires_at) < Date.parse(now) || Date.parse(envelope.expires_at) - Date.parse(envelope.prepared_at) > deps.config.maxExpiryMs) return failure('REQUEST_EXPIRED', '请求确认已过期或版本不匹配。');
      const token = deps.id(), claim = await deps.store.claim({ owner, envelope, now, dailyLimit: deps.config.dailyLimit, maxInflight: deps.config.maxInflight, executionToken: token });
      if (claim.kind === 'conflict') return failure('IDEMPOTENCY_CONFLICT', '同一请求身份对应了不同内容。');
      if (claim.kind === 'quota') return failure('DAILY_LIMIT', '已达当日真实生成上限。');
      if (claim.kind === 'inflight') return failure('INFLIGHT_LIMIT', '已有一个生成任务在进行。');
      if (claim.kind === 'existing') return ok({ requestId: claim.record.requestId, status: claim.record.state === 'acked' ? 'succeeded' : claim.record.state, responseDigest: claim.record.responseDigest ?? claim.record.response?.response_digest, errorCode: claim.record.errorCode });
      try {
        const resolved = await deps.providerResolver.resolve(owner, event.credential_mode === 'byok' ? 'byok' : 'sponsored');
        const value = await resolved.provider.invoke(envelope, token);
        const completedAt = deps.now();
        const manifest = { schema_version: 2 as const, request_id: envelope.request.request_id, workspace_instance_id: envelope.request.workspace_instance_id, portfolio_id: envelope.request.portfolio_id, built_at: completedAt, known_at: completedAt, personal_snapshot_at: envelope.request.personal_snapshot_at, sources: envelope.source_snapshots.map(source => ({ id: source.id, revision: source.id, type: source.type, as_of: source.as_of, available_at: source.available_at, content_hash: source.content_digest, quality: source.type === 'ledger' ? 'client_computed' as const : 'user_reported' as const })), omissions: [] };
        const result = validateAnalysisResultV2(value.result, envelope.request, manifest);
        const response = sealResearchResponseV1({ transport_version: 1, request_id: envelope.request.request_id, workspace_instance_id: envelope.request.workspace_instance_id, status: 'succeeded', run_id: deps.id(), manifest, result, execution: { provider_id: value.providerId, protocol: value.protocol, model: value.model, credential_mode: value.credentialMode, started_at: claim.record.createdAt, completed_at: completedAt, input_units: value.inputUnits, output_units: value.outputUnits } });
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
    try { await deps.store.ack(owner, record.requestId, record.digest, String(event.response_digest ?? ''), deps.now()); return ok({ acknowledged: true }); } catch { return failure('ACK_CONFLICT', '结果确认摘要不匹配。'); }
  };
}
