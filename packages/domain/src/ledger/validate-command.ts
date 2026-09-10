import type { Portfolio, Instrument, LedgerEvent } from "./schema.ts";
import { projectLedger, type ProjectionCutoff, type LedgerResult } from "./project.ts";

/** Application supplies all revisions through the validation cutoff, not only
 * events before the edited trade. A repository persists only a successful result. */
export function validateLedgerCommand(portfolio: Portfolio, instruments: readonly Instrument[], revisions: readonly LedgerEvent[], candidate: LedgerEvent, cutoff: ProjectionCutoff): LedgerResult {
  if (candidate.trade_date > cutoff.through_date || Date.parse(candidate.recorded_at) > Date.parse(cutoff.known_at)) return { ok: false, error: { code: "candidate_outside_validation_window" } };
  if (revisions.some(event => event.trade_date > cutoff.through_date || Date.parse(event.recorded_at) > Date.parse(cutoff.known_at))) return { ok: false, error: { code: "incomplete_validation_window" } };
  return projectLedger(portfolio, instruments, [...revisions, candidate], cutoff);
}
