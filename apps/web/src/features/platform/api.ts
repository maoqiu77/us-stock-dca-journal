import {
  sanitizeTradingData,
  type DerivedPosition,
  type TradingDataState,
} from "@/features/platform/trading-data";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "";
const AI_REQUEST_BASE_URL =
  process.env.NEXT_PUBLIC_AI_API_BASE_URL?.replace(/\/$/, "") ??
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ??
  "http://127.0.0.1:8000";

export type TradingStateResponse = {
  revision: string;
  state: TradingDataState;
  derivedPositions: DerivedPosition[];
  accountSummary: {
    totalAssets: number;
    holdingCost: number;
    cash: number;
  };
  validationIssues: string[];
};

export type SignalRow = {
  ticker: string;
  current_price: number | null;
  trend_status: string;
  drawdown: number | null;
  drawdown252: number | null;
  high252_date: string | null;
  rsi: number | null;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  ma200: number | null;
  market_value: number | null;
  cost_basis: number;
  return_from_cost: number | null;
  take_profit_pct: number;
  stop_loss_pct: number;
  unrealized_pnl: number | null;
  current_weight: number | null;
  target_weight: number;
  action: string;
  status: string;
  suggested_amount: number;
  suggested_shares: number;
  reasons: string;
  blocked_reasons: string;
  risk_notes: string;
  manual_instruction: string;
  date: string;
  source: string;
};

export type BacktestTrade = {
  Date: string;
  Action: "BUY" | "SELL" | string;
  Price: number;
  Shares: number;
  Amount: number;
  Reason: string;
};

export type BacktestSeriesPoint = {
  date: string;
  equity: number;
};

export type BacktestStrategyResult = {
  name: string;
  metrics: Record<string, number | null>;
  equity: BacktestSeriesPoint[];
  trades: BacktestTrade[];
};

export type BacktestResponse = {
  ticker: string;
  source: string;
  range: string;
  initialCash: number;
  items: BacktestStrategyResult[];
  legacyItems: BacktestStrategyResult[];
};

export type AiAdviceMessage = {
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

export type AiAdviceNewsItem = {
  title: string;
  source: string;
  published: string;
  link: string;
};

export type AiAdviceRecord = {
  date: string;
  generated_at: string;
  content: string;
  messages: AiAdviceMessage[];
  beijing_context: Record<string, string>;
  extra_question: string;
  prompt: string;
  news: AiAdviceNewsItem[];
  source: string;
};

export type AiAdviceCalendarResponse = {
  today: string;
  selectedDate: string | null;
  dates: string[];
  record: AiAdviceRecord | null;
};

export type AiProtocol = "auto" | "chat/completions" | "responses" | "messages";

export type AiProviderPreset = {
  id: string;
  label: string;
  baseUrl: string;
  protocol: AiProtocol;
  complexModel: string;
  simpleModel: string;
  models: string[];
  keyUrl: string;
  textOnlyModels: string[];
  protocols: AiProtocol[];
};

export type AiSettingsProfile = {
  baseUrl: string;
  protocol: AiProtocol;
  complexModel: string;
  simpleModel: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  updatedAt: string;
};

export type AiSettings = AiSettingsProfile & {
  schemaVersion: 3;
  provider: string;
  model: string;
  profiles: Record<string, AiSettingsProfile>;
  providers: AiProviderPreset[];
};

export type AiSettingsInput = {
  provider?: string;
  protocol?: AiProtocol;
  baseUrl: string;
  complexModel: string;
  simpleModel: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

export type AiSettingsTestResult = {
  ok: boolean;
  baseUrl: string;
  model: string;
  complexModel: string;
  simpleModel: string;
  modelMatched: boolean | null;
  modelCount: number;
  responsesOk: boolean;
  generationOk: boolean;
  models: string[];
  generationEndpoint?: string;
  modelResults: Record<
    "complex" | "simple",
    {
      model: string;
      modelMatched: boolean | null;
      generationEndpoint: string;
      ok: boolean;
    }
  >;
  message: string;
};

export type RecognizedPosition = {
  ticker: string;
  name: string;
  assetType: "ETF" | "STOCK";
  shares: number;
  averageCost: number | null;
  marketValue: number | null;
  currency: string;
  confidence: number;
  warnings: string[];
};

export type PositionRecognitionResult = {
  mode: "portfolio" | "trades";
  positions: RecognizedPosition[];
  trades: RecognizedTrade[];
  warnings: string[];
  endpoint: string;
};
export type RecognizedTrade = { ticker: string; action: "买入" | "卖出"; shares: number; unitPrice: number; amount: number; assetType: "ETF" | "STOCK"; confidence: number; sourceText: string; warnings: string[] };

export type UpdateAsset = {
  name: string;
  size: number;
  digest: string;
  downloadUrl: string;
};

export type UpdateCheckResponse = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  canInstall: boolean;
  platform: string;
  repo: string;
  releaseUrl: string;
  asset: UpdateAsset | null;
  message: string;
};

export type UpdateStatusResponse = {
  phase: string;
  message: string;
  currentVersion: string;
  latestVersion: string;
  assetName: string;
  downloadedBytes: number;
  totalBytes: number;
  backupPath: string;
  error: string;
  updatedAt: string;
};

export type UpdateStartInput = {
  localStorageSnapshot: Record<string, string>;
};

type ApiList<T> = {
  items: T[];
};

export class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function requestJson<T>(
  path: string,
  init?: RequestInit,
  baseUrl = API_BASE_URL
): Promise<T> {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const errorPayload = (await response.json()) as { detail?: string };
      detail = errorPayload.detail ? ` ${errorPayload.detail}` : "";
    } catch {
      detail = "";
    }
    throw new ApiError(response.status, `API ${response.status}: ${path}${detail}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchTradingState(): Promise<TradingStateResponse> {
  const response = await requestJson<TradingStateResponse>("/api/trading-state", { signal: AbortSignal.timeout(10000) });
  return {
    ...response,
    state: sanitizeTradingData(response.state),
  };
}

export async function saveTradingState(
  operation: { state: TradingDataState; expectedRevision: string; operationId: string }
): Promise<TradingStateResponse> {
  const response = await requestJson<TradingStateResponse>("/api/trading-state", {
    method: "PUT",
    body: JSON.stringify(operation),
    signal: AbortSignal.timeout(10000),
  });
  return {
    ...response,
    state: sanitizeTradingData(response.state),
  };
}

export function fetchTradingReceipt(id: string) {
  return requestJson<({ status: "committed" } & TradingStateResponse) | { status: "unknown" }>(`/api/trading-state/receipts/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(10000) });
}

export async function downloadLocalBackup() {
  const browserPreferences: Record<string, string> = {};
  for (const key of ["theme", "stock-platform-active-view-v1", "stock-platform-onboarding-v1"]) {
    const value = localStorage.getItem(key);
    if (value !== null) browserPreferences[key] = value;
  }
  const response = await fetch(`${API_BASE_URL}/api/local-backup`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ browserPreferences }) });
  if (!response.ok) throw new Error("备份未通过校验，请保留原库并查看恢复说明。");
  return response.blob();
}

export async function resetTradingState(): Promise<TradingStateResponse> {
  const response = await requestJson<TradingStateResponse>(
    "/api/trading-state/reset",
    {
      method: "POST",
    }
  );
  return {
    ...response,
    state: sanitizeTradingData(response.state),
  };
}

export async function recognizePositionScreenshot(
  imageDataUrl: string,
  mode: "auto" | "portfolio" | "trades" = "auto"
): Promise<PositionRecognitionResult> {
  return requestJson<PositionRecognitionResult>(
    "/api/position-import/recognize",
    {
      method: "POST",
      body: JSON.stringify({ imageDataUrl, mode }),
    },
    AI_REQUEST_BASE_URL
  );
}

export async function fetchSignals(): Promise<SignalRow[]> {
  const data = await requestJson<ApiList<SignalRow>>("/api/signals");
  return data.items;
}

export async function fetchBacktest(
  ticker: string,
  range = "1y",
  initialCash?: number
): Promise<BacktestResponse> {
  const query = new URLSearchParams({ range });
  if (initialCash && initialCash > 0) {
    query.set("initialCash", String(initialCash));
  }
  return requestJson<BacktestResponse>(
    `/api/backtests/${encodeURIComponent(ticker)}?${query.toString()}`
  );
}

export async function fetchAiAdviceCalendar(
  date?: string | null
): Promise<AiAdviceCalendarResponse> {
  const suffix = date ? `?date=${encodeURIComponent(date)}` : "";
  return requestJson<AiAdviceCalendarResponse>(`/api/ai-advice${suffix}`);
}

export async function createAiAdviceDraft(
  brief: string
): Promise<AiAdviceCalendarResponse> {
  return requestJson<AiAdviceCalendarResponse>("/api/ai-advice/draft", {
    method: "POST",
    body: JSON.stringify({ brief }),
  });
}

export async function generateAiAdvice(
  brief: string
): Promise<AiAdviceCalendarResponse> {
  return requestJson<AiAdviceCalendarResponse>("/api/ai-advice/generate", {
    method: "POST",
    body: JSON.stringify({ brief }),
  }, AI_REQUEST_BASE_URL);
}

export async function sendAiAdviceChat(
  prompt: string
): Promise<AiAdviceCalendarResponse> {
  return requestJson<AiAdviceCalendarResponse>("/api/ai-advice/chat", {
    method: "POST",
    body: JSON.stringify({ prompt }),
  }, AI_REQUEST_BASE_URL);
}

export async function clearAiAdviceChat(): Promise<AiAdviceCalendarResponse> {
  return requestJson<AiAdviceCalendarResponse>("/api/ai-advice/chat/clear", {
    method: "POST",
  }, AI_REQUEST_BASE_URL);
}

export async function fetchAiSettings(): Promise<AiSettings> {
  return requestJson<AiSettings>("/api/ai-settings");
}

export async function saveAiSettings(
  payload: AiSettingsInput
): Promise<AiSettings> {
  return requestJson<AiSettings>("/api/ai-settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function testAiSettings(
  payload: AiSettingsInput
): Promise<AiSettingsTestResult> {
  return requestJson<AiSettingsTestResult>("/api/ai-settings/test", {
    method: "POST",
    body: JSON.stringify(payload),
  }, AI_REQUEST_BASE_URL);
}

export async function fetchUpdateCheck(): Promise<UpdateCheckResponse> {
  return requestJson<UpdateCheckResponse>("/api/update/check");
}

export async function fetchUpdateStatus(): Promise<UpdateStatusResponse> {
  return requestJson<UpdateStatusResponse>("/api/update/status");
}

export async function startSoftwareUpdate(
  payload: UpdateStartInput
): Promise<UpdateStatusResponse> {
  return requestJson<UpdateStatusResponse>("/api/update/start", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
