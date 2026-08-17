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
  current_price: number;
  trend_status: string;
  drawdown: number;
  drawdown252: number | null;
  high252_date: string | null;
  rsi: number;
  ma20: number | null;
  ma60: number | null;
  ma120: number | null;
  ma200: number | null;
  market_value: number;
  cost_basis: number;
  return_from_cost: number | null;
  take_profit_pct: number;
  stop_loss_pct: number;
  unrealized_pnl: number;
  current_weight: number;
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

export type AiSettings = {
  schemaVersion: 1;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
  apiKeyMasked: string;
  updatedAt: string;
};

export type AiSettingsInput = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  clearApiKey?: boolean;
};

export type AiSettingsTestResult = {
  ok: boolean;
  baseUrl: string;
  model: string;
  modelMatched: boolean | null;
  modelCount: number;
  responsesOk: boolean;
  generationEndpoint?: string;
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
    throw new Error(`API ${response.status}: ${path}${detail}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchTradingState(): Promise<TradingStateResponse> {
  const response = await requestJson<TradingStateResponse>("/api/trading-state");
  return {
    ...response,
    state: sanitizeTradingData(response.state),
  };
}

export async function saveTradingState(
  state: TradingDataState
): Promise<TradingStateResponse> {
  const response = await requestJson<TradingStateResponse>("/api/trading-state", {
    method: "PUT",
    body: JSON.stringify(state),
  });
  return {
    ...response,
    state: sanitizeTradingData(response.state),
  };
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
