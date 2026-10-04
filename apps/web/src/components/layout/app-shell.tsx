"use client";

import * as React from "react";

import { AppSidebar } from "@/components/layout/app-sidebar";
import { TopBar } from "@/components/layout/top-bar";
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar";
import type { PlatformView } from "@/features/platform/types";

export function AppShell({
  activeView,
  onViewChange,
  onMarketRefresh,
  children,
}: {
  activeView: PlatformView;
  onViewChange: (view: PlatformView) => void;
  onMarketRefresh: () => void;
  children: React.ReactNode;
}) {
  const isMarketView = activeView === "overview" || activeView === "market-board";
  return (
    <SidebarProvider defaultOpen>
      <AppSidebar activeView={activeView} onViewChange={onViewChange} />
      <SidebarInset>
        <TopBar activeView={activeView} onMarketRefresh={onMarketRefresh} />
        <main className={isMarketView ? "min-h-[calc(100svh-3.5rem)] bg-background p-4 md:p-5 xl:p-6" : "min-h-[calc(100svh-3.5rem)] bg-background p-3 md:p-4"}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
