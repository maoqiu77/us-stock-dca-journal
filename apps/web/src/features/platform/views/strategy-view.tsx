"use client";

import * as React from "react";
import {
  BarChart3Icon,
  FlaskConicalIcon,
  GitBranchIcon,
  HistoryIcon,
  LineChartIcon,
  RefreshCwIcon,
  ShieldAlertIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import type {
  BacktestStrategyResult,
  SignalRow,
} from "@/features/platform/api";
import {
  etfInvestmentPool,
  formatMoney,
  formatRatio,
  formatShares,
  normalizeTicker,
  todayIsoDate,
  type StrategyProfile,
  type StrategySettings,
} from "@/features/platform/trading-data";
import { useTradingData } from "@/features/platform/trading-data-context";
import {
  useBacktestQuery,
  useSignalsQuery,
} from "@/features/platform/queries";

const profileIcons = {
  conservative: ShieldAlertIcon,
  balanced: GitBranchIcon,
  aggressive: BarChart3Icon,
  custom: FlaskConicalIcon,
};

const backtestStrategyDescriptions: Record<string, string> = {
  "Lump Sum Buy and Hold": "期初把初始资金和未来计划投入一次性买入，用作高仓位基准。",
  "Same Cashflow Buy and Hold": "按同样外部现金流买入并持有，用于比较择时是否真正跑赢现金流基准。",
  "MA200 Risk Filter - Hold Cash": "跌破 MA200 时暂停新增买入，现金保留等待趋势恢复。",
  "MA200 Risk Filter - Sell to Cash": "跌破 MA200 时卖出转现金，测试更强风控对回撤和收益的影响。",
  "Trend Pullback Add": "结合趋势、RSI 和回撤区间触发加仓，模拟旧项目择时规则。",
  "Layered Pullback Add": "按不同回撤层级分配资金，回撤越深使用更高计划资金比例。",
  "Buy and Hold": "旧版函数基准：期初买入并持有到回测结束。",
  "Monthly DCA": "旧版函数基准：按月定投并持有。",
};

type UpdateStrategyProfile = (
  profileId: StrategyProfile["id"],
  patch: Partial<Pick<StrategyProfile, "name" | "description">> & {
    settings?: Partial<StrategySettings>;
  }
) => void;

type BacktestSelectableItem = {
  id: string;
  sourceLabel: string;
  item: BacktestStrategyResult;
};

export function StrategyView() {
  const {
    state,
    cash,
    activeStrategyProfile,
    setActiveStrategyProfile,
    updateStrategyProfile,
  } = useTradingData();
  const settings = activeStrategyProfile.settings;
  const etfPool = etfInvestmentPool(state, settings);
  const signalsQuery = useSignalsQuery();
  const [preferredBacktestTicker, setPreferredBacktestTicker] =
    React.useState("");
  const backtestTicker = state.stockPool.includes(preferredBacktestTicker)
    ? preferredBacktestTicker
    : state.stockPool[0] ?? "";

  const backtestQuery = useBacktestQuery(
    backtestTicker,
    "1y",
    state.account.totalAssets
  );
  const signalRows = signalsQuery.data ?? [];
  const backtestData = backtestQuery.data;
  const backtestItems = backtestData?.items ?? [];
  const legacyBacktestItems = backtestData?.legacyItems ?? [];
  const allBacktestItems = React.useMemo<BacktestSelectableItem[]>(
    () => [
      ...(backtestData?.items ?? []).map((item, index) => ({
        id: `modern-${index}-${item.name}`,
        sourceLabel: "完整策略",
        item,
      })),
      ...(backtestData?.legacyItems ?? []).map((item, index) => ({
        id: `legacy-${index}-${item.name}`,
        sourceLabel: "旧版函数",
        item,
      })),
    ],
    [backtestData]
  );
  const [selectedBacktestId, setSelectedBacktestId] = React.useState("");

  const selectedBacktest =
    allBacktestItems.find((item) => item.id === selectedBacktestId) ??
    allBacktestItems[0];
  const signalStationCard = (
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <FlaskConicalIcon />
          信号台
        </CardTitle>
        <CardDescription>
          后端使用旧项目 signal_engine 计算趋势、RSI、回撤和手动交易提示
        </CardDescription>
        <CardAction>
          <Button
            variant="outline"
            size="sm"
            onClick={() => signalsQuery.refetch()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            刷新
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="min-w-0">
        <Table className="min-w-[1080px]">
          <TableHeader>
            <TableRow>
              <TableHead>标的</TableHead>
              <TableHead>动作</TableHead>
              <TableHead>趋势</TableHead>
              <TableHead className="text-right">RSI / 52 周回撤</TableHead>
              <TableHead className="text-right">仓位 / 目标</TableHead>
              <TableHead className="text-right">建议金额</TableHead>
              <TableHead>解释</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {signalsQuery.isLoading ? <SignalSkeletonRows /> : null}
            {!signalsQuery.isLoading && !signalRows.length ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  暂无信号数据。
                </TableCell>
              </TableRow>
            ) : null}
            {!signalsQuery.isLoading
              ? signalRows.map((row) => <SignalTableRow key={row.ticker} row={row} />)
              : null}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-4">
        {state.strategyProfiles.map((profile) => {
          const Icon = profileIcons[profile.id];
          const isActive = profile.id === state.activeStrategyProfile;
          return (
            <Card key={profile.id} size="sm">
              <CardHeader className="border-b">
                <CardTitle className="flex items-center gap-2">
                  <Icon />
                  {profile.name}
                </CardTitle>
                <CardDescription>{profile.description}</CardDescription>
                <CardAction>
                  <Badge variant={isActive ? "secondary" : "outline"}>
                    {isActive ? "active" : "profile"}
                  </Badge>
                </CardAction>
              </CardHeader>
              <CardContent>
                <Button
                  variant={isActive ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setActiveStrategyProfile(profile.id)}
                >
                  使用该策略
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
      {signalStationCard}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-3">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <GitBranchIcon />
              当前策略参数
            </CardTitle>
            <CardDescription>
              对齐旧项目 signal_engine、position_sizing 和 backtest_engine
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-3 md:grid-cols-3">
                <NumberField
                  id="ma-medium"
                  label="MA 中期"
                  value={settings.maMedium}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      maMedium: value,
                    })
                  }
                />
                <NumberField
                  id="ma-long"
                  label="MA 长期"
                  value={settings.maLong}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      maLong: value,
                    })
                  }
                />
                <NumberField
                  id="ma-risk"
                  label="MA 风控"
                  value={settings.maRisk}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      maRisk: value,
                    })
                  }
                />
                <NumberField
                  id="rsi-period"
                  label="RSI 周期"
                  value={settings.rsiPeriod}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      rsiPeriod: value,
                    })
                  }
                />
                <NumberField
                  id="rsi-max"
                  label="加仓 RSI 上限"
                  value={settings.rsiMax}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      rsiMax: value,
                    })
                  }
                />
                <NumberField
                  id="reduce-rsi"
                  label="减仓 RSI"
                  value={settings.reduceRsi}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      reduceRsi: value,
                    })
                  }
                />
                <NumberField
                  id="take-profit-rsi"
                  label="止盈 RSI"
                  value={settings.takeProfitRsi}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      takeProfitRsi: value,
                    })
                  }
                />
                <RatioField
                  id="pullback-min"
                  label="回撤下限"
                  value={settings.pullbackMin}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      pullbackMin: value,
                    })
                  }
                />
                <RatioField
                  id="pullback-max"
                  label="回撤上限"
                  value={settings.pullbackMax}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      pullbackMax: value,
                    })
                  }
                />
                <RatioField
                  id="deep-pullback-min"
                  label="深回撤下限"
                  value={settings.deeperPullbackMin}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      deeperPullbackMin: value,
                    })
                  }
                />
                <RatioField
                  id="deep-pullback-max"
                  label="深回撤上限"
                  value={settings.deeperPullbackMax}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      deeperPullbackMax: value,
                    })
                  }
                />
                <RatioField
                  id="target-default"
                  label="默认目标仓位"
                  value={settings.targetWeightDefault}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      targetWeightDefault: value,
                    })
                  }
                />
                <RatioField
                  id="starter-position"
                  label="底仓判断比例"
                  value={settings.starterPositionRatio}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      starterPositionRatio: value,
                    })
                  }
                />
                <RatioField
                  id="trim-target-buffer"
                  label="目标缓冲"
                  value={settings.trimToTargetBuffer}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      trimToTargetBuffer: value,
                    })
                  }
                />
                <RatioField
                  id="single-add-asset"
                  label="单次总资产上限"
                  value={settings.singleAddAssetRatio}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      singleAddAssetRatio: value,
                    })
                  }
                />
                <RatioField
                  id="single-add-cash"
                  label="单次现金上限"
                  value={settings.singleAddCashRatio}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      singleAddCashRatio: value,
                    })
                  }
                />
                <RatioField
                  id="starter-add-asset"
                  label="底仓总资产上限"
                  value={settings.starterAddAssetRatio}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      starterAddAssetRatio: value,
                    })
                  }
                />
                <RatioField
                  id="starter-add-cash"
                  label="底仓现金上限"
                  value={settings.starterAddCashRatio}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      starterAddCashRatio: value,
                    })
                  }
                />
                <RatioField
                  id="strong-add-asset"
                  label="强信号总资产上限"
                  value={settings.strongAddAssetRatio}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      strongAddAssetRatio: value,
                    })
                  }
                />
                <RatioField
                  id="strong-add-cash"
                  label="强信号现金上限"
                  value={settings.strongAddCashRatio}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      strongAddCashRatio: value,
                    })
                  }
                />
                <RatioField
                  id="max-etf-weight"
                  label="单只 ETF 上限"
                  value={settings.maxEtfWeight}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      maxEtfWeight: value,
                    })
                  }
                />
                <RatioField
                  id="take-profit-trim"
                  label="止盈减仓比例"
                  value={settings.takeProfitTrimRatio}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      takeProfitTrimRatio: value,
                    })
                  }
                />
                <RatioField
                  id="hard-stop"
                  label="跌破均线减仓"
                  value={settings.hardStopMaBreakRatio}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      hardStopMaBreakRatio: value,
                    })
                  }
                />
                <NumberField
                  id="monthly-dca"
                  label="月度定投"
                  value={settings.monthlyDcaAmount}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      monthlyDcaAmount: value,
                    })
                  }
                />
                <NumberField
                  id="recent-etf-investment"
                  label="近期可新投入资金"
                  value={settings.recentEtfInvestmentAmount}
                  onChange={(value) =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      recentEtfInvestmentAmount: value,
                      recentEtfInvestmentStartDate:
                        settings.recentEtfInvestmentStartDate || todayIsoDate(),
                    })
                  }
                />
              </div>
              <div className="grid gap-3 rounded-lg bg-muted/50 p-3 md:grid-cols-4">
                <MetricRow label="本轮开始" value={settings.recentEtfInvestmentStartDate || "未开始"} />
                <MetricRow label="计划投入" value={formatMoney(etfPool.total)} />
                <MetricRow label="已经投入" value={formatMoney(etfPool.invested)} />
                <MetricRow label="剩余额度" value={formatMoney(etfPool.remaining)} />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    patchSettings(activeStrategyProfile, updateStrategyProfile, {
                      recentEtfInvestmentStartDate: todayIsoDate(),
                    })
                  }
                >
                  开始新一轮
                </Button>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
        <LayeredStrategyCard
          profile={activeStrategyProfile}
          settings={settings}
          updateStrategyProfile={updateStrategyProfile}
        />
        </div>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ShieldAlertIcon />
              策略摘要
            </CardTitle>
            <CardDescription>
              这些参数会进入后端信号、回测和 AI 上下文
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            <MetricRow label="当前档案" value={activeStrategyProfile.name} />
            <MetricRow label="现金" value={formatMoney(cash)} />
            <MetricRow
              label="RSI"
              value={`${settings.rsiPeriod} 日 / 加仓上限 ${settings.rsiMax}`}
            />
            <MetricRow
              label="普通回撤"
              value={`${formatRatio(settings.pullbackMin)} - ${formatRatio(
                settings.pullbackMax
              )}`}
            />
            <MetricRow
              label="深回撤"
              value={`${formatRatio(settings.deeperPullbackMin)} - ${formatRatio(
                settings.deeperPullbackMax
              )}`}
            />
            <MetricRow
              label="单次加仓"
              value={`${formatRatio(settings.singleAddAssetRatio)} 总资产 / ${formatRatio(
                settings.singleAddCashRatio
              )} 现金`}
            />
            <MetricRow
              label="强信号加仓"
              value={`${formatRatio(settings.strongAddAssetRatio)} 总资产 / ${formatRatio(
                settings.strongAddCashRatio
              )} 现金`}
            />
            <MetricRow
              label="减仓规则"
              value={`${formatRatio(settings.takeProfitTrimRatio)} 止盈 / ${formatRatio(
                settings.hardStopMaBreakRatio
              )} 风控`}
            />
            <MetricRow
              label="ETF 策略"
              value={`RSI ${settings.etfRsiMax} / 回撤 ${formatRatio(
                settings.etfPullbackMin
              )}-${formatRatio(settings.etfPullbackMax)}`}
            />
            <MetricRow
              label="核心仓策略"
              value={`RSI ${settings.coreRsiMax} / 回撤 ${formatRatio(
                settings.corePullbackMin
              )}-${formatRatio(settings.corePullbackMax)}`}
            />
            <MetricRow
              label="卫星仓策略"
              value={`RSI ${settings.satelliteRsiMax} / 回撤 ${formatRatio(
                settings.satellitePullbackMin
              )}-${formatRatio(settings.satellitePullbackMax)}`}
            />
            <MetricRow
              label="核心标的"
              value={roleTickers(settings, "core") || "--"}
            />
            <MetricRow
              label="卫星标的"
              value={roleTickers(settings, "satellite") || "--"}
            />
          </CardContent>
        </Card>
      </div>
      <Card className="min-w-0">
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <HistoryIcon />
            回测研究
          </CardTitle>
          <CardDescription>
            后端复用旧项目回测：现金流买入持有、MA 风控、趋势回撤加仓
          </CardDescription>
          <CardAction>
            <Badge variant="secondary">{backtestQuery.data?.source ?? "api"}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <ToggleGroup
              value={backtestTicker ? [backtestTicker] : []}
              onValueChange={(value) => {
                const nextValue = Array.isArray(value) ? value[0] : value;
                if (nextValue) {
                  setPreferredBacktestTicker(nextValue);
                }
              }}
              variant="outline"
              size="sm"
              className="flex flex-wrap"
            >
              {state.stockPool.map((ticker) => (
                <ToggleGroupItem
                  key={ticker}
                  value={ticker}
                  aria-label={`选择 ${ticker}`}
                >
                  {ticker}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <Button
              variant="outline"
              size="sm"
              onClick={() => backtestQuery.refetch()}
              disabled={!backtestTicker}
            >
              <RefreshCwIcon data-icon="inline-start" />
              刷新回测
            </Button>
          </div>
          <Table className="min-w-[1080px]">
            <TableHeader>
              <TableRow>
                <TableHead>策略</TableHead>
                <TableHead className="text-right">最终资产</TableHead>
                <TableHead className="text-right">总收益率</TableHead>
                <TableHead className="text-right">CAGR</TableHead>
                <TableHead className="text-right">最大回撤</TableHead>
                <TableHead className="text-right">夏普</TableHead>
                <TableHead className="text-right">交易次数</TableHead>
                <TableHead className="text-right">相对同现金流</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backtestQuery.isLoading ? <BacktestSkeletonRows /> : null}
              {!backtestQuery.isLoading && !backtestItems.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-muted-foreground">
                    暂无回测数据。
                  </TableCell>
                </TableRow>
              ) : null}
              {!backtestQuery.isLoading
                ? backtestItems.map((item) => (
                    <BacktestTableRow key={item.name} item={item} />
                  ))
                : null}
            </TableBody>
          </Table>
          <div className="grid gap-2">
            <div>
              <div className="text-sm font-medium">旧版函数回测</div>
              <div className="text-sm text-muted-foreground">
                从旧项目补齐的 Buy and Hold、Monthly DCA、MA200 风控函数
              </div>
            </div>
            <Table className="min-w-[860px]">
              <TableHeader>
                <TableRow>
                  <TableHead>策略</TableHead>
                  <TableHead className="text-right">最终资产</TableHead>
                  <TableHead className="text-right">总收益率</TableHead>
                  <TableHead className="text-right">CAGR</TableHead>
                  <TableHead className="text-right">最大回撤</TableHead>
                  <TableHead className="text-right">夏普</TableHead>
                  <TableHead className="text-right">交易次数</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {backtestQuery.isLoading ? <LegacyBacktestSkeletonRows /> : null}
                {!backtestQuery.isLoading && !legacyBacktestItems.length ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-muted-foreground">
                      暂无旧版回测数据。
                    </TableCell>
                  </TableRow>
                ) : null}
                {!backtestQuery.isLoading
                  ? legacyBacktestItems.map((item) => (
                      <LegacyBacktestTableRow key={item.name} item={item} />
                    ))
                  : null}
              </TableBody>
            </Table>
          </div>
          <BacktestDetailSection
            items={allBacktestItems}
            selectedItem={selectedBacktest}
            selectedId={selectedBacktestId}
            onSelectedIdChange={setSelectedBacktestId}
            isLoading={backtestQuery.isLoading}
          />
        </CardContent>
      </Card>
    </div>
  );
}

function LayeredStrategyCard({
  profile,
  settings,
  updateStrategyProfile,
}: {
  profile: StrategyProfile;
  settings: StrategySettings;
  updateStrategyProfile: UpdateStrategyProfile;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <BarChart3Icon />
          分层加减仓策略
        </CardTitle>
        <CardDescription>
          ETF、核心仓和卫星仓使用不同 RSI、回撤和单次资金上限
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <div className="grid gap-3 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="core-role-tickers">核心标的</FieldLabel>
              <Input
                id="core-role-tickers"
                value={roleTickers(settings, "core")}
                onChange={(event) =>
                  patchSettings(
                    profile,
                    updateStrategyProfile,
                    roleTickerPatch(settings, "core", event.target.value)
                  )
                }
                placeholder="VOO, QQQM, NVDA"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="satellite-role-tickers">卫星标的</FieldLabel>
              <Input
                id="satellite-role-tickers"
                value={roleTickers(settings, "satellite")}
                onChange={(event) =>
                  patchSettings(
                    profile,
                    updateStrategyProfile,
                    roleTickerPatch(settings, "satellite", event.target.value)
                  )
                }
                placeholder="MRVL, NOK"
              />
            </Field>
          </div>
          <div className="grid gap-3 xl:grid-cols-3">
            <RoleStrategyFields
              title="ETF"
              prefix="etf"
              rsiMax={settings.etfRsiMax}
              reduceRsi={settings.etfReduceRsi}
              takeProfitRsi={settings.etfTakeProfitRsi}
              pullbackMin={settings.etfPullbackMin}
              pullbackMax={settings.etfPullbackMax}
              strongAddAssetRatio={settings.etfStrongAddAssetRatio}
              onRsiMaxChange={(value) =>
                patchSettings(profile, updateStrategyProfile, { etfRsiMax: value })
              }
              onReduceRsiChange={(value) =>
                patchSettings(profile, updateStrategyProfile, { etfReduceRsi: value })
              }
              onTakeProfitRsiChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  etfTakeProfitRsi: value,
                })
              }
              onPullbackMinChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  etfPullbackMin: value,
                })
              }
              onPullbackMaxChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  etfPullbackMax: value,
                })
              }
              onStrongAddAssetRatioChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  etfStrongAddAssetRatio: value,
                })
              }
            />
            <RoleStrategyFields
              title="核心仓"
              prefix="core"
              rsiMax={settings.coreRsiMax}
              reduceRsi={settings.coreReduceRsi}
              takeProfitRsi={settings.coreTakeProfitRsi}
              pullbackMin={settings.corePullbackMin}
              pullbackMax={settings.corePullbackMax}
              strongAddAssetRatio={settings.coreStrongAddAssetRatio}
              onRsiMaxChange={(value) =>
                patchSettings(profile, updateStrategyProfile, { coreRsiMax: value })
              }
              onReduceRsiChange={(value) =>
                patchSettings(profile, updateStrategyProfile, { coreReduceRsi: value })
              }
              onTakeProfitRsiChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  coreTakeProfitRsi: value,
                })
              }
              onPullbackMinChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  corePullbackMin: value,
                })
              }
              onPullbackMaxChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  corePullbackMax: value,
                })
              }
              onStrongAddAssetRatioChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  coreStrongAddAssetRatio: value,
                })
              }
            />
            <RoleStrategyFields
              title="卫星仓"
              prefix="satellite"
              rsiMax={settings.satelliteRsiMax}
              reduceRsi={settings.satelliteReduceRsi}
              takeProfitRsi={settings.satelliteTakeProfitRsi}
              pullbackMin={settings.satellitePullbackMin}
              pullbackMax={settings.satellitePullbackMax}
              strongAddAssetRatio={settings.satelliteStrongAddAssetRatio}
              onRsiMaxChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  satelliteRsiMax: value,
                })
              }
              onReduceRsiChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  satelliteReduceRsi: value,
                })
              }
              onTakeProfitRsiChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  satelliteTakeProfitRsi: value,
                })
              }
              onPullbackMinChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  satellitePullbackMin: value,
                })
              }
              onPullbackMaxChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  satellitePullbackMax: value,
                })
              }
              onStrongAddAssetRatioChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  satelliteStrongAddAssetRatio: value,
                })
              }
            />
          </div>
          <div className="grid gap-3 lg:grid-cols-[180px_minmax(0,1fr)]">
            <NumberField
              id="layered-plan-amount"
              label="分层计划金额"
              value={settings.layeredPlanAmount}
              onChange={(value) =>
                patchSettings(profile, updateStrategyProfile, {
                  layeredPlanAmount: value,
                })
              }
            />
            <div className="grid gap-3 md:grid-cols-3">
              {settings.layeredPullbacks.map((layer, index) => (
                <div
                  key={`${layer.min}-${layer.max}-${index}`}
                  className="grid gap-3 rounded-lg bg-muted/50 p-3"
                >
                  <div className="text-sm font-medium">分层 {index + 1}</div>
                  <RatioField
                    id={`layered-${index}-min`}
                    label="回撤下限"
                    value={layer.min}
                    onChange={(value) =>
                      patchSettings(profile, updateStrategyProfile, {
                        layeredPullbacks: updateLayeredPullback(
                          settings,
                          index,
                          { min: value }
                        ),
                      })
                    }
                  />
                  <RatioField
                    id={`layered-${index}-max`}
                    label="回撤上限"
                    value={layer.max}
                    onChange={(value) =>
                      patchSettings(profile, updateStrategyProfile, {
                        layeredPullbacks: updateLayeredPullback(
                          settings,
                          index,
                          { max: value }
                        ),
                      })
                    }
                  />
                  <RatioField
                    id={`layered-${index}-ratio`}
                    label="资金比例"
                    value={layer.ratio}
                    onChange={(value) =>
                      patchSettings(profile, updateStrategyProfile, {
                        layeredPullbacks: updateLayeredPullback(
                          settings,
                          index,
                          { ratio: value }
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}

function RoleStrategyFields({
  title,
  prefix,
  rsiMax,
  reduceRsi,
  takeProfitRsi,
  pullbackMin,
  pullbackMax,
  strongAddAssetRatio,
  onRsiMaxChange,
  onReduceRsiChange,
  onTakeProfitRsiChange,
  onPullbackMinChange,
  onPullbackMaxChange,
  onStrongAddAssetRatioChange,
}: {
  title: string;
  prefix: string;
  rsiMax: number;
  reduceRsi: number;
  takeProfitRsi: number;
  pullbackMin: number;
  pullbackMax: number;
  strongAddAssetRatio: number;
  onRsiMaxChange: (value: number) => void;
  onReduceRsiChange: (value: number) => void;
  onTakeProfitRsiChange: (value: number) => void;
  onPullbackMinChange: (value: number) => void;
  onPullbackMaxChange: (value: number) => void;
  onStrongAddAssetRatioChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
      <div>
        <div className="text-sm font-medium">{title}</div>
        <div className="text-xs text-muted-foreground">角色专属加减仓阈值</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
        <NumberField
          id={`${prefix}-rsi-max`}
          label="加仓 RSI"
          value={rsiMax}
          onChange={onRsiMaxChange}
        />
        <NumberField
          id={`${prefix}-reduce-rsi`}
          label="减仓 RSI"
          value={reduceRsi}
          onChange={onReduceRsiChange}
        />
        <NumberField
          id={`${prefix}-take-profit-rsi`}
          label="止盈 RSI"
          value={takeProfitRsi}
          onChange={onTakeProfitRsiChange}
        />
        <RatioField
          id={`${prefix}-pullback-min`}
          label="回撤下限"
          value={pullbackMin}
          onChange={onPullbackMinChange}
        />
        <RatioField
          id={`${prefix}-pullback-max`}
          label="回撤上限"
          value={pullbackMax}
          onChange={onPullbackMaxChange}
        />
        <RatioField
          id={`${prefix}-strong-add`}
          label="强信号上限"
          value={strongAddAssetRatio}
          onChange={onStrongAddAssetRatioChange}
        />
      </div>
    </div>
  );
}

function SignalTableRow({ row }: { row: SignalRow }) {
  const explanation =
    row.reasons || row.blocked_reasons || row.manual_instruction || "--";

  return (
    <TableRow>
      <TableCell className="font-medium">
        <div className="flex flex-col gap-1">
          <span>{row.ticker}</span>
          <Badge variant="outline">{row.source}</Badge>
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={signalVariant(row.action)}>{row.action}</Badge>
      </TableCell>
      <TableCell>
        <div className="flex flex-col gap-1">
          <span>{row.trend_status}</span>
          <span className="text-xs text-muted-foreground">
            现价 {formatMoney(row.current_price)}
          </span>
        </div>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {numberLabel(row.rsi)} / {formatRatio(row.drawdown252 ?? row.drawdown)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatRatio(row.current_weight)} / {formatRatio(row.target_weight)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <div className="flex flex-col gap-1">
          <span>{formatMoney(row.suggested_amount)}</span>
          <span className="text-xs text-muted-foreground">
            {formatShares(row.suggested_shares)} 股
          </span>
        </div>
      </TableCell>
      <TableCell className="max-w-xl whitespace-normal text-muted-foreground">
        <div className="line-clamp-2">{explanation}</div>
      </TableCell>
    </TableRow>
  );
}

function BacktestTableRow({ item }: { item: BacktestStrategyResult }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{item.name}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatMoney(metricValue(item, "最终资产"))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatRatio(metricValue(item, "总收益率"))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatRatio(metricValue(item, "CAGR"))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatRatio(metricValue(item, "最大回撤"))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {numberLabel(metricValue(item, "夏普比率"))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {numberLabel(metricValue(item, "交易次数"), 0)}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatRatio(metricValue(item, "相对同现金流买入持有差异"))}
      </TableCell>
    </TableRow>
  );
}

function LegacyBacktestTableRow({ item }: { item: BacktestStrategyResult }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{item.name}</TableCell>
      <TableCell className="text-right tabular-nums">
        {formatMoney(metricValue(item, "最终资产"))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatRatio(metricValue(item, "总收益率"))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatRatio(metricValue(item, "CAGR"))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {formatRatio(metricValue(item, "最大回撤"))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {numberLabel(metricValue(item, "夏普比率"))}
      </TableCell>
      <TableCell className="text-right tabular-nums">
        {numberLabel(metricValue(item, "交易次数"), 0)}
      </TableCell>
    </TableRow>
  );
}

function BacktestDetailSection({
  items,
  selectedItem,
  selectedId,
  onSelectedIdChange,
  isLoading,
}: {
  items: BacktestSelectableItem[];
  selectedItem?: BacktestSelectableItem;
  selectedId: string;
  onSelectedIdChange: (value: string) => void;
  isLoading: boolean;
}) {
  if (isLoading) {
    return (
      <div className="grid gap-3 rounded-lg bg-muted/50 p-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-72 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (!items.length || !selectedItem) {
    return (
      <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
        暂无资金曲线和交易明细。
      </div>
    );
  }

  const item = selectedItem.item;
  const selectedValue = items.some((option) => option.id === selectedId)
    ? selectedId
    : selectedItem.id;
  const description =
    backtestStrategyDescriptions[item.name] ?? "当前策略的资金曲线和交易触发明细。";

  return (
    <div className="grid gap-3 rounded-lg bg-muted/40 p-3">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <LineChartIcon />
              资金曲线
            </div>
            <div className="mt-1 max-w-3xl text-sm text-muted-foreground">
              {description}
            </div>
          </div>
          <Badge variant="outline">{selectedItem.sourceLabel}</Badge>
        </div>
        <ToggleGroup
          value={[selectedValue]}
          onValueChange={(value) => {
            const nextValue = Array.isArray(value) ? value[0] : value;
            if (nextValue) {
              onSelectedIdChange(nextValue);
            }
          }}
          variant="outline"
          size="sm"
          className="flex flex-wrap justify-start"
        >
          {items.map((option) => (
            <ToggleGroupItem
              key={option.id}
              value={option.id}
              aria-label={`查看 ${option.sourceLabel} ${option.item.name}`}
            >
              {option.item.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_300px]">
        <EquityCurveChart item={item} />
        <div className="grid content-start gap-2">
          <MetricRow
            label="最终资产"
            value={formatMoney(metricValue(item, "最终资产"))}
          />
          <MetricRow
            label="总收益率"
            value={formatRatio(metricValue(item, "总收益率"))}
          />
          <MetricRow
            label="最大回撤"
            value={formatRatio(metricValue(item, "最大回撤"))}
          />
          <MetricRow
            label="交易次数"
            value={numberLabel(metricValue(item, "交易次数"), 0)}
          />
        </div>
      </div>
      <BacktestTradeTable item={item} />
    </div>
  );
}

function EquityCurveChart({ item }: { item: BacktestStrategyResult }) {
  const chart = buildEquityChart(item.equity);

  if (!chart) {
    return (
      <div className="flex h-72 items-center justify-center rounded-lg border bg-background text-sm text-muted-foreground">
        这个策略暂无可绘制的资金曲线。
      </div>
    );
  }

  return (
    <div className="min-w-0 overflow-x-auto rounded-lg border bg-background p-3">
      <svg
        role="img"
        aria-label={`${item.name} 资金曲线`}
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        className="h-72 min-w-[640px] w-full"
        preserveAspectRatio="none"
      >
        {chart.gridLines.map((line) => (
          <line
            key={line.y}
            x1={chart.padding.left}
            x2={chart.width - chart.padding.right}
            y1={line.y}
            y2={line.y}
            className="text-border"
            stroke="currentColor"
            strokeDasharray="4 6"
          />
        ))}
        <path
          d={chart.path}
          className="text-primary"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
        />
        {chart.yLabels.map((label) => (
          <text
            key={label.value}
            x={chart.padding.left - 10}
            y={label.y}
            className="text-muted-foreground"
            fill="currentColor"
            fontSize="11"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {label.value}
          </text>
        ))}
        {chart.xLabels.map((label) => (
          <text
            key={label.value}
            x={label.x}
            y={chart.height - 8}
            className="text-muted-foreground"
            fill="currentColor"
            fontSize="11"
            textAnchor={label.anchor}
          >
            {label.value}
          </text>
        ))}
      </svg>
    </div>
  );
}

function BacktestTradeTable({ item }: { item: BacktestStrategyResult }) {
  return (
    <div className="grid gap-2">
      <div>
        <div className="text-sm font-medium">单策略交易记录</div>
        <div className="text-sm text-muted-foreground">
          展示当前策略在回测区间内实际触发的买卖点和原因。
        </div>
      </div>
      <div className="overflow-x-auto">
        <Table className="min-w-[920px]">
          <TableHeader>
            <TableRow>
              <TableHead>日期</TableHead>
              <TableHead>动作</TableHead>
              <TableHead className="text-right">价格</TableHead>
              <TableHead className="text-right">股数</TableHead>
              <TableHead className="text-right">金额</TableHead>
              <TableHead>原因</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!item.trades.length ? (
              <TableRow>
                <TableCell colSpan={6} className="text-muted-foreground">
                  这个策略在当前区间内没有产生交易记录。
                </TableCell>
              </TableRow>
            ) : (
              item.trades.map((trade, index) => (
                <TableRow key={`${trade.Date}-${trade.Action}-${index}`}>
                  <TableCell>{trade.Date}</TableCell>
                  <TableCell>
                    <Badge variant={trade.Action === "BUY" ? "secondary" : "outline"}>
                      {trade.Action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(trade.Price)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatShares(trade.Shares)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(trade.Amount)}
                  </TableCell>
                  <TableCell className="max-w-xl whitespace-normal text-muted-foreground">
                    {trade.Reason || "--"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function SignalSkeletonRows() {
  return Array.from({ length: 4 }).map((_, index) => (
    <TableRow key={index}>
      {Array.from({ length: 7 }).map((__, cellIndex) => (
        <TableCell key={cellIndex}>
          <Skeleton className="h-5 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

function BacktestSkeletonRows() {
  return Array.from({ length: 5 }).map((_, index) => (
    <TableRow key={index}>
      {Array.from({ length: 8 }).map((__, cellIndex) => (
        <TableCell key={cellIndex}>
          <Skeleton className="h-5 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

function LegacyBacktestSkeletonRows() {
  return Array.from({ length: 4 }).map((_, index) => (
    <TableRow key={index}>
      {Array.from({ length: 7 }).map((__, cellIndex) => (
        <TableCell key={cellIndex}>
          <Skeleton className="h-5 w-full" />
        </TableCell>
      ))}
    </TableRow>
  ));
}

function buildEquityChart(points: BacktestStrategyResult["equity"]) {
  const cleanPoints = points.filter(
    (point) => Number.isFinite(point.equity) && point.date
  );

  if (cleanPoints.length < 2) {
    return null;
  }

  const width = 720;
  const height = 280;
  const padding = {
    top: 16,
    right: 16,
    bottom: 28,
    left: 76,
  };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const values = cleanPoints.map((point) => point.equity);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const rawRange = rawMax - rawMin;
  const paddedRange = rawRange > 0 ? rawRange * 1.16 : Math.max(rawMax * 0.08, 1);
  const yMin = rawRange > 0 ? rawMin - rawRange * 0.08 : rawMin - paddedRange / 2;
  const yMax = yMin + paddedRange;
  const xForIndex = (index: number) =>
    padding.left + (index / (cleanPoints.length - 1)) * plotWidth;
  const yForValue = (value: number) =>
    padding.top + ((yMax - value) / (yMax - yMin)) * plotHeight;
  const path = cleanPoints
    .map((point, index) => {
      const command = index === 0 ? "M" : "L";
      return `${command}${xForIndex(index).toFixed(2)},${yForValue(point.equity).toFixed(2)}`;
    })
    .join(" ");
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => ({
    y: padding.top + ratio * plotHeight,
  }));
  const yLabelValues = [yMax, (yMax + yMin) / 2, yMin];
  const yLabels = yLabelValues.map((value) => ({
    value: formatMoney(value),
    y: yForValue(value),
  }));
  const xLabelIndices = Array.from(
    new Set([0, Math.floor((cleanPoints.length - 1) / 2), cleanPoints.length - 1])
  );
  const xLabels = xLabelIndices.map((index, labelIndex) => {
    const anchor: "start" | "middle" | "end" =
      labelIndex === 0
        ? "start"
        : labelIndex === xLabelIndices.length - 1
          ? "end"
          : "middle";
    return {
      value: cleanPoints[index].date,
      x: xForIndex(index),
      anchor,
    };
  });

  return {
    width,
    height,
    padding,
    path,
    gridLines,
    yLabels,
    xLabels,
  };
}

function patchSettings(
  profile: StrategyProfile,
  updateStrategyProfile: UpdateStrategyProfile,
  settings: Partial<StrategySettings>
) {
  updateStrategyProfile(profile.id, { settings });
}

function roleTickerPatch(
  settings: StrategySettings,
  role: "core" | "satellite",
  value: string
): Partial<StrategySettings> {
  const tickers = parseTickerList(value);
  const tickerSet = new Set(tickers);
  const coreHoldings = Object.fromEntries(
    Object.entries(settings.coreHoldings).filter(([, currentRole]) => currentRole !== role)
  ) as StrategySettings["coreHoldings"];

  tickers.forEach((ticker) => {
    coreHoldings[ticker] = role;
  });

  if (role === "satellite") {
    return {
      coreHoldings,
      satelliteSymbols: tickers,
    };
  }

  return {
    coreHoldings,
    satelliteSymbols: settings.satelliteSymbols.filter(
      (ticker) => !tickerSet.has(normalizeTicker(ticker))
    ),
  };
}

function parseTickerList(value: string) {
  const seen = new Set<string>();
  return value
    .split(/[\s,，、]+/)
    .map(normalizeTicker)
    .filter((ticker) => {
      if (!ticker || seen.has(ticker)) {
        return false;
      }
      seen.add(ticker);
      return true;
    });
}

function updateLayeredPullback(
  settings: StrategySettings,
  index: number,
  patch: Partial<StrategySettings["layeredPullbacks"][number]>
) {
  return settings.layeredPullbacks.map((layer, currentIndex) =>
    currentIndex === index ? { ...layer, ...patch } : layer
  );
}

function NumberField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        value={Number.isFinite(value) ? value : 0}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </Field>
  );
}

function RatioField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min="0"
        max="100"
        step="1"
        value={percentInputValue(value)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
    </Field>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/50 p-3">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="min-w-0 truncate text-right font-medium tabular-nums" title={value}>
        {value}
      </span>
    </div>
  );
}

function roleTickers(
  settings: StrategySettings,
  role: "core" | "satellite"
) {
  const roleRows = Object.entries(settings.coreHoldings)
    .filter(([, value]) => value === role)
    .map(([ticker]) => ticker);
  if (role === "satellite") {
    return [...new Set([...roleRows, ...settings.satelliteSymbols])].join(", ");
  }
  return roleRows.join(", ");
}

function metricValue(item: BacktestStrategyResult, key: string) {
  const value = item.metrics[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberLabel(value?: number, digits = 2) {
  if (value === undefined || Number.isNaN(value)) {
    return "--";
  }
  return value.toFixed(digits);
}

function signalVariant(action: string) {
  if (action.includes("减") || action.includes("卖")) {
    return "outline";
  }
  if (action.includes("加") || action.includes("买")) {
    return "secondary";
  }
  return "outline";
}

function percentInputValue(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number((value * 100).toFixed(4));
}
