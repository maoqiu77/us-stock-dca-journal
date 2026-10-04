"use client";

import { useQueryClient } from "@tanstack/react-query";
import * as React from "react";

import {
  fetchTradingState,
  saveTradingState,
  fetchTradingReceipt,
  downloadLocalBackup,
} from "@/features/platform/api";
import { LedgerWriter, changedFields, type SaveStatus, type WriterSnapshot } from "./ledger-writer";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  recordTrade,
  removeTrackedTicker,
  replaceRecordedTrade,
  replaceStockPool,
  sanitizeTradingData,
  trackTickerForObservation,
  upsertPositionPlan,
  uniqueTickers,
  validateTradingData,
  type AssetType,
  type PositionPlan,
  type PositionSnapshotInput,
  type StrategyProfile,
  type StrategySettings,
  type TradeInput,
  type TradingAccount,
  type TradingDataState,
} from "@/features/platform/trading-data";
import { applyCheckpoint, type Checkpoint } from "./checkpoints";

type StorageStatus = SaveStatus;
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
  observeTicker: (ticker: string, assetType?: AssetType) => void;
  addTrade: (input: TradeInput, assetType?: AssetType) => void;
  importTrades: (inputs: TradeInput[]) => void;
  importPositions: (inputs: PositionSnapshotInput[], importDate: string) => void;
  applyRecognizedTrades: (inputs: Array<{ ticker: string; action: "买入" | "卖出"; shares: number; unitPrice: number; amount: number; assetType: "ETF" | "STOCK"; date?: string; note?: string }>, date: string) => void;
  replacePositionSnapshot: (inputs: PositionSnapshotInput[], date: string) => void;
  addCheckpoint: (checkpoint: Checkpoint) => void;
  checkpointRevision: string | undefined;
  updateTrade: (
    id: string,
    input: TradeInput,
    assetType?: AssetType
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
const SaveStatusContext = React.createContext<React.ReactNode>(null);

export function TradingSaveStatus() {
  return React.useContext(SaveStatusContext);
}

export function TradingDataProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const [state, setState] = React.useState<TradingDataState>(DEFAULT_TRADING_DATA);
  const [storageStatus, setStorageStatus] =
    React.useState<StorageStatus>("loading");
  const isHydrated = storageStatus !== "loading";
  const hasLoadedStateRef = React.useRef(false);
  const stateRef = React.useRef(state);
  const writerRef = React.useRef<LedgerWriter<TradingDataState> | null>(null);
  const [saveInfo, setSaveInfo] = React.useState<WriterSnapshot<TradingDataState>>({ status: "loading" });
  const [localWarning, setLocalWarning] = React.useState("");

  const invalidateTradingQueries = React.useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["watchlist"] });
    queryClient.invalidateQueries({ queryKey: ["quotes"] });
    queryClient.invalidateQueries({ queryKey: ["signals"] });
    queryClient.invalidateQueries({ queryKey: ["backtests"] });
  }, [queryClient]);

  React.useEffect(() => {
    const draftKey = `${TRADING_DATA_STORAGE_KEY}:draft:${crypto.randomUUID()}`;
    const writer = new LedgerWriter<TradingDataState>({ read: fetchTradingState, write: saveTradingState, receipt: fetchTradingReceipt }, (next) => {
      hasLoadedStateRef.current = next.status !== "loading";
      if (next.state) { stateRef.current = next.state; setState(next.state); }
      setStorageStatus(next.status);
      setSaveInfo(next);
      if (next.state) {
        try { localStorage.setItem(draftKey, JSON.stringify({ ...next, updatedAt: Date.now() })); }
        catch { setLocalWarning("浏览器无法持久保存草稿；当前内容仍在内存中，请立即导出后再关闭窗口。"); }
      }
      if (next.status === "api") invalidateTradingQueries();
    });
    writerRef.current = writer;
    let draft: { state: TradingDataState; operation?: WriterSnapshot<TradingDataState>["operation"] } | undefined;
    try {
      const candidates = Object.keys(localStorage).filter(key => key.startsWith(`${TRADING_DATA_STORAGE_KEY}:draft:`)).map(key => JSON.parse(localStorage.getItem(key)!)).filter(item => item.state).sort((a, b) => Number(a.status === "api") - Number(b.status === "api") || b.updatedAt - a.updatedAt);
      const stored = localStorage.getItem(TRADING_DATA_STORAGE_KEY);
      const candidate = candidates[0] ?? (stored ? { state: JSON.parse(stored) } : undefined);
      if (candidate) {
        assertStoredState(candidate.state);
        draft = candidate;
      }
    } catch {
      queueMicrotask(() => setLocalWarning("发现无法读取的浏览器副本，原始内容已保留，未写回默认数据。请导出所有草稿后检查。"));
    }
    void writer.connect(draft);
    return () => {
      writer.close();
      hasLoadedStateRef.current = false;
    };
  }, [invalidateTradingQueries]);

  const commitState = React.useCallback(
    (updater: (current: TradingDataState) => TradingDataState) => {
      if (!hasLoadedStateRef.current) return;
      writerRef.current?.edit(sanitizeTradingData(updater(stateRef.current)));
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

  const observeTicker = React.useCallback(
    (ticker: string, assetType: AssetType = "STOCK") => {
      commitState((current) =>
        trackTickerForObservation(current, ticker, assetType)
      );
    },
    [commitState]
  );

  const addTrade = React.useCallback(
    (input: TradeInput, assetType: AssetType = "STOCK") => {
      commitState((current) => recordTrade(current, input, assetType));
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
  const addCheckpoint = React.useCallback((checkpoint: Checkpoint) => commitState((current) => applyCheckpoint(current, checkpoint)), [commitState]);

  const updateTrade = React.useCallback(
    (
      id: string,
      input: TradeInput,
      assetType: AssetType = "STOCK"
    ) => {
      commitState((current) =>
        replaceRecordedTrade(current, id, input, assetType)
      );
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
      observeTicker,
      addTrade,
      importTrades,
      importPositions,
      applyRecognizedTrades,
      replacePositionSnapshot,
      addCheckpoint,
      checkpointRevision: saveInfo.revision,
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
      observeTicker,
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
      addCheckpoint,
      saveInfo.revision,
      upsertPosition,
      validationIssues,
    ]
  );

  const saveStatusPanel = (
      <Alert className="rounded-none border-x-0" role="status">
        <AlertTitle>{SAVE_LABELS[storageStatus]}</AlertTitle>
        <AlertDescription className="flex flex-col gap-2">
          {saveInfo.message && <p>{saveInfo.message}</p>}
          {localWarning && <p>{localWarning}</p>}
          {saveInfo.remote && <details>
            <summary>查看差异：{changedFields(state as unknown as Record<string, unknown>, saveInfo.remote.state as unknown as Record<string, unknown>).join("、")}</summary>
            <div className="grid max-h-64 grid-cols-2 gap-4 overflow-auto">
              <pre className="text-xs">浏览器候选{JSON.stringify(state, null, 2)}</pre>
              <pre className="text-xs">数据库候选{JSON.stringify(saveInfo.remote.state, null, 2)}</pre>
            </div>
          </details>}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => exportDrafts(saveInfo)}>导出所有浏览器草稿</Button>
            {!["loading", "saving", "api"].includes(storageStatus) && <Button size="sm" variant="outline" onClick={() => void writerRef.current?.connect()}>重新连接 / 核验回执</Button>}
            {saveInfo.remote && <>
              <Button size="sm" variant="outline" onClick={() => resolveCandidate("remote")}>保留草稿，采用数据库版本</Button>
              <Button size="sm" variant="outline" onClick={() => resolveCandidate("local")}>确认以浏览器候选替换此数据库版本</Button>
            </>}
            <Button size="sm" variant="outline" onClick={async () => {
              try { downloadBlob(await downloadLocalBackup(), "持仓手记-完整本地备份.zip"); }
              catch (error) { setLocalWarning(String(error)); }
            }}>下载数据库完整备份（不含密钥）</Button>
          </div>
          {storageStatus !== "api" && <p>仅数据库回执确认后才算写账。完整备份不包含未提交的浏览器草稿，请单独导出。</p>}
          <details><summary>恢复与损坏诊断说明</summary><p>保留原始数据库。先使用本地恢复工具在新目录校验备份，再停止 API 服务后切换；旧目录会保留为恢复点。操作命令见项目“优化/U02_备份恢复说明.md”。旧热拷贝 ZIP 不会被自动覆盖恢复，未决 AI 请求不会重发。</p></details>
        </AlertDescription>
      </Alert>
  );
  return (
    <TradingDataContext.Provider value={value}>
      <SaveStatusContext.Provider value={saveStatusPanel}>{children}</SaveStatusContext.Provider>
    </TradingDataContext.Provider>
  );

  function resolveCandidate(choice: "local" | "remote") {
    // Archive both versions before explicit reconciliation, even when local storage is full.
    try { localStorage.setItem(`${TRADING_DATA_STORAGE_KEY}:conflict:${crypto.randomUUID()}`, JSON.stringify(saveInfo)); }
    catch { exportDrafts(saveInfo); }
    writerRef.current?.resolve(choice);
  }
}

export function useTradingData() {
  const context = React.useContext(TradingDataContext);
  if (!context) {
    throw new Error("useTradingData must be used within TradingDataProvider");
  }
  return context;
}

const SAVE_LABELS: Record<SaveStatus, string> = { loading: "正在读取账本", api: "已写入本地数据库", saving: "保存中", local: "仅浏览器草稿", error: "保存被拒绝 · 草稿已保留", conflict: "保存冲突 · 两份候选均保留", unknown: "保存结果待核验" };

function assertStoredState(value: TradingDataState) {
  if (!value || value.schemaVersion !== 1 || !value.account || !Array.isArray(value.trades) || !Array.isArray(value.positions) || !Array.isArray(value.stockPool)) throw new Error("invalid draft");
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportDrafts(current: WriterSnapshot<TradingDataState>) {
  const copies: Record<string, string | null> = {};
  try { for (const key of Object.keys(localStorage)) if (key.startsWith(TRADING_DATA_STORAGE_KEY)) copies[key] = localStorage.getItem(key); } catch { /* In-memory candidate is still exportable. */ }
  downloadBlob(new Blob([JSON.stringify({ format: "ledger-browser-drafts-v1", current, copies }, null, 2)], { type: "application/json" }), "持仓手记-浏览器草稿.json");
}
