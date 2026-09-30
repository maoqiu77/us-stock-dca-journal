export type Segment = "us" | "etf" | "fund";
export type ObservationStatus = "available" | "partial" | "stale" | "missing" | "sample";
export type Instrument = { key: string; symbol: string; name: string; market: "US" | "CN"; exchange: string; asset_type: "STOCK" | "ETF" | "FUND"; currency: "USD" | "CNY"; timezone: string; provider_symbols: Record<string, string>; verified_at?: string | null };
export type ObservationMeta = { source: string; as_of?: string | null; fetched_at: string; status: ObservationStatus; timeliness: string; cache_state: string; reason?: string | null };
export type Quote = { instrument_key: string; price: string | null; previous_close: string | null; change: string | null; change_pct: string | null; volume: string | null; volume_unit?: string | null; trading_date?: string | null; session: string; meta: ObservationMeta };
export type Nav = { value: string | null; change_pct: string | null; nav_date?: string | null; announcement_date?: string | null; meta: ObservationMeta };
export type PurchaseLimit = { state: string; amount: string | null; currency: string; channel?: string | null; meta: ObservationMeta };
export type EtfMetrics = { premium_pct: string | null; premium_basis: string; reference_value: string | null; reference_date?: string | null; percentile60: string | null; sample_days: number; shares: string | null; shares_date?: string | null; shares_change: string | null; previous_shares_date?: string | null; nav?:Nav|null;iopv?:ReferenceValue|null;vendor_reference?:ReferenceValue|null;basis_id?:string|null;shares_meta?:ObservationMeta|null; meta: ObservationMeta };
export type BoardRow = { instrument: Instrument; quote?: Quote | null; nav?: Nav | null; purchase_limit?: PurchaseLimit | null; metrics?: EtfMetrics | null; quality: ObservationStatus };
export type BoardResponse = { segment: Segment; rows: BoardRow[]; benchmarks: {symbol:string;name:string;kind:"index"|"future";quote:Quote}[]; revision: number; fetched_at: string; warnings: string[] };
export type Selection = { segment: Segment; revision: number; items: Instrument[] };
export type DetailResponse = { row: BoardRow; holdings?: FundHoldings | null };
export type Bar = { time: string; trading_date?: string | null; open: string; high: string; low: string; close: string; volume: string | null; is_final: boolean };
export type Series = { instrument_key: string; currency: string; period: string; range: string; timezone: string; adjustment: string; volume_unit?: string | null; time_label: string; bars: Bar[]; meta: ObservationMeta };

export type ReferenceValue = {value:string|null;reference_date?:string|null;meta:ObservationMeta};
export type FundHoldings = {report_date:string|null;allocation?:{report_date:string;stocks_pct:string|null;bonds_pct:string|null;cash_pct:string|null}|null;stocks:{rank:number;symbol:string;name:string;weight_pct:string}[];meta:ObservationMeta;allocation_meta?:ObservationMeta|null};
