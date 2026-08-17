"use client";

import * as React from "react";
import { useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";

import { AppShell } from "@/components/layout/app-shell";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { DashboardView } from "@/features/platform/views/dashboard-view";
import { TradingDataProvider } from "@/features/platform/trading-data-context";
import type { PlatformView } from "@/features/platform/types";

const ONBOARDING_STORAGE_KEY = "stock-platform-onboarding-v1";
const ACTIVE_VIEW_STORAGE_KEY = "stock-platform-active-view-v1";
const RESTORABLE_VIEWS: PlatformView[] = [
  "overview",
  "charts",
  "strategy",
  "ai",
  "health",
  "data",
  "settings",
];

const ChartWorkspace = dynamic(
  () =>
    import("@/features/charts/chart-workspace").then(
      (mod) => mod.ChartWorkspace
    ),
  { loading: () => <WorkspaceViewLoading /> }
);
const StrategyView = dynamic(
  () =>
    import("@/features/platform/views/strategy-view").then(
      (mod) => mod.StrategyView
    ),
  { loading: () => <WorkspaceViewLoading /> }
);
const AiAdviceView = dynamic(
  () =>
    import("@/features/platform/views/ai-advice-view").then(
      (mod) => mod.AiAdviceView
    ),
  { loading: () => <WorkspaceViewLoading /> }
);
const HealthCheckView = dynamic(
  () =>
    import("@/features/platform/views/health-check-view").then(
      (mod) => mod.HealthCheckView
    ),
  { loading: () => <WorkspaceViewLoading /> }
);
const DataManagementView = dynamic(
  () =>
    import("@/features/platform/views/data-management-view").then(
      (mod) => mod.DataManagementView
    ),
  { loading: () => <WorkspaceViewLoading /> }
);
const SettingsView = dynamic(
  () =>
    import("@/features/platform/views/settings-view").then(
      (mod) => mod.SettingsView
    ),
  { loading: () => <WorkspaceViewLoading /> }
);

export function PlatformWorkspace() {
  const queryClient = useQueryClient();
  const [activeView, setActiveView] =
    React.useState<PlatformView>("overview");
  const [marketRefreshKey, setMarketRefreshKey] = React.useState(0);
  const [showOnboarding, setShowOnboarding] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      const storedView = window.localStorage.getItem(ACTIVE_VIEW_STORAGE_KEY);
      if (isPlatformView(storedView)) {
        setActiveView(storedView);
      }
      setShowOnboarding(
        window.localStorage.getItem(ONBOARDING_STORAGE_KEY) !== "dismissed"
      );
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const refreshMarketData = React.useCallback(() => {
    setMarketRefreshKey((current) => current + 1);
    queryClient.invalidateQueries({ queryKey: ["signals"] });
    queryClient.invalidateQueries({ queryKey: ["chart"] });
  }, [queryClient]);

  React.useEffect(() => {
    window.scrollTo({ left: 0, top: 0 });
  }, [activeView]);

  const dismissOnboarding = React.useCallback(() => {
    window.localStorage.setItem(ONBOARDING_STORAGE_KEY, "dismissed");
    setShowOnboarding(false);
  }, []);

  const changeActiveView = React.useCallback((view: PlatformView) => {
    window.localStorage.setItem(ACTIVE_VIEW_STORAGE_KEY, view);
    setActiveView(view);
  }, []);

  const openOnboardingView = React.useCallback(
    (view: PlatformView) => {
      dismissOnboarding();
      changeActiveView(view);
    },
    [changeActiveView, dismissOnboarding]
  );
  const handleOnboardingOpenChange = React.useCallback(
    (open: boolean) => {
      if (open) {
        setShowOnboarding(true);
        return;
      }
      dismissOnboarding();
    },
    [dismissOnboarding]
  );

  return (
    <TradingDataProvider>
      <AppShell
        activeView={activeView}
        onMarketRefresh={refreshMarketData}
        onViewChange={changeActiveView}
      >
        {activeView === "overview" ? (
          <DashboardView
            marketRefreshKey={marketRefreshKey}
            onNavigate={changeActiveView}
          />
        ) : null}
        {activeView === "charts" ? (
          <ChartWorkspace marketRefreshKey={marketRefreshKey} />
        ) : null}
        {activeView === "strategy" ? <StrategyView /> : null}
        {activeView === "ai" ? <AiAdviceView /> : null}
        {activeView === "health" ? <HealthCheckView /> : null}
        {activeView === "data" ? <DataManagementView /> : null}
        {activeView === "settings" ? <SettingsView /> : null}
      </AppShell>
      <FirstRunOnboarding
        open={showOnboarding}
        onOpenChange={handleOnboardingOpenChange}
        onDismiss={dismissOnboarding}
        onOpenData={() => openOnboardingView("data")}
        onOpenHealth={() => openOnboardingView("health")}
      />
    </TradingDataProvider>
  );
}

function FirstRunOnboarding({
  open,
  onOpenChange,
  onDismiss,
  onOpenData,
  onOpenHealth,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismiss: () => void;
  onOpenData: () => void;
  onOpenHealth: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>首次使用</DialogTitle>
          <DialogDescription>
            这个工具默认把运行数据保存在本机 storage/local。你可以先用示例数据熟悉界面，
            再到数据管理里维护自己的股票池、持仓目标和 AI 接口。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 text-sm">
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="font-medium">本地数据</div>
            <div className="mt-1 text-muted-foreground">
              私有状态写入 storage/local/app.db，公开模板保留在 storage/templates。
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="font-medium">先看演示</div>
            <div className="mt-1 text-muted-foreground">
              没有配置时会使用示例股票池和可降级行情，sample 数据不会作为真实交易依据。
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="font-medium">AI 可选</div>
            <div className="mt-1 text-muted-foreground">
              AI 建议使用 OpenAI-compatible 接口；发送前会再次确认账户、持仓、交易流水和策略信号上下文。
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onOpenHealth}>
            检查更新
          </Button>
          <Button variant="outline" onClick={onOpenData}>
            去数据管理
          </Button>
          <Button onClick={onDismiss}>先用示例数据</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceViewLoading() {
  return (
    <div className="flex min-h-[calc(100svh-6.5rem)] flex-col gap-3">
      <Skeleton className="h-24 w-full" />
      <Skeleton className="min-h-[420px] w-full flex-1" />
    </div>
  );
}

function isPlatformView(value: string | null): value is PlatformView {
  return RESTORABLE_VIEWS.some((view) => view === value);
}
