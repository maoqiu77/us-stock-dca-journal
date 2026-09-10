import type { ContextRepository } from '../src/index.ts';
// Compiled but not executed; the repository contract cannot write the ledger.
async function boundary(repository:ContextRepository) {
  // @ts-expect-error No write port exists.
  repository.appendLedgerEvent({});
  const facts=await repository.readFacts({portfolio_id:'synthetic',known_at:'2026-09-09T00:00:00Z',requirements:{intent:'general',instrument_ids:[],date_range:null,required_sources:[],clarification:null}});
  // @ts-expect-error Query results are deeply readonly.
  facts[0].sources.push({});
}
void boundary;
