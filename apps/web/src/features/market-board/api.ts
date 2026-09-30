import type { BoardResponse, DetailResponse, Instrument, Segment, Selection, Series } from "./types";

const base = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${base}${path}`, init);
  if (!response.ok) throw new Error(response.status === 409 ? "自选已在其他页面修改，请重试（409）" : `看板请求失败（${response.status}），请重试`);
  return (await response.json()) as T;
}
export function fetchBoard(segment: Segment, refresh = false, signal?: AbortSignal) { return request<BoardResponse>(`/api/market-board/board/${segment}?refresh=${refresh}`, { signal }); }
export function fetchSelection(segment: Segment, signal?: AbortSignal) { return request<Selection>(`/api/market-board/selection/${segment}`, { signal }); }
export function saveSelection(segment: Segment, keys: string[], expectedRevision: number, signal?: AbortSignal) { return request<Selection>(`/api/market-board/selection/${segment}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ keys, expected_revision: expectedRevision }), signal }); }
export function searchInstruments(query: string, market: "US" | "CN", assetType?: string, signal?: AbortSignal) { const params = new URLSearchParams({ q: query, market }); if (assetType) params.set("asset_type", assetType); return request<{ items: Instrument[] }>(`/api/market-board/search?${params}`, { signal }); }
export function fetchDetail(key: string, signal?: AbortSignal) { return request<DetailResponse>(`/api/market-board/detail?key=${encodeURIComponent(key)}`, { signal }); }
export function fetchSeries(key: string, period = "1d", range = "1y", signal?: AbortSignal) { const params = new URLSearchParams({ key, period, range }); return request<Series>(`/api/market-board/series?${params}`, { signal }); }
