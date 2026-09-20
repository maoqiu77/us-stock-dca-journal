import { enrichEtfHistory } from './etf-history.ts';
import { domesticBoardSchema, type DomesticBoard } from '@portfolio/market-data/domestic';
import type { MarketCachePort } from './ports.ts';
export type DomesticGrant = { enabled: boolean; tokenConfigured: boolean; publicDisplay: boolean; cacheAllowed: boolean; validUntil: string; reference: string; cacheSeconds: number };
export function domesticBlocker(grant: DomesticGrant, now: string) {
  if (!grant.enabled) return '国内基金行情尚未启用';
  if (!grant.tokenConfigured) return '国内基金数据源尚未配置';
  if (!grant.publicDisplay || !grant.cacheAllowed || !grant.reference.trim() || !Number.isFinite(Date.parse(grant.validUntil)) || Date.parse(grant.validUntil) <= Date.parse(now)) return '国内行情公开展示授权尚未确认或已到期';
  if (!Number.isInteger(grant.cacheSeconds) || grant.cacheSeconds < 60 || grant.cacheSeconds > 86400) return '国内行情缓存期限尚未配置';
  return '';
}
export function createDomesticBoard(options: { grant: DomesticGrant | { mode: 'public_endpoint'; enabled: boolean; cacheSeconds: number }; provider?: { board(segment: 'etf' | 'fund'): Promise<DomesticBoard> }; cache: MarketCachePort; now(): string }) {
  const inflight = new Map<string, Promise<DomesticBoard>>();
  async function load(segment: 'etf' | 'fund'): Promise<DomesticBoard> {
    const now = options.now(), reason = 'mode' in options.grant ? (!options.grant.enabled ? '国内基金行情尚未启用' : !Number.isInteger(options.grant.cacheSeconds) || options.grant.cacheSeconds < 60 || options.grant.cacheSeconds > 86400 ? '国内行情缓存期限尚未配置' : '') : domesticBlocker(options.grant, now);
    if (reason || !options.provider) return { segment, status: 'unavailable', reason: reason || '国内数据服务尚未配置', rows: [] };
    const key = `cn-board:v1:${'mode' in options.grant ? 'eastmoney-public-v1' : options.grant.reference}:${segment}`;
    const cached = await options.cache.get(key).catch(() => undefined), parsed = domesticBoardSchema.safeParse(cached?.value);
    if (cached && parsed.success && cached.expiresAt > now) return parsed.data;
    try {
      const result = domesticBoardSchema.parse(await options.provider.board(segment));
      if (result.segment !== segment) throw Error('SEGMENT_MISMATCH');
      if (result.status === 'unavailable') throw Error('CN_NO_OBSERVATION');
      if ('mode' in options.grant) await enrichEtfHistory(result, options.cache, now);
      // Retention is exactly the confirmed cache window; never retain indefinitely.
      const until = new Date(Math.min(Date.parse(now) + options.grant.cacheSeconds * 1000, 'mode' in options.grant ? Infinity : Date.parse(options.grant.validUntil))).toISOString();
      await options.cache.put(key, result, until, until).catch(() => undefined);
      return result;
    } catch {
      return { segment, status: 'unavailable', reason: '国内数据源暂不可用或额度不足，未取得价格 / 正式净值。', rows: [] };
    }
  }
  return { load(segment: 'etf' | 'fund') { const old = inflight.get(segment); if (old) return old; const pending = load(segment).finally(() => inflight.delete(segment)); inflight.set(segment, pending); return pending; } };
}
