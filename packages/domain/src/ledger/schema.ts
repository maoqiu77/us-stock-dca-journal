import { z } from "zod";
import { decimal, decimalStringSchema, moneyStringSchema, positiveDecimalSchema, positiveMoneySchema } from "./money.ts";

export const idSchema = z.uuidv4();
export const dateSchema = z.iso.date();
export const timestampSchema = z.iso.datetime({ offset: true }).refine(value => Number.isFinite(Date.parse(value)), "invalid_timestamp");
export const timezoneSchema = z.string().max(100).refine(value => {
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }); return true; }
  catch { return false; }
}, "invalid_timezone");

export const portfolioSchema = z.strictObject({
  schema_version: z.literal(1), id: idSchema, name: z.string().min(1).max(120),
  base_currency: z.literal("USD"), timezone: timezoneSchema,
  cash_state: z.enum(["unknown", "reconciled"]), history_complete: z.boolean(),
  cost_method: z.enum(["fifo", "opening_aggregate_then_fifo"]), opening_date: dateSchema,
}).refine(value => value.history_complete === (value.cost_method === "fifo"), "history_cost_method_mismatch");

export const instrumentSchema = z.strictObject({
  id: idSchema, symbol: z.string().regex(/^[A-Z0-9][A-Z0-9.-]{0,14}$/),
  exchange: z.string().min(1).max(32), market: z.literal("US"),
  quote_currency: z.literal("USD"), asset_type: z.enum(["STOCK", "ETF"]), confirmed_at: timestampSchema,
});

const eventFields = {
  schema_version: z.literal(1), record_id: idSchema, revision_id: idSchema,
  parent_revision: idSchema.nullable(), device_id: idSchema, portfolio_id: idSchema,
  trade_date: dateSchema, executed_at: timestampSchema.nullable(),
  sequence: z.number().int().min(0).max(1_000_000_000), recorded_at: timestampSchema,
  provenance: z.strictObject({ source: z.enum(["manual", "legacy_import"]), confirmed_at: timestampSchema, source_ref: z.string().min(1).max(256).optional() }),
  voided: z.boolean(), note: z.string().max(20_000),
};
const tradeFields = { instrument_id: idSchema, quantity: positiveDecimalSchema, price: positiveDecimalSchema, amount: positiveMoneySchema, fee: moneyStringSchema };
const ratioInteger = z.string().regex(/^[1-9]\d{0,8}$/);
export const ledgerEventSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...eventFields, kind: z.literal("opening_cash"), amount: moneyStringSchema }),
  z.strictObject({ ...eventFields, kind: z.literal("opening_position"), instrument_id: idSchema, quantity: positiveDecimalSchema, total_cost: moneyStringSchema }),
  z.strictObject({ ...eventFields, kind: z.literal("buy"), ...tradeFields }),
  z.strictObject({ ...eventFields, kind: z.literal("sell"), ...tradeFields }),
  z.strictObject({ ...eventFields, kind: z.literal("deposit"), amount: positiveMoneySchema }),
  z.strictObject({ ...eventFields, kind: z.literal("withdrawal"), amount: positiveMoneySchema }),
  z.strictObject({ ...eventFields, kind: z.literal("cash_dividend"), instrument_id: idSchema, amount: positiveMoneySchema }),
  z.strictObject({ ...eventFields, kind: z.literal("fee"), amount: positiveMoneySchema }),
  z.strictObject({ ...eventFields, kind: z.literal("split"), instrument_id: idSchema, numerator: ratioInteger, denominator: ratioInteger }),
]).superRefine((event, context) => {
  if (event.parent_revision === event.revision_id) context.addIssue({ code: "custom", path: ["parent_revision"], message: "self_revision" });
  if (event.kind === "buy" || event.kind === "sell") {
    // Refinements must also be safe when earlier scalar validations failed.
    if (positiveDecimalSchema.safeParse(event.quantity).success && positiveDecimalSchema.safeParse(event.price).success && positiveMoneySchema.safeParse(event.amount).success) {
      if (!decimal(event.quantity).times(decimal(event.price)).toDecimalPlaces(4).eq(decimal(event.amount))) context.addIssue({ code: "custom", path: ["amount"], message: "amount_quantity_price_mismatch" });
    }
  }
});

const weightSchema = decimalStringSchema.refine(value => decimalStringSchema.safeParse(value).success && decimal(value).lte(1), "weight_out_of_range");
export const policySchema = z.discriminatedUnion("status", [
  z.strictObject({ portfolio_id: idSchema, status: z.literal("unknown") }),
  z.strictObject({ portfolio_id: idSchema, status: z.literal("confirmed"),
    id: idSchema, revision_id: idSchema, confirmed_at: timestampSchema, effective_from: dateSchema,
    max_single_weight: weightSchema.nullable(), horizon: z.string().max(200).nullable(),
    targets: z.array(z.strictObject({ instrument_id: idSchema, weight: weightSchema })).max(100),
  }),
]).superRefine((policy, context) => {
  if (policy.status !== "confirmed") return;
  const ids = policy.targets.map(target => target.instrument_id);
  if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path: ["targets"], message: "duplicate_target" });
  if (policy.targets.every(target => weightSchema.safeParse(target.weight).success)) {
    const total = policy.targets.reduce((sum, target) => sum.plus(decimal(target.weight)), decimal("0"));
    if (total.gt(1)) context.addIssue({ code: "custom", path: ["targets"], message: "targets_exceed_one" });
  }
});

export type Portfolio = z.infer<typeof portfolioSchema>;
export type Instrument = z.infer<typeof instrumentSchema>;
export type LedgerEvent = z.infer<typeof ledgerEventSchema>;
export type Policy = z.infer<typeof policySchema>;
