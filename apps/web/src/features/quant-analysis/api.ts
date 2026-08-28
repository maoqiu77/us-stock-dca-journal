import type {
  CreateQuantAnalysisRunInput,
  QuantAnalysisRun,
  ResearchSettings,
  ResearchSettingsInput,
} from "./types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const payload = (await response.json()) as { detail?: unknown };
      detail = typeof payload.detail === "string" ? payload.detail : "";
    } catch {
      detail = "";
    }
    throw new Error(detail || `量化分析 API 请求失败（${response.status}）`);
  }
  return response.json() as Promise<T>;
}

export async function fetchQuantAnalysisRuns(): Promise<QuantAnalysisRun[]> {
  const response = await requestJson<{ items: QuantAnalysisRun[] }>(
    "/api/quant-analysis/runs"
  );
  return response.items;
}

export function fetchQuantAnalysisRun(runId: string): Promise<QuantAnalysisRun> {
  return requestJson(`/api/quant-analysis/runs/${encodeURIComponent(runId)}`);
}

export function createQuantAnalysisRun(
  payload: CreateQuantAnalysisRunInput
): Promise<QuantAnalysisRun> {
  return requestJson("/api/quant-analysis/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function cancelQuantAnalysisRun(runId: string): Promise<QuantAnalysisRun> {
  return requestJson(`/api/quant-analysis/runs/${encodeURIComponent(runId)}/cancel`, {
    method: "POST",
  });
}

export function resumeQuantAnalysisRun(runId: string): Promise<QuantAnalysisRun> {
  return requestJson(`/api/quant-analysis/runs/${encodeURIComponent(runId)}/resume`, {
    method: "POST",
  });
}

export function createQuantAnalysisReflection(
  runId: string
): Promise<QuantAnalysisRun> {
  return requestJson(
    `/api/quant-analysis/runs/${encodeURIComponent(runId)}/reflection`,
    { method: "POST" }
  );
}

export function fetchResearchSettings(): Promise<ResearchSettings> {
  return requestJson("/api/research-settings");
}

export function saveResearchSettings(
  payload: ResearchSettingsInput
): Promise<ResearchSettings> {
  return requestJson("/api/research-settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function testFredConnection(
  payload: ResearchSettingsInput
): Promise<{ ok: boolean; message: string }> {
  return requestJson("/api/research-settings/fred/test", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
