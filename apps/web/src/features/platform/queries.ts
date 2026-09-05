import { useQuery } from "@tanstack/react-query";

import {
  fetchAiAdviceCalendar,
  fetchAiSettings,
  fetchBacktest,
  fetchSignals,
  fetchUpdateCheck,
  fetchUpdateStatus,
} from "@/features/platform/api";

export function useSignalsQuery() {
  return useQuery({
    queryKey: ["signals"],
    queryFn: fetchSignals,
  });
}

export function useBacktestQuery(
  ticker: string,
  range: string,
  initialCash: number
) {
  return useQuery({
    queryKey: ["backtests", ticker, range, initialCash],
    queryFn: () => fetchBacktest(ticker, range, initialCash),
    enabled: Boolean(ticker),
    staleTime: 60_000,
  });
}

export function useAiAdviceCalendarQuery(date?: string | null) {
  return useQuery({
    queryKey: ["ai-advice", date ?? "default"],
    queryFn: () => fetchAiAdviceCalendar(date),
  });
}

export function useAiSettingsQuery() {
  return useQuery({
    queryKey: ["ai-settings"],
    queryFn: fetchAiSettings,
  });
}

export function useUpdateCheckQuery(enabled = true) {
  return useQuery({
    queryKey: ["update-check"],
    queryFn: fetchUpdateCheck,
    enabled,
    staleTime: 5 * 60_000,
  });
}

export function useUpdateStatusQuery(enabled: boolean) {
  return useQuery({
    queryKey: ["update-status"],
    queryFn: fetchUpdateStatus,
    enabled,
    refetchInterval: (query) => {
      const data = query.state.data as { phase?: string } | undefined;
      return enabled && data?.phase !== "error" ? 1500 : false;
    },
    retry: false,
  });
}
