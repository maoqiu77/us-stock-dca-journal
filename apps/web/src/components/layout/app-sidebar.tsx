"use client";

import { CandlestickChartIcon } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  platformNavItems,
  type PlatformView,
} from "@/features/platform/types";

export function AppSidebar({
  activeView,
  onViewChange,
}: {
  activeView: PlatformView;
  onViewChange: (view: PlatformView) => void;
}) {
  const { setOpenMobile } = useSidebar();
  const selectView = (view: PlatformView) => {
    onViewChange(view);
    setOpenMobile(false);
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" isActive>
              <CandlestickChartIcon />
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">Stock Lab</span>
                <span className="truncate text-xs text-muted-foreground">
                  Local Research
                </span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>功能</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {platformNavItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    isActive={activeView === item.id}
                    onClick={() => selectView(item.id)}
                  >
                    <item.icon />
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
