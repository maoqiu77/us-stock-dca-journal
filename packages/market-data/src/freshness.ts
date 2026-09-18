export type FreshnessPolicy = { timeliness: 'realtime' | 'delayed' | 'eod' | 'unknown'; delaySeconds: number | null; graceSeconds: number; marketOpen: boolean; latestCompletedTradingDate?: string };
export function evaluateFreshness(asOf: string | null, now: string, tradingDate: string | null, policy: FreshnessPolicy): 'current' | 'stale' | 'unknown' {
  if (!asOf || !Number.isFinite(Date.parse(asOf)) || !Number.isFinite(Date.parse(now)) || policy.timeliness === 'unknown') return 'unknown';
  if (Date.parse(asOf) > Date.parse(now) + 60_000) return 'unknown';
  if (policy.timeliness === 'eod' || !policy.marketOpen) return tradingDate && policy.latestCompletedTradingDate === tradingDate ? 'current' : 'stale';
  if (policy.delaySeconds === null) return 'unknown';
  return Date.parse(now) - Date.parse(asOf) <= (policy.delaySeconds + policy.graceSeconds) * 1000 ? 'current' : 'stale';
}
