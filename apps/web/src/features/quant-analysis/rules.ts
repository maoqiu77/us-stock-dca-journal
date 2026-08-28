import type {
  QuantAnalysisMode,
  QuantAnalysisRun,
  QuantAnalyst,
} from "./types";

export function estimateAnalysisCalls(
  mode: QuantAnalysisMode,
  analysts: QuantAnalyst[]
) {
  return analysts.length + (mode === "deep" ? 18 : 8);
}

export function normalizeAnalystsForDate(
  analysts: QuantAnalyst[],
  analysisDate: string,
  today: string
): QuantAnalyst[] {
  if (!analysisDate || analysisDate >= today) {
    return analysts;
  }
  return analysts.filter((analyst) => analyst !== "social");
}

type GroupableRun = Pick<
  QuantAnalysisRun,
  "id" | "ticker" | "effectiveDate" | "version"
>;

export function groupAnalysisRuns<T extends GroupableRun>(runs: T[]) {
  const groups = new Map<string, { key: string; ticker: string; effectiveDate: string; runs: T[] }>();
  for (const run of runs) {
    const key = `${run.ticker}:${run.effectiveDate}`;
    const group = groups.get(key) ?? {
      key,
      ticker: run.ticker,
      effectiveDate: run.effectiveDate,
      runs: [],
    };
    group.runs.push(run);
    groups.set(key, group);
  }
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      runs: group.runs.sort((left, right) => right.version - left.version),
    }))
    .sort((left, right) =>
      `${right.effectiveDate}:${right.ticker}`.localeCompare(
        `${left.effectiveDate}:${left.ticker}`
      )
    );
}

export function localTodayIso(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
