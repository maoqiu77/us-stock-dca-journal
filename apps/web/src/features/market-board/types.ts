export type Segment = "us" | "etf" | "fund";
export type ObservationStatus = "available" | "partial" | "stale" | "missing" | "sample";
export type Instrument = { key: string; symbol: string; name: string; market: "US" | "CN"; exchange: string; asset_type: "STOCK" | "ETF" | "FUND"; currency: "USD" | "CNY"; timezone: string; provider_symbols: Record<string, string>; verified_at?: string | null };
export type ObservationMeta = { source: string; as_of?: string | null; fetched_at: string; status: ObservationStatus; timeliness: string; cache_state: string; reason?: string | null };
export type Quote = { instrument_key: string; price: string | null; previous_close: string | null; change: string | null; change_pct: string | null; volume: string | null; volume_unit?: string | null; trading_date?: string | null; session: string; meta: ObservationMeta };
export type Nav = { value: string | null; change_pct: string | null; nav_date?: string | null; announcement_date?: string | null; meta: ObservationMeta };
export type PurchaseLimit = { state: string; amount: string | null; currency: string; channel?: string | null; meta: ObservationMeta };
export type EtfMetrics = { premium_pct: string | null; premium_basis: string; reference_value: string | null; reference_date?: string | null; percentile60: string | null; sample_days: number; shares: string | null; shares_date?: string | null; shares_change: string | null; previous_shares_date?: string | null; meta: ObservationMeta };
export type BoardRow = { instrument: Instrument; quote?: Quote | null; nav?: Nav | null; purchase_limit?: PurchaseLimit | null; metrics?: EtfMetrics | null; quality: ObservationStatus };
export type BoardResponse = { segment: Segment; rows: BoardRow[]; benchmarks: unknown[]; revision: number; fetched_at: string; warnings: string[] };
export type Selection = { segment: Segment; revision: number; items: Instrument[] };
export type DetailResponse = { row: BoardRow; holdings?: unknown | null };

