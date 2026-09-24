import type { ResearchSelection } from '@portfolio/market-data/research';
import { researchSnapshotSchema } from '@portfolio/market-data/research';
import type { z } from 'zod';
import type { DomesticBoard, DomesticFundHoldings, DomesticHoldingQuote, DomesticSearchResult } from '@portfolio/market-data/domestic';
import type { BarsV1, CanonicalInstrument, MarketCapabilities, QuoteV1 } from '@portfolio/market-data';

export interface MarketTransport {
  researchSnapshot?(selection: ResearchSelection): Promise<z.infer<typeof researchSnapshotSchema>>;
  domesticBoard?(segment: 'etf' | 'fund', symbols?: string[]): Promise<DomesticBoard>;
  domesticSearch?(query: string, segment: 'etf' | 'fund'): Promise<DomesticSearchResult[]>;
  domesticFundHoldings?(code: string): Promise<DomesticFundHoldings>;
  domesticHoldingQuotes?(symbols: string[]): Promise<DomesticHoldingQuote[]>;
  capabilities(): Promise<MarketCapabilities>;
  search(query: string, limit: number): Promise<CanonicalInstrument[]>;
  quotes(instrumentKeys: string[]): Promise<QuoteV1[]>;
  bars?(instrumentKey: string, range: '1M' | '3M' | '1Y', interval: '1day'): Promise<BarsV1>;
  prepareAnalysisSnapshot?(instrumentKeys: string[], purpose: 'portfolio_review' | 'instrument_research' | 'daily_review' | 'follow_up', selections?: ResearchSelection[]): Promise<{ receipt_id: string; receipt_digest: string; created_at: string; expires_at: string; provider: string; feed: string; attribution: string; quotes: QuoteV1[]; series?: z.infer<typeof researchSnapshotSchema>['series'] }>;
}

export class MarketTransportError extends Error {
  readonly code: string; readonly outcomeUnknown: boolean;
  constructor(code: string, message: string, outcomeUnknown: boolean) { super(message); this.name = 'MarketTransportError'; this.code = code; this.outcomeUnknown = outcomeUnknown; }
}
