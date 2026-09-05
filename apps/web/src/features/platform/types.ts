import type { LucideIcon } from "lucide-react";
import {
  BrainCircuitIcon,
  BotIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  SlidersHorizontalIcon,
} from "lucide-react";

export type PlatformView =
  | "overview"
  | "quant"
  | "ai"
  | "data"
  | "ai-settings";

export type PlatformNavItem = {
  id: PlatformView;
  title: string;
  description: string;
  icon: LucideIcon;
};

export const platformNavItems: PlatformNavItem[] = [
  {
    id: "overview",
    title: "总览",
    description: "盈亏、今日变动与持仓状态",
    icon: LayoutDashboardIcon,
  },
  {
    id: "ai",
    title: "AI 日历",
    description: "每日分析与连续对话",
    icon: BotIcon,
  },
  {
    id: "quant",
    title: "量化分析",
    description: "单股多智能体研判",
    icon: BrainCircuitIcon,
  },
  {
    id: "data",
    title: "交易记录",
    description: "截图导入与交易流水",
    icon: DatabaseIcon,
  },
  {
    id: "ai-settings",
    title: "AI 模型配置",
    description: "AI 连接与研究数据",
    icon: SlidersHorizontalIcon,
  },
];

export function getPlatformViewMeta(view: PlatformView) {
  return (
    platformNavItems.find((item) => item.id === view) ??
    platformNavItems[0]
  );
}
