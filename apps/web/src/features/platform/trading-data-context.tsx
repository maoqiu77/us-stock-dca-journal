"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
  fetchTradingState,
  saveTradingState,
} from "@/features/platform/api";
import {
  DEFAULT_TRADING_DATA,
  TRADING_DATA_STORAGE_KEY,
  derivePositions,
  dynamicCash,
  getActiveStrategyProfile,
  holdingCostValue,
  importPositionSnapshots,
  applyRecognizedTrades as applyTrades,
  replacePositionSnapshot as replaceSnapshot,
  normalizeTradeInput,
  removeTrackedTicker,
  replaceStockPool,
  sanitizeTradingData,
  upsertPositionPlan,
  uniqueTickers,
  validateTradingData,
  type PositionPlan,
  type PositionSnapshotInput,
  type StrategyProfile,
  type StrategySettings,
  type TradeRecord,
  type TradingAccount,
  type TradingDataState,
} from "@/features/platform/trading-data";

type StorageStatus = "loading" | "api" | "saving" | "local" | "error";
type TradeInput = Omit<TradeRecord, "id" | "shares"> & {
  id?: string;
  shares?: number;
};

type TradingDataContextValue = {
  state: TradingDataState;
  isHydrated: boolean;
  storageStatus: StorageStatus;
  derivedPositions: ReturnType<typeof derivePositions>;
  holdingCost: number;
  cash: number;
  validationIssues: string[];
  activeStrategyProfile: StrategyProfile;
  updateAccount: (patch: Partial<TradingAccount>) => void;
  updateStockPoolText: (value: string) => void;
  upsertPosition: (position: PositionPlan) => void;
  removePosition: (ticker: string) => void;
  addTrade: (input: TradeInput) => void;
  importTrades: (inputs: TradeInput[]) => void;
  importPositions: (inputs: PositionSnapshotInput[], importDate: string) => void;
  applyRecognizedTrades: (inputs: Array<{ ticker: string; action: "买入" | "卖出"; shares: number; unitPrice: number; amount: number; assetType: "ETF" | "STOCK"; date?: string; note?: string }>, date: string) => void;
  replacePositionSnapshot: (inputs: PositionSnapshotInput[], date: string) => void;
  updateTrade: (
    id: string,
    input: Omit<TradeRecord, "id" | "shares"> & { shares?: number }
  ) => void;
  removeTrade: (id: string) => void;
  setActiveStrategyProfile: (profileId: StrategyProfile["id"]) => void;
  updateStrategyProfile: (
    profileId: StrategyProfile["id"],
    patch: Partial<Pick<StrategyProfile, "name" | "description">> & {
      settings?: Partial<StrategySettings>;
    }
  ) => void;
};

const TradingDataContext = React.createContext<TradingDataContextValue | null>(
  null
);

export function TradingDataProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<TradingDataState>(DEFAULT_TRADING_DATA);
  const [storageStatus, setStorageStatus] =
    React.useState<StorageStatus>("loading");
  const isHydrated = typeof window !== "undefined";
  const hasLoadedStateRef = React.useRef(false);
  const remoteSaveEnabledRef = React.useRef(false);
  const lastSavedPayloadRef = React.useRef<string | null>(null);
  const saveTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const invalidateTradingQueries = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    queryClient.invalidateQueries({ queryKey: ["quotes"] });
    queryClient.invalidateQueries({ queryKey: ["signals"] });
    queryClient.invalidateQueries({ queryKey: ["backtests"] });
  }, [queryClient]);

  React.useEffect(() => {
    let isCanceled = false;

    fetchTradingState()
      .then((response) => {
        if (isCanceled) {
          return;
        }
        const nextState = sanitizeTradingData(response.state);
        lastSavedPayloadRef.current = JSON.stringify(nextState);
        hasLoadedStateRef.current = true;
        remoteSaveEnabledRef.current = true;
        setState(nextState);
        persistLocalState(nextState);
        setStorageStatus("api");
        invalidateTradingQueries();
      })
      .catch(() => {
        if (!isCanceled) {
          hasLoadedStateRef.current = true;
          remoteSaveEnabledRef.current = false;
          setState(readStoredState());
          setStorageStatus("local");
        }
      });

    return () => {
      isCanceled = true;
      hasLoadedStateRef.current = false;
      remoteSaveEnabledRef.current = false;
    };
  }, [invalidateTradingQueries]);

  const scheduleRemoteSave = React.useCallback(
    (nextState: TradingDataState) => {
      if (!remoteSaveEnabledRef.current) {
        return;
      }

      const serialized = JSON.stringify(nextState);
      if (serialized === lastSavedPayloadRef.current) {
        return;
      }

      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }

      setStorageStatus("saving");
      saveTimerRef.current = setTimeout(() => {
        saveTradingState(nextState)
          .then((response) => {
            const savedState = sanitizeTradingData(response.state);
            const savedPayload = JSON.stringify(savedState);
            lastSavedPayloadRef.current = savedPayload;
            persistLocalState(savedState);
            setStorageStatus("api");
            invalidateTradingQueries();
            if (savedPayload !== serialized) {
              setState(savedState);
            }
          })
          .catch(() => {
            setStorageStatus("error");
          });
      }, 500);
    },
    [invalidateTradingQueries]
  );

  React.useEffect(() => {
    if (!hasLoadedStateRef.current) {
      return;
    }
    persistLocalState(state);
    scheduleRemoteSave(state);
  }, [scheduleRemoteSave, state]);

  React.useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
    };
  }, []);

  const commitState = React.useCallback(
    (updater: (current: TradingDataState) => TradingDataState) => {
      setState((current) => sanitizeTradingData(updater(current)));
    },
    []
  );

  const derivedPositions = React.useMemo(() => derivePositions(state), [state]);
  const holdingCost = React.useMemo(
    () => holdingCostValue(derivedPositions),
    [derivedPositions]
  );
  const cash = React.useMemo(
    () => dynamicCash(state.account.totalAssets, holdingCost),
    [holdingCost, state.account.totalAssets]
  );
  const validationIssues = React.useMemo(
    () => validateTradingData(state, derivedPositions),
    [derivedPositions, state]
  );
  const activeStrategyProfile = React.useMemo(
    () => getActiveStrategyProfile(state),
    [state]
  );

  const updateAccount = React.useCallback(
    (patch: Partial<TradingAccount>) => {
      commitState((current) => ({
        ...current,
        account: {
          ...current.account,
          ...patch,
          totalAssets:
            patch.totalAssets === undefined
              ? current.account.totalAssets
              : Number(patch.totalAssets),
        },
      }));
    },
    [commitState]
  );

  const updateStockPoolText = React.useCallback(
    (value: string) => {
      commitState((current) => replaceStockPool(current, value));
    },
    [commitState]
  );

  const upsertPosition = React.useCallback(
    (position: PositionPlan) => {
      commitState((current) => upsertPositionPlan(current, position));
    },
    [commitState]
  );

  const removePosition = React.useCallback(
    (ticker: string) => {
      commitState((current) => removeTrackedTicker(current, ticker));
    },
    [commitState]
  );

  const addTrade = React.useCallback(
    (input: TradeInput) => {
      commitState((current) => ({
        ...current,
        trades: [...current.trades, normalizeTradeInput(input)],
      }));
    },
    [commitState]
  );

  const importTrades = React.useCallback(
    (inputs: TradeInput[]) => {
      commitState((current) => {
        const trades = inputs.map(normalizeTradeInput).filter((trade) => trade.ticker);
        const importedTickers = trades.map((trade) => trade.ticker);
        return {
          ...current,
          stockPool: uniqueTickers([...current.stockPool, ...importedTickers]),
          trades: [...current.trades, ...trades],
        };
      });
    },
    [commitState]
  );

  const importPositions = React.useCallback(
    (inputs: PositionSnapshotInput[], importDate: string) => {
      commitState((current) => importPositionSnapshots(current, inputs, importDate));
    },
    [commitState]
  );
  const applyRecognizedTrades = React.useCallback((inputs: Parameters<typeof applyTrades>[1], date: string) => commitState((current) => applyTrades(current, inputs, date)), [commitState]);
  const replacePositionSnapshot = React.useCallback((inputs: PositionSnapshotInput[], date: string) => commitState((current) => replaceSnapshot(current, inputs, date)), [commitState]);

  const updateTrade = React.useCallback(
    (
      id: string,
      input: Omit<TradeRecord, "id" | "shares"> & {
        shares?: number;
      }
    ) => {
      commitState((current) => ({
        ...current,
        trades: current.trades.map((trade) =>
          trade.id === id ? normalizeTradeInput({ ...input, id }) : trade
        ),
      }));
    },
    [commitState]
  );

  const removeTrade = React.useCallback(
    (id: string) => {
      commitState((current) => ({
        ...current,
        trades: current.trades.filter((trade) => trade.id !== id),
      }));
    },
    [commitState]
  );

  const setActiveStrategyProfile = React.useCallback(
    (profileId: StrategyProfile["id"]) => {
      commitState((current) => ({
        ...current,
        activeStrategyProfile: profileId,
      }));
    },
    [commitState]
  );

  const updateStrategyProfile = React.useCallback(
    (
      profileId: StrategyProfile["id"],
      patch: Partial<Pick<StrategyProfile, "name" | "description">> & {
        settings?: Partial<StrategySettings>;
      }
    ) => {
      commitState((current) => ({
        ...current,
        strategyProfiles: current.strategyProfiles.map((profile) =>
          profile.id === profileId
            ? {
                ...profile,
                name: patch.name ?? profile.name,
                description: patch.description ?? profile.description,
                settings: {
                  ...profile.settings,
                  ...patch.settings,
                },
              }
            : profile
        ),
      }));
    },
    [commitState]
  );

  const value = React.useMemo<TradingDataContextValue>(
    () => ({
      state,
      isHydrated,
      storageStatus,
      derivedPositions,
      holdingCost,
      cash,
      validationIssues,
      activeStrategyProfile,
      updateAccount,
      updateStockPoolText,
      upsertPosition,
      removePosition,
      addTrade,
      importTrades,
      importPositions,
      applyRecognizedTrades,
      replacePositionSnapshot,
      updateTrade,
      removeTrade,
      setActiveStrategyProfile,
      updateStrategyProfile,
    }),
    [
      activeStrategyProfile,
      applyRecognizedTrades,
      addTrade,
      cash,
      derivedPositions,
      holdingCost,
      importTrades,
      importPositions,
      isHydrated,
      removePosition,
      removeTrade,
      setActiveStrategyProfile,
      state,
      storageStatus,
      updateAccount,
      updateTrade,
      updateStockPoolText,
      updateStrategyProfile,
      replacePositionSnapshot,
      upsertPosition,
      validationIssues,
    ]
  );

  return (
    <TradingDataContext.Provider value={value}>
      {children}
    </TradingDataContext.Provider>
  );
}

export function useTradingData() {
  const context = React.useContext(TradingDataContext);
  if (!context) {
    throw new Error("useTradingData must be used within TradingDataProvider");
  }
  return context;
}

function readStoredState() {
  if (typeof window === "undefined") {
    return DEFAULT_TRADING_DATA;
  }
  try {
    const stored = window.localStorage.getItem(TRADING_DATA_STORAGE_KEY);
    return stored ? sanitizeTradingData(JSON.parse(stored)) : DEFAULT_TRADING_DATA;
  } catch {
    return DEFAULT_TRADING_DATA;
  }
}

function persistLocalState(state: TradingDataState) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(TRADING_DATA_STORAGE_KEY, JSON.stringify(state));
}
