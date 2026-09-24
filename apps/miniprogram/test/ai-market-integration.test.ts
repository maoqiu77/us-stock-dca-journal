import assert from 'node:assert/strict';
import test from 'node:test';
import { sealResearchResponseV2, sha256, type ResearchTurnEnvelopeV2, type ResearchTurnResponseV2 } from '@portfolio/ai-context';
import { createService } from '../src/service.ts';
import type { AiTransport } from '../src/ai/transport.ts';
import type { MarketTransport } from '../src/market/transport.ts';

const id = (n: number) => `86000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-09-13T10:00:00.000Z';
const instrument = { schema_version: 1 as const, instrument_key: 'US:XNAS:AAPL', symbol: 'AAPL', name: 'Apple Inc.', mic: 'XNAS', exchange: 'NASDAQ', market: 'US' as const, currency: 'USD' as const, asset_type: 'STOCK' as const, provider_symbol: 'AAPL', provider_catalog_version: 'v1', status: 'active' as const };
const quote = { schema_version: 1 as const, instrument_key: instrument.instrument_key, symbol: 'AAPL', currency: 'USD' as const, price: '221.10', price_kind: 'last_trade' as const, previous_close: '220', previous_close_date: '2026-09-12', change: '1.10', change_percent: '0.5', volume: '1', volume_scope: 'feed_only' as const, session: 'regular' as const, market_status: 'open' as const, trading_date: '2026-09-13', exchange_timezone: 'America/New_York' as const, provider: 'Twelve Data', feed: 'licensed', coverage: 'venue_subset' as const, timeliness: 'delayed' as const, delay_seconds: 900, as_of: at, received_at: at, served_at: at, freshness: 'current' as const, cache_state: 'miss' as const, status: 'available' as const, reason: null, adjustment: 'unadjusted' as const, attribution: 'Twelve Data' };
const caps = { schema_version: 1 as const, enabled: true, provider_configured: true, authorized: true, access_mode: 'public' as const, quote_access: true, bars_access: true, search_access: true, ai_source_access: true, archive_access: true, provider: 'Twelve Data', feed: 'licensed', coverage: 'venue_subset' as const, timeliness: 'delayed' as const, delay_seconds: 900, attribution: 'Twelve Data', limits: { quote_batch: 30, search_results: 10, bars: 400 } };

test('client seals receipt into V2, archives exact external source, and old analysis survives market cache clearing', async () => {
  let response: ResearchTurnResponseV2 | undefined;
  let requestedSelections: unknown;
  const ai: AiTransport = {
    capabilities: async () => ({ schemaVersion: 1, enabled: true, authorized: true, enrolled: true, consented: true, accessMode: 'public', principalHash: 'a'.repeat(64), providerConfigured: true, credentialMode: 'sponsored', byokEnabled: false, consentVersion: 1, usage: { date: '2026-09-13', used: 0, inflight: 0, timezone: 'UTC' }, limits: { dailyRequests: 10, globalDailyRequests: 100, maxInflight: 1, maxInputBytes: 200000, maxOutputTokens: 1000 } }),
    async analyze(value) {
      assert.equal(value.transport_version, 2); const envelope = value as ResearchTurnEnvelopeV2, body = JSON.stringify(quote), source = { id: id(90), origin_entity_id: id(80), origin_revision: id(80), type: 'quote' as const, as_of: at, available_at: at, content_digest: sha256(body), content: body };
      const ledger = envelope.source_snapshots[0], manifest = { schema_version: 2 as const, request_id: envelope.request.request_id, workspace_instance_id: envelope.request.workspace_instance_id, portfolio_id: envelope.request.portfolio_id, built_at: at, known_at: at, personal_snapshot_at: envelope.request.personal_snapshot_at, sources: [{ id: ledger.id, revision: ledger.id, type: ledger.type, as_of: ledger.as_of, available_at: ledger.available_at, content_hash: ledger.content_digest, quality: 'client_computed' as const }, { id: source.id, revision: source.origin_revision, type: source.type, as_of: source.as_of, available_at: source.available_at, content_hash: source.content_digest, quality: 'provider_observed' as const }], omissions: [] };
      response = sealResearchResponseV2({ transport_version: 2, request_id: envelope.request.request_id, workspace_instance_id: envelope.request.workspace_instance_id, portfolio_id: envelope.request.portfolio_id, status: 'succeeded', run_id: id(91), receipt: { receipt_id: envelope.market.use_market_data ? envelope.market.receipt_id : id(80), receipt_digest: envelope.market.use_market_data ? envelope.market.receipt_digest : sha256('x') }, manifest, external_source_snapshots: [source], result: { schema_version: 2, request_id: envelope.request.request_id, classification: 'ai_generated', mode: envelope.request.mode, summary: '已使用延迟行情', stance: 'observe', evidence: [{ statement: 'AAPL 221.10', source_ids: [source.id] }], counterarguments: [], conditions: [], missing_information: [], candidates: [], next_questions: [] }, execution: { provider_id: 'test', protocol: 'test', model: 'test', credential_mode: 'sponsored', started_at: at, completed_at: at, input_units: 1, output_units: 1 } });
      return { requestId: envelope.request.request_id, status: 'succeeded', responseDigest: response.response_digest };
    }, status: async requestId => ({ requestId, status: 'succeeded', responseDigest: response?.response_digest }), result: async () => response!, ack: async () => {},
  };
  const market: MarketTransport = { capabilities: async () => caps, search: async () => [instrument], quotes: async () => [quote], bars: async () => { throw Error('unused'); }, prepareAnalysisSnapshot: async (_keys, _purpose, selections) => { requestedSelections = selections; return { receipt_id: id(80), receipt_digest: sha256('receipt'), created_at: at, expires_at: '2026-09-13T10:10:00.000Z', provider: 'Twelve Data', feed: 'licensed', attribution: 'Twelve Data', quotes: [quote] }; } };
  const values = new Map<string, string>(); let counter = 0; const service = createService({ get: key => values.get(key) ?? '', set: (key, value) => values.set(key, value), info: () => ({ currentSize: 0, limitSize: 10240 }) }, { today: () => '2026-09-13', now: () => at, id: () => id(++counter) }, { aiTransport: ai, marketTransport: market });
  service.saveTrade({ kind: 'buy', symbol: 'AAPL', assetType: 'STOCK', date: '2026-09-13', quantity: '1', price: '200' }); await service.refreshMarket();
  const input = { origin: 'portfolio' as const, mode: 'portfolio_review' as const, journalDate: '2026-09-13', question: '分析持仓' }, local = service.ai().previewContext(input), marketReceipt = await service.prepareAnalysisMarket(input.mode);
  assert.deepEqual(requestedSelections, [{ market: 'US', symbol: 'AAPL', period: '1day', auxiliary: [] }]);
  const holdingId = service.overview().positions[0].id;
  await service.prepareAnalysisMarket(input.mode, undefined, holdingId);
  assert.deepEqual(requestedSelections, [{ market: 'US', symbol: 'AAPL', period: '1day', auxiliary: [] }]);
  const prepared = service.ai().prepare(input, { ...local, marketReceipt: marketReceipt! }); assert.equal(prepared.envelope.transport_version, 2);
  await service.ai().submitPrepared(prepared); service.clearMarketCache();
  const state = service.journal().read(), archived = state.sources.find(source => source.type === 'quote');
  assert.equal(JSON.parse(archived!.content).price, '221.10'); assert.equal(state.runs[0].source_ids.includes(archived!.id), true);
});
