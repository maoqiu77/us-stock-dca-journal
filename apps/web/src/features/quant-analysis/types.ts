export type QuantAnalysisMode = "quick" | "deep";

export type QuantAnalyst =
  | "technical"
  | "fundamentals"
  | "news"
  | "social"
  | "macro";

export type QuantRunStatus =
  | "queued"
  | "running"
  | "cancel_requested"
  | "interrupted"
  | "completed"
  | "failed"
  | "canceled";

export type QuantSource = {
  name: string;
  url: string;
  asOf: string;
  available: boolean;
};

export type QuantAnalysisStep = {
  stepKey: string;
  sequence: number;
  role: string;
  status: string;
  model: string;
  attempt: number;
  inputSummary: Record<string, unknown>;
  output: Record<string, unknown> | null;
  dataSources: QuantSource[];
  errorMessage: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  startedAt: string;
  completedAt: string;
};

export type QuantFinalResult = {
  ticker?: string;
  assetType?: "EQUITY" | "ETF" | string;
  effectiveDate?: string;
  rating?: "买入" | "增持" | "持有" | "减持" | "卖出" | string;
  confidence?: number;
  summary?: string;
  evidence?: string[];
  risks?: string[];
  targetPrice?: number | null;
  timeHorizon?: string;
  dataQuality?: {
    analystStatuses?: Record<string, string>;
    availableCount?: number;
    partial?: boolean;
  };
  [key: string]: unknown;
};

export type QuantReflection = {
  performance?: {
    startDate?: string;
    endDate?: string;
    tickerReturnPct?: number;
    spyReturnPct?: number;
    excessReturnPct?: number;
  };
  review?: Record<string, unknown>;
  generatedOn?: string;
};

export type QuantAnalysisRun = {
  id: string;
  ticker: string;
  assetType: string;
  requestedDate: string;
  effectiveDate: string;
  mode: QuantAnalysisMode;
  analysts: QuantAnalyst[];
  reflectionEnabled: boolean;
  inputSignature: string;
  model: string;
  simpleModel: string;
  complexModel: string;
  version: number;
  status: QuantRunStatus;
  currentStage: string;
  progress: number;
  errorCode: string;
  errorMessage: string;
  finalResult: QuantFinalResult | null;
  reflectionStatus: string;
  reflectionEligible: boolean;
  reflection: QuantReflection | null;
  createdAt: string;
  startedAt: string;
  completedAt: string;
  updatedAt: string;
  steps: QuantAnalysisStep[];
  reused?: boolean;
  dateAdjusted?: boolean;
};

export type CreateQuantAnalysisRunInput = {
  ticker: string;
  analysisDate: string;
  mode: QuantAnalysisMode;
  analysts: QuantAnalyst[];
  reflectionEnabled: boolean;
  forceRegenerate?: boolean;
};

export type ResearchSettings = {
  schemaVersion: 1;
  hasFredApiKey: boolean;
  fredApiKeyMasked: string;
  updatedAt: string;
};

export type ResearchSettingsInput = {
  fredApiKey?: string;
  clearFredApiKey?: boolean;
};
