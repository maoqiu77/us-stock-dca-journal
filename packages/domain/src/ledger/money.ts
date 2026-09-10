import { Decimal } from "decimal.js";
import { z } from "zod";

// Separate constructor: changing another consumer's Decimal config cannot
// change this ledger's calculations. Values are never constructed from floats.
const LedgerDecimal = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
export const decimalStringSchema = z.string().max(31).regex(/^(?:0|[1-9]\d{0,17})(?:\.\d{0,11}[1-9])?$/);
export const moneyStringSchema = decimalStringSchema.refine(value => (value.split(".")[1]?.length ?? 0) <= 4, "money_precision");
export const positiveDecimalSchema = decimalStringSchema.refine(value => value !== "0", "positive_required");
export const positiveMoneySchema = moneyStringSchema.refine(value => value !== "0", "positive_required");

export function decimal(value: string): Decimal {
  return new LedgerDecimal(decimalStringSchema.parse(value));
}

/** Projection serialization, not a source-record normalization function. */
export function decimalText(value: Decimal, places = 12): string {
  if (!value.isFinite()) throw new Error("non_finite_projection");
  const fixed = value.toDecimalPlaces(places, Decimal.ROUND_HALF_UP).toFixed();
  return fixed === "-0" ? "0" : fixed;
}
