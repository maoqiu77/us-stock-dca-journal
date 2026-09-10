import type { Decimal } from "decimal.js";
import { decimal, decimalText } from "./money.ts";
import { portfolioSchema, instrumentSchema, ledgerEventSchema, dateSchema, timestampSchema, type Portfolio, type Instrument, type LedgerEvent } from "./schema.ts";

export type ProjectionCutoff = { through_date: string; known_at: string };
export type LedgerError = { code: string; record_id?: string };
export type LedgerResult = { ok: true; value: LedgerProjection } | { ok: false; error: LedgerError };
export type ProjectedPosition = { instrument_id: string; quantity: string; remaining_cost: string; unit_cost: string | null; realized_pnl: string };
export type LedgerProjection = {
  version: 1; portfolio_id: string; currency: "USD"; through_date: string; known_at: string;
  cash_state: "unknown" | "reconciled"; cash: string | null; realized_pnl: string;
  history_complete: boolean; cost_method: Portfolio["cost_method"];
  positions: ProjectedPosition[];
  input_head: Array<{ record_id: string; revision_id: string; voided: boolean }>;
};
type Lot = { quantity: Decimal; cost: Decimal };
type Holding = { lots: Lot[]; realized: Decimal };
class ProjectionFailure extends Error {
  readonly issue: LedgerError;
  constructor(code: string, event?: LedgerEvent) { super(code); this.issue = { code, ...(event ? { record_id: event.record_id } : {}) }; }
}
function reject(code: string, event?: LedgerEvent): never { throw new ProjectionFailure(code, event); }

function effectiveRevisions(events: LedgerEvent[], knownAt: string): LedgerEvent[] {
  const revisions = new Map<string, LedgerEvent>();
  for (const event of events) {
    const existing = revisions.get(event.revision_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(event)) reject("revision_collision", event);
    revisions.set(event.revision_id, event);
  }
  const visible = [...revisions.values()].filter(event => Date.parse(event.recorded_at) <= Date.parse(knownAt));
  const groups = new Map<string, LedgerEvent[]>();
  for (const event of visible) {
    if (event.parent_revision) {
      const parent = revisions.get(event.parent_revision);
      if (!parent) reject("missing_parent_revision", event);
      if (parent.record_id !== event.record_id || Date.parse(parent.recorded_at) > Date.parse(event.recorded_at)) reject("invalid_revision_parent", event);
    }
    const group = groups.get(event.record_id) ?? [];
    group.push(event); groups.set(event.record_id, group);
  }
  const active: LedgerEvent[] = [];
  for (const group of groups.values()) {
    const roots = group.filter(event => event.parent_revision === null);
    const children = new Map<string, LedgerEvent[]>();
    for (const event of group) {
      if (event.parent_revision) children.set(event.parent_revision, [...(children.get(event.parent_revision) ?? []), event]);
    }
    if (roots.length !== 1 || [...children.values()].some(list => list.length !== 1)) reject("revision_conflict", group[0]);
    let current = roots[0];
    const visited = new Set<string>();
    while (true) {
      if (visited.has(current.revision_id)) reject("revision_conflict", current);
      visited.add(current.revision_id);
      const next = children.get(current.revision_id)?.[0];
      if (!next) break;
      current = next;
    }
    if (visited.size !== group.length) reject("revision_conflict", current);
    active.push(current);
  }
  return active;
}

function localDate(timestamp: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(timestamp));
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}
function quantity(holding: Holding): Decimal { return holding.lots.reduce((sum, lot) => sum.plus(lot.quantity), decimal("0")); }

/** Explicit cutoffs only. No clock, network, database, generated IDs or float accounting. */
export function projectLedger(portfolioInput: Portfolio, instrumentsInput: readonly Instrument[], eventsInput: readonly LedgerEvent[], cutoff: ProjectionCutoff): LedgerResult {
  try {
    const account = portfolioSchema.safeParse(portfolioInput);
    if (!account.success || !dateSchema.safeParse(cutoff.through_date).success || !timestampSchema.safeParse(cutoff.known_at).success) reject("invalid_schema");
    const portfolio = account.data;
    if (cutoff.through_date < portfolio.opening_date) reject("before_opening");
    const instruments = new Map<string, Instrument>();
    for (const raw of instrumentsInput) {
      const parsed = instrumentSchema.safeParse(raw);
      if (!parsed.success) reject("invalid_schema");
      if (instruments.has(parsed.data.id)) reject("duplicate_instrument");
      instruments.set(parsed.data.id, parsed.data);
    }
    const events = eventsInput.map(raw => {
      const parsed = ledgerEventSchema.safeParse(raw);
      if (!parsed.success) reject("invalid_schema");
      if (parsed.data.portfolio_id !== portfolio.id) reject("portfolio_mismatch", parsed.data);
      return parsed.data;
    });
    const active = effectiveRevisions(events, cutoff.known_at).filter(event => event.trade_date <= cutoff.through_date);
    const ordered = active.filter(event => !event.voided).sort((a, b) => a.trade_date.localeCompare(b.trade_date) || a.sequence - b.sequence);
    let previous: LedgerEvent | undefined;
    let lastTimed: LedgerEvent | undefined;
    for (const event of ordered) {
      if (event.trade_date < portfolio.opening_date) reject("event_before_opening", event);
      if (previous?.trade_date === event.trade_date && previous.sequence === event.sequence) reject("order_conflict", event);
      if (previous?.trade_date !== event.trade_date) lastTimed = undefined;
      if (event.executed_at) {
        if (localDate(event.executed_at, portfolio.timezone) !== event.trade_date) reject("event_date_mismatch", event);
        if (lastTimed?.executed_at && Date.parse(lastTimed.executed_at) > Date.parse(event.executed_at)) reject("order_conflict", event);
        lastTimed = event;
      }
      if ("instrument_id" in event && !instruments.has(event.instrument_id)) reject("unknown_instrument", event);
      previous = event;
    }
    const cashOpenings = ordered.filter(event => event.kind === "opening_cash");
    if (cashOpenings.length > 1) reject("duplicate_opening_cash");
    if (portfolio.cash_state === "reconciled" && cashOpenings.length !== 1) reject("missing_opening_cash");
    if (portfolio.cash_state === "unknown" && cashOpenings.length) reject("cash_state_mismatch");
    const holdings = new Map<string, Holding>();
    const openingPositions = new Set<string>();
    const traded = new Set<string>();
    let cash: Decimal | null = null;
    let cashMoved = false;
    let realized = decimal("0");
    for (const event of ordered) {
      const holding = "instrument_id" in event ? holdings.get(event.instrument_id) ?? { lots: [], realized: decimal("0") } : undefined;
      let delta = decimal("0");
      switch (event.kind) {
        case "opening_cash":
          if (event.trade_date !== portfolio.opening_date || cashMoved) reject("invalid_opening_order", event);
          cash = decimal(event.amount); break;
        case "opening_position":
          if (portfolio.history_complete || event.trade_date !== portfolio.opening_date || openingPositions.has(event.instrument_id) || traded.has(event.instrument_id)) reject("invalid_opening_position", event);
          openingPositions.add(event.instrument_id);
          holding!.lots.push({ quantity: decimal(event.quantity), cost: decimal(event.total_cost) }); break;
        case "buy":
          traded.add(event.instrument_id);
          delta = decimal(event.amount).plus(decimal(event.fee)).negated();
          holding!.lots.push({ quantity: decimal(event.quantity), cost: delta.negated() }); break;
        case "sell": {
          traded.add(event.instrument_id);
          let remaining = decimal(event.quantity);
          if (remaining.gt(quantity(holding!))) reject("oversell", event);
          let consumedCost = decimal("0");
          while (remaining.gt(0)) {
            const lot = holding!.lots[0];
            const take = remaining.lte(lot.quantity) ? remaining : lot.quantity;
            const cost = take.eq(lot.quantity) ? lot.cost : lot.cost.times(take).div(lot.quantity);
            consumedCost = consumedCost.plus(cost);
            lot.quantity = lot.quantity.minus(take); lot.cost = lot.cost.minus(cost);
            remaining = remaining.minus(take);
            if (lot.quantity.isZero()) holding!.lots.shift();
          }
          delta = decimal(event.amount).minus(decimal(event.fee));
          const gain = delta.minus(consumedCost);
          holding!.realized = holding!.realized.plus(gain); realized = realized.plus(gain);
          break;
        }
        case "deposit": case "cash_dividend": delta = decimal(event.amount); break;
        case "withdrawal": case "fee": delta = decimal(event.amount).negated(); break;
        case "split":
          traded.add(event.instrument_id);
          if (!holding!.lots.length) reject("split_without_position", event);
          for (const lot of holding!.lots) {
            const next = lot.quantity.times(decimal(event.numerator)).div(decimal(event.denominator));
            if (next.decimalPlaces() > 12) reject("split_precision_requires_confirmation", event);
            lot.quantity = next;
          }
          break;
      }
      if ("instrument_id" in event) holdings.set(event.instrument_id, holding!);
      if (event.kind !== "opening_cash" && event.kind !== "opening_position" && event.kind !== "split") {
        cashMoved = true;
        if (portfolio.cash_state === "reconciled" && cash === null) reject("invalid_opening_order", event);
        if (cash !== null) { cash = cash.plus(delta); if (cash.lt(0)) reject("negative_cash", event); }
      }
    }
    return { ok: true, value: {
      version: 1, portfolio_id: portfolio.id, currency: "USD", ...cutoff,
      cash_state: portfolio.cash_state, cash: cash === null ? null : decimalText(cash), realized_pnl: decimalText(realized),
      history_complete: portfolio.history_complete, cost_method: portfolio.cost_method,
      positions: [...holdings].sort(([a], [b]) => a.localeCompare(b)).map(([instrument_id, holding]) => {
        const shares = quantity(holding), cost = holding.lots.reduce((sum, lot) => sum.plus(lot.cost), decimal("0"));
        return { instrument_id, quantity: decimalText(shares), remaining_cost: decimalText(cost), unit_cost: shares.gt(0) ? decimalText(cost.div(shares)) : null, realized_pnl: decimalText(holding.realized) };
      }),
      input_head: active.sort((a, b) => a.record_id.localeCompare(b.record_id)).map(({ record_id, revision_id, voided }) => ({ record_id, revision_id, voided })),
    } };
  } catch (error) {
    if (error instanceof ProjectionFailure) return { ok: false, error: error.issue };
    throw error;
  }
}
