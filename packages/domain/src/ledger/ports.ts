import type { Instrument, LedgerEvent, Policy, Portfolio } from "./schema.ts";

export type EventQuery = { portfolio_id: string; instrument_id?: string; through_date?: string; known_at?: string };
export interface LedgerReadPort {
  getPortfolio(id: string): Promise<Readonly<Portfolio> | null>;
  getInstruments(portfolio_id: string): Promise<readonly Readonly<Instrument>[]>;
  getRevisions(query: EventQuery): Promise<readonly Readonly<LedgerEvent>[]>;
  getPolicy(portfolio_id: string): Promise<Readonly<Policy>>;
}
// Supplied by application adapters; the domain never creates IDs or reads time.
export interface IdSource { nextId(): string; }
export interface Clock { now(): string; }
