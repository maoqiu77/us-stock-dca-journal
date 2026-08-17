import type { LucideIcon } from "lucide-react";
import {
  ActivityIcon,
  BotIcon,
  CandlestickChartIcon,
  DatabaseIcon,
  LayoutDashboardIcon,
  SettingsIcon,
  SparklesIcon,
} from "lucide-react";

export type PlatformView =
  | "overview"
  | "charts"
  | "strategy"
  | "ai"
  | "health"
  | "data"
  | "settings";

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
    description: "账户、行情、数据状态",
    icon: LayoutDashboardIcon,
  },
  {
    id: "charts",
    title: "K线工作台",
    description: "多周期蜡烛图",
    icon: CandlestickChartIcon,
  },
  {
    id: "ai",
    title: "AI建议",
    description: "本地上下文建议流",
    icon: BotIcon,
  },
  {
    id: "data",
    title: "数据管理",
    description: "本地数据和安全提交",
    icon: DatabaseIcon,
  },
  {
    id: "strategy",
    title: "策略研究",
    description: "策略、信号、回测",
    icon: SparklesIcon,
  },
  {
    id: "health",
    title: "检查更新",
    description: "软件更新、启动、行情、AI 状态",
    icon: ActivityIcon,
  },
];

export const settingsNavItem: PlatformNavItem = {
  id: "settings",
  title: "设置",
  description: "偏好和安全边界",
  icon: SettingsIcon,
};

export function getPlatformViewMeta(view: PlatformView) {
  return (
    [...platformNavItems, settingsNavItem].find((item) => item.id === view) ??
    platformNavItems[0]
  );
}
