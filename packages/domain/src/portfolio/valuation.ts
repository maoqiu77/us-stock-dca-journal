import { decimal, decimalStringSchema, decimalText } from "../ledger/money.ts";
import { timestampSchema } from "../ledger/schema.ts";
import type { LedgerProjection } from "../ledger/project.ts";

export type MarketObservation = { instrument_id: string; price: string; currency: string; source: string; as_of: string; received_at: string; quality: "manual" | "cached" | "stale" | "sample" | "unknown" };
// Derived totals may be wider than any individual persisted source amount.
function projectedDecimal(value: string) {
  if (!/^(?:0|[1-9]\d{0,79})(?:\.\d{1,12})?$/.test(value)) throw new Error("invalid_projection_value");
  return decimal("0").plus(value);
}
export function valuePortfolio(projection: LedgerProjection, observations: readonly MarketObservation[], options: { as_of: string; max_age_ms: number }) {
  if (!timestampSchema.safeParse(options.as_of).success || !Number.isFinite(options.max_age_ms) || options.max_age_ms < 0) throw new Error("invalid_valuation_options");
  const asOf = Date.parse(options.as_of);
  const positions = projection.positions.filter(position => projectedDecimal(position.quantity).gt(0)).map(position => {
    const candidates = observations.filter(quote => quote.instrument_id === position.instrument_id && quote.currency === projection.currency && quote.source.trim() && quote.quality !== "sample" && quote.quality !== "unknown" && decimalStringSchema.safeParse(quote.price).success && timestampSchema.safeParse(quote.as_of).success && timestampSchema.safeParse(quote.received_at).success && Date.parse(quote.as_of) <= asOf && Date.parse(quote.received_at) <= asOf && Date.parse(quote.as_of) <= Date.parse(quote.received_at));
    candidates.sort((a, b) => Date.parse(b.as_of) - Date.parse(a.as_of) || Date.parse(b.received_at) - Date.parse(a.received_at));
    const quote = candidates[0];
    // Equal timestamp but different prices needs source clarification.
    const conflicting = quote && candidates.some(other => Date.parse(other.as_of) === Date.parse(quote.as_of) && Date.parse(other.received_at) === Date.parse(quote.received_at) && other.price !== quote.price);
    const stale = Boolean(quote && (quote.quality === "stale" || asOf - Date.parse(quote.as_of) > options.max_age_ms));
    return { ...position, quote: conflicting ? null : quote ?? null, stale,
      market_value: quote && !conflicting ? decimalText(projectedDecimal(position.quantity).times(decimal(quote.price))) : null,
      weight: null as string | null,
    };
  });
  const available = positions.filter(position => position.market_value !== null);
  const complete = available.length === positions.length && !positions.some(position => position.stale) && projection.cash !== null;
  const observed = available.reduce((sum, position) => sum.plus(projectedDecimal(position.market_value!)), decimal("0"));
  const net = complete ? observed.plus(projectedDecimal(projection.cash!)) : null;
  if (net?.gt(0)) for (const position of positions) position.weight = decimalText(projectedDecimal(position.market_value!).div(net));
  return { status: complete ? "complete" as const : available.length ? "partial" as const : "unknown" as const,
    as_of: options.as_of, observed_market_value: decimalText(observed), net_value: net ? decimalText(net) : null, positions };
}
