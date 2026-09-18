import type { CanonicalInstrument } from './contracts.ts';

export type LedgerInstrument = { id: string; symbol: string; asset_type: 'STOCK' | 'ETF'; exchange?: string };
export type MappingResult =
  | { kind: 'matched'; ledger_instrument_id: string; instrument: CanonicalInstrument }
  | { kind: 'unresolved'; ledger_instrument_id: string; reason: 'invalid_symbol' | 'not_found' | 'inactive' | 'type_conflict' }
  | { kind: 'ambiguous'; ledger_instrument_id: string; candidates: CanonicalInstrument[] };

export function resolveLedgerInstrument(ledger: LedgerInstrument, catalog: readonly CanonicalInstrument[]): MappingResult {
  const symbol = ledger.symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) return { kind: 'unresolved', ledger_instrument_id: ledger.id, reason: 'invalid_symbol' };
  const symbolMatches = catalog.filter(item => item.symbol === symbol);
  if (!symbolMatches.length) return { kind: 'unresolved', ledger_instrument_id: ledger.id, reason: 'not_found' };
  const active = symbolMatches.filter(item => item.status === 'active');
  if (!active.length) return { kind: 'unresolved', ledger_instrument_id: ledger.id, reason: 'inactive' };
  const typed = active.filter(item => item.asset_type === ledger.asset_type);
  if (!typed.length) return { kind: 'unresolved', ledger_instrument_id: ledger.id, reason: 'type_conflict' };
  const exchange = ledger.exchange?.trim().toUpperCase();
  const narrowed = exchange && exchange !== 'UNSPECIFIED' ? typed.filter(item => item.mic === exchange || item.exchange.toUpperCase() === exchange) : typed;
  if (narrowed.length === 1) return { kind: 'matched', ledger_instrument_id: ledger.id, instrument: narrowed[0] };
  return { kind: 'ambiguous', ledger_instrument_id: ledger.id, candidates: narrowed.length ? narrowed : typed };
}
