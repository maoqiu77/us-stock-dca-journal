"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { LucideIcon } from "lucide-react";
import {
  ActivityIcon,
  BanIcon,
  BrainCircuitIcon,
  Building2Icon,
  CalendarDaysIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  Clock3Icon,
  HistoryIcon,
  LandmarkIcon,
  LoaderCircleIcon,
  MessagesSquareIcon,
  NewspaperIcon,
  PauseCircleIcon,
  PlayIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  SquareIcon,
  Trash2Icon,
  WalletCardsIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useQuotesQuery } from "@/features/charts/queries";
import { useTradingData } from "@/features/platform/trading-data-context";
import {
  cancelQuantAnalysisRun,
  createQuantAnalysisReflection,
  createQuantAnalysisRun,
  deleteQuantAnalysisRun,
  fetchQuantAnalysisRun,
  fetchQuantAnalysisRuns,
  resumeQuantAnalysisRun,
} from "./api";
import {
  estimateAnalysisCalls,
  groupAnalysisRuns,
  localTodayIso,
  normalizeAnalystsForDate,
} from "./rules";
import {
  buildHoldingConclusion,
  type HoldingConclusion,
} from "./holding-conclusion";
import type {
  CreateQuantAnalysisRunInput,
  QuantAnalysisMode,
  QuantAnalysisRun,
  QuantAnalysisStep,
  QuantAnalyst,
  QuantFinalResult,
} from "./types";

const ACTIVE_STATUSES = new Set(["queued", "running", "cancel_requested"]);
const ANALYSTS: Array<{
  id: QuantAnalyst;
  title: string;
  description: string;
  sources: string;
  scope: string;
  icon: LucideIcon;
}> = [
  {
    id: "technical",
    title: "技术分析",
    description: "趋势、动量、波动、回撤与相对 SPY 表现",
    sources: "Yahoo / Nasdaq 行情",
    scope: "个股与 ETF · 约 1 次 AI 调用",
    icon: ActivityIcon,
  },
  {
    id: "fundamentals",
    title: "基本面 / ETF 结构",
    description: "个股财务估值；ETF 费用、规模与基金结构",
    sources: "Yahoo Finance / Nasdaq",
    scope: "按资产类型自动切换 · 约 1 次 AI 调用",
    icon: Building2Icon,
  },
  {
    id: "news",
    title: "标的新闻",
    description: "公司事件、行业催化剂与主要新闻风险",
    sources: "Yahoo News",
    scope: "保存标题、短摘要与链接 · 约 1 次 AI 调用",
    icon: NewspaperIcon,
  },
  {
    id: "social",
    title: "社交情绪",
    description: "样本情绪、讨论热度与观点分歧",
    sources: "StockTwits / Reddit / Hacker News",
    scope: "仅当前日期 · 约 1 次 AI 调用",
    icon: MessagesSquareIcon,
  },
  {
    id: "macro",
    title: "宏观事件",
    description: "利率、通胀、就业、宏观新闻与事件概率",
    sources: "FRED / Yahoo / Polymarket",
    scope: "历史日期排除当前预测市场 · 约 1 次 AI 调用",
    icon: LandmarkIcon,
  },
];

const ROLE_NAMES: Record<string, string> = {
  analyst_technical: "技术分析师",
  analyst_fundamentals: "基本面 / ETF 结构分析师",
  analyst_news: "新闻分析师",
  analyst_social: "社交情绪分析师",
  analyst_macro: "宏观事件分析师",
  bull: "多头研究员",
  bear: "空头研究员",
  research_manager: "研究经理",
  trader: "交易方案",
  risk_aggressive: "进取风险研究员",
  risk_neutral: "中性风险研究员",
  risk_conservative: "保守风险研究员",
  portfolio_manager: "组合研究经理",
};

export function QuantAnalysisView() {
  const queryClient = useQueryClient();
  const { derivedPositions, storageStatus } = useTradingData();
  const today = localTodayIso();
  const [ticker, setTicker] = React.useState("AAPL");
  const [analysisDate, setAnalysisDate] = React.useState(localTodayIso);
  const [mode, setMode] = React.useState<QuantAnalysisMode>("quick");
  const [analysts, setAnalysts] = React.useState<QuantAnalyst[]>(["technical"]);
  const [reflectionEnabled, setReflectionEnabled] = React.useState(false);
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null);
  const [dateNotice, setDateNotice] = React.useState("");
  const historical = Boolean(analysisDate && analysisDate < today);

  const runsQuery = useQuery({
    queryKey: ["quant-analysis-runs"],
    queryFn: fetchQuantAnalysisRuns,
    refetchInterval: (query) => {
      const runs = query.state.data ?? [];
      return runs.some((run) => ACTIVE_STATUSES.has(run.status)) ? 2_000 : false;
    },
  });
  const effectiveSelectedRunId = selectedRunId ?? runsQuery.data?.[0]?.id ?? null;

  const runQuery = useQuery({
    queryKey: ["quant-analysis-run", effectiveSelectedRunId],
    queryFn: () => fetchQuantAnalysisRun(effectiveSelectedRunId ?? ""),
    enabled: Boolean(effectiveSelectedRunId),
    refetchInterval: (query) =>
      query.state.data && ACTIVE_STATUSES.has(query.state.data.status)
        ? 2_000
        : false,
  });
  const selectedRun =
    runQuery.data ??
    runsQuery.data?.find((run) => run.id === effectiveSelectedRunId) ??
    null;
  const selectedPosition = derivedPositions.find(
    (position) => position.ticker === selectedRun?.ticker && position.shares > 0
  );
  const quotesQuery = useQuotesQuery(
    selectedPosition && selectedRun ? [selectedRun.ticker] : []
  );
  const selectedQuote = quotesQuery.data?.find(
    (quote) =>
      quote.ticker === selectedRun?.ticker && quote.source !== "sample"
  );
  const holdingConclusion =
    selectedRun?.finalResult &&
    storageStatus !== "loading" &&
    !(selectedPosition && quotesQuery.isPending)
      ? buildHoldingConclusion({
          ticker: selectedRun.ticker,
          effectiveDate: selectedRun.effectiveDate,
          rating: selectedRun.finalResult.rating,
          position: selectedPosition,
          latestPrice: selectedQuote?.price,
        })
      : null;

  const updateRunCaches = React.useCallback(
    (run: QuantAnalysisRun) => {
      queryClient.setQueryData(["quant-analysis-run", run.id], run);
      queryClient.invalidateQueries({ queryKey: ["quant-analysis-runs"] });
    },
    [queryClient]
  );
  const createMutation = useMutation({
    mutationFn: createQuantAnalysisRun,
    onSuccess: (run) => {
      setSelectedRunId(run.id);
      updateRunCaches(run);
      setDateNotice(
        run.dateAdjusted
          ? `所选日期已归一到最近交易日 ${run.effectiveDate}。`
          : ""
      );
      toast.success(run.reused ? "已载入相同配置的历史结果" : "量化分析任务已创建");
    },
    onError: (error) => toast.error(error.message),
  });
  const cancelMutation = useMutation({
    mutationFn: cancelQuantAnalysisRun,
    onSuccess: updateRunCaches,
    onError: (error) => toast.error(error.message),
  });
  const resumeMutation = useMutation({
    mutationFn: resumeQuantAnalysisRun,
    onSuccess: (run) => {
      updateRunCaches(run);
      toast.success("任务已进入继续队列");
    },
    onError: (error) => toast.error(error.message),
  });
  const reflectionMutation = useMutation({
    mutationFn: createQuantAnalysisReflection,
    onSuccess: (run) => {
      updateRunCaches(run);
      toast.success("结果反思已生成");
    },
    onError: (error) => toast.error(error.message),
  });
  const deleteMutation = useMutation({
    mutationFn: deleteQuantAnalysisRun,
    onSuccess: ({ id }) => {
      const runs = queryClient.getQueryData<QuantAnalysisRun[]>([
        "quant-analysis-runs",
      ]) ?? [];
      const remainingRuns = runs.filter((run) => run.id !== id);
      queryClient.setQueryData(["quant-analysis-runs"], remainingRuns);
      queryClient.removeQueries({ queryKey: ["quant-analysis-run", id], exact: true });
      setSelectedRunId((current) =>
        current === id ? remainingRuns[0]?.id ?? null : current
      );
      void queryClient.invalidateQueries({ queryKey: ["quant-analysis-runs"] });
      toast.success("历史记录已删除");
    },
    onError: (error) => toast.error(error.message),
  });

  const submit = (input?: Partial<CreateQuantAnalysisRunInput>) => {
    createMutation.mutate({
      ticker: input?.ticker ?? ticker,
      analysisDate: input?.analysisDate ?? analysisDate,
      mode: input?.mode ?? mode,
      analysts: input?.analysts ?? analysts,
      reflectionEnabled: input?.reflectionEnabled ?? reflectionEnabled,
      forceRegenerate: input?.forceRegenerate ?? false,
    });
  };
  const groupedRuns = groupAnalysisRuns(runsQuery.data ?? []);
  const estimatedCalls = estimateAnalysisCalls(mode, analysts);

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b pb-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BrainCircuitIcon className="size-5" />
            <h1 className="text-xl font-semibold">量化分析</h1>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            公开市场事实、多空研判与风险复核
          </p>
        </div>
        <Badge variant="outline">研究辅助 · 不自动交易</Badge>
      </header>

      <section className="grid gap-4 border-b bg-muted/20 px-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto]">
        <FieldGroup className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field>
            <FieldLabel htmlFor="quant-ticker">美股 / ETF 代码</FieldLabel>
            <Input
              id="quant-ticker"
              className="uppercase"
              maxLength={15}
              value={ticker}
              onChange={(event) => setTicker(event.target.value.toUpperCase())}
              placeholder="AAPL"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="quant-date">分析日期</FieldLabel>
            <Input
              id="quant-date"
              type="date"
              max={today}
              value={analysisDate}
              onChange={(event) => {
                const nextDate = event.target.value;
                setAnalysisDate(nextDate);
                setAnalysts((current) =>
                  normalizeAnalystsForDate(current, nextDate, today)
                );
              }}
            />
          </Field>
          <Field>
            <FieldLabel>研究深度</FieldLabel>
            <ToggleGroup
              value={[mode]}
              onValueChange={(value) => {
                const next = Array.isArray(value) ? value[0] : value;
                if (next === "quick" || next === "deep") setMode(next);
              }}
              variant="outline"
              spacing={0}
            >
              <ToggleGroupItem value="quick">快速 · 1 轮</ToggleGroupItem>
              <ToggleGroupItem value="deep">深度 · 3 轮</ToggleGroupItem>
            </ToggleGroup>
          </Field>
          <Field orientation="horizontal" className="self-end rounded-lg border p-3">
            <Switch
              checked={reflectionEnabled}
              onCheckedChange={setReflectionEnabled}
              aria-label="启用结果反思"
            />
            <FieldContent>
              <FieldTitle>启用结果反思</FieldTitle>
              <FieldDescription>第 5 个后续交易日后可手动生成</FieldDescription>
            </FieldContent>
          </Field>
        </FieldGroup>
        <div className="flex min-w-44 flex-col justify-end gap-2">
          <div className="text-sm text-muted-foreground">
            预计 AI 调用 <span className="font-medium text-foreground">{estimatedCalls}</span> 次
          </div>
          <Button
            onClick={() => submit()}
            disabled={
              createMutation.isPending || !ticker.trim() || !analysisDate || !analysts.length
            }
          >
            {createMutation.isPending ? (
              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
            ) : (
              <PlayIcon data-icon="inline-start" />
            )}
            {createMutation.isPending ? "创建中" : "开始分析"}
          </Button>
        </div>
      </section>

      {historical ? (
        <Alert>
          <CalendarDaysIcon />
          <AlertTitle>历史时点保护已启用</AlertTitle>
          <AlertDescription>
            历史日期不使用当前社交情绪；宏观分析中的当前 Polymarket 已排除。
          </AlertDescription>
        </Alert>
      ) : null}
      {dateNotice ? (
        <Alert>
          <Clock3Icon />
          <AlertTitle>交易日期已调整</AlertTitle>
          <AlertDescription>{dateNotice}</AlertDescription>
        </Alert>
      ) : null}

      <section aria-labelledby="analyst-heading" className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="analyst-heading" className="text-base font-medium">分析师</h2>
            <p className="text-sm text-muted-foreground">至少选择一项公开数据研究</p>
          </div>
          <Badge variant={analysts.length ? "secondary" : "destructive"}>
            已选 {analysts.length} / {ANALYSTS.length}
          </Badge>
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
          {ANALYSTS.map((analyst) => {
            const disabled = analyst.id === "social" && historical;
            const checked = analysts.includes(analyst.id);
            return (
              <Card key={analyst.id} size="sm" className={disabled ? "opacity-60" : ""}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <analyst.icon className="size-4" />
                    {analyst.title}
                  </CardTitle>
                  <CardDescription>{analyst.description}</CardDescription>
                  <CardAction>
                    <Switch
                      size="sm"
                      checked={checked}
                      disabled={disabled}
                      aria-label={`选择${analyst.title}`}
                      onCheckedChange={(nextChecked) =>
                        setAnalysts((current) =>
                          nextChecked
                            ? Array.from(new Set([...current, analyst.id]))
                            : current.filter((item) => item !== analyst.id)
                        )
                      }
                    />
                  </CardAction>
                </CardHeader>
                <CardContent className="grid gap-2 text-xs text-muted-foreground">
                  <div>{analyst.sources}</div>
                  <div>{analyst.scope}</div>
                  {disabled ? <div className="text-destructive">历史日期不可用</div> : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="grid min-w-0 gap-4">
          {selectedRun ? (
            <RunWorkspace
              run={selectedRun}
              holdingConclusion={holdingConclusion}
              onCancel={() => cancelMutation.mutate(selectedRun.id)}
              onResume={() => resumeMutation.mutate(selectedRun.id)}
              onRegenerate={() =>
                submit({
                  ticker: selectedRun.ticker,
                  analysisDate: selectedRun.requestedDate,
                  mode: selectedRun.mode,
                  analysts: selectedRun.analysts,
                  reflectionEnabled: selectedRun.reflectionEnabled,
                  forceRegenerate: true,
                })
              }
              onReflect={() => reflectionMutation.mutate(selectedRun.id)}
              actionPending={
                cancelMutation.isPending ||
                resumeMutation.isPending ||
                reflectionMutation.isPending ||
                createMutation.isPending
              }
            />
          ) : runsQuery.isLoading ? (
            <RunSkeleton />
          ) : (
            <EmptyRun />
          )}
        </main>
        <aside className="grid gap-3 xl:sticky xl:top-20">
          <div className="flex items-center gap-2">
            <HistoryIcon className="size-4" />
            <h2 className="text-base font-medium">历史记录</h2>
          </div>
          {groupedRuns.length ? (
            groupedRuns.map((group) => (
              <Card key={group.key} size="sm">
                <CardHeader>
                  <CardTitle>{group.ticker}</CardTitle>
                  <CardDescription>{group.effectiveDate}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-2">
                  {group.runs.map((run) => (
                    <div key={run.id} className="relative">
                      <Button
                        variant={run.id === effectiveSelectedRunId ? "secondary" : "ghost"}
                        className="h-auto w-full justify-between px-2 py-2 pr-11"
                        onClick={() => setSelectedRunId(run.id)}
                      >
                        <span>版本 {run.version} · {run.mode === "deep" ? "深度" : "快速"}</span>
                        <StatusBadge status={run.status} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="absolute right-1 top-1 text-muted-foreground hover:text-destructive"
                        aria-label={`删除 ${run.ticker} ${run.effectiveDate} 版本 ${run.version}`}
                        title="删除历史记录"
                        disabled={deleteMutation.isPending}
                        onClick={() => deleteMutation.mutate(run.id)}
                      >
                        {deleteMutation.isPending && deleteMutation.variables === run.id ? (
                          <LoaderCircleIcon className="animate-spin" />
                        ) : (
                          <Trash2Icon />
                        )}
                      </Button>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">暂无本地报告。</p>
          )}
        </aside>
      </div>
    </div>
  );
}

function RunWorkspace({
  run,
  holdingConclusion,
  onCancel,
  onResume,
  onRegenerate,
  onReflect,
  actionPending,
}: {
  run: QuantAnalysisRun;
  holdingConclusion: HoldingConclusion | null;
  onCancel: () => void;
  onResume: () => void;
  onRegenerate: () => void;
  onReflect: () => void;
  actionPending: boolean;
}) {
  const active = ACTIVE_STATUSES.has(run.status);
  const completedSteps = run.steps.filter((step) =>
    ["completed", "disabled", "sample", "unavailable"].includes(step.status)
  ).length;
  const debateSteps = run.steps.filter((step) =>
    ["bull", "bear", "research_manager"].includes(step.role)
  );
  const riskSteps = run.steps.filter((step) =>
    [
      "trader",
      "risk_aggressive",
      "risk_neutral",
      "risk_conservative",
      "portfolio_manager",
    ].includes(step.role)
  );

  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b pb-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{run.ticker}</h2>
            <Badge variant="outline">{run.assetType || "解析中"}</Badge>
            <StatusBadge status={run.status} />
          </div>
          <div className="mt-1 grid gap-0.5 text-sm text-muted-foreground">
            <span>{run.effectiveDate} · 版本 {run.version}</span>
            <span>复杂：{run.complexModel || run.model || "未记录"}</span>
            <span>简单：{run.simpleModel || run.model || "未记录"}</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {active ? (
            <Button variant="outline" size="sm" onClick={onCancel} disabled={actionPending}>
              <SquareIcon data-icon="inline-start" />
              取消
            </Button>
          ) : null}
          {run.status === "interrupted" ? (
            <Button size="sm" onClick={onResume} disabled={actionPending}>
              <RotateCcwIcon data-icon="inline-start" />
              继续
            </Button>
          ) : null}
          {run.status === "completed" ? (
            <Button variant="outline" size="sm" onClick={onRegenerate} disabled={actionPending}>
              <RefreshCwIcon data-icon="inline-start" />
              重新生成
            </Button>
          ) : null}
          {run.reflectionEnabled && run.reflectionEligible && !run.reflection ? (
            <Button size="sm" onClick={onReflect} disabled={actionPending}>
              <BrainCircuitIcon data-icon="inline-start" />
              生成反思
            </Button>
          ) : null}
        </div>
      </div>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="flex items-center justify-between gap-3">
            <span>任务进度</span>
            <span className="tabular-nums">{run.progress}%</span>
          </CardTitle>
          <CardDescription>
            当前角色：{stageName(run.currentStage)} · 已完成 {completedSteps} 个阶段
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-primary transition-[width]"
              style={{ width: `${Math.max(0, Math.min(100, run.progress))}%` }}
            />
          </div>
          {run.errorMessage ? (
            <Alert variant="destructive">
              <ShieldAlertIcon />
              <AlertTitle>{run.errorCode || "任务异常"}</AlertTitle>
              <AlertDescription>{run.errorMessage}</AlertDescription>
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      {run.finalResult ? (
        <FinalSummary
          result={run.finalResult}
          holdingConclusion={holdingConclusion}
        />
      ) : null}
      <DataQuality run={run} />
      <StageTimeline run={run} />

      <Tabs defaultValue="final" className="min-w-0">
        <div className="overflow-x-auto pb-1">
          <TabsList variant="line" className="min-w-max">
            <TabsTrigger value="final">最终结论</TabsTrigger>
            <TabsTrigger value="technical">技术</TabsTrigger>
            <TabsTrigger value="fundamentals">基本面 / ETF</TabsTrigger>
            <TabsTrigger value="news">新闻</TabsTrigger>
            <TabsTrigger value="social">社交</TabsTrigger>
            <TabsTrigger value="macro">宏观</TabsTrigger>
            <TabsTrigger value="debate">多空</TabsTrigger>
            <TabsTrigger value="risk">风险</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="final" className="pt-3">
          <ReportCollection
            steps={run.steps.filter((step) =>
              ["research_manager", "trader", "portfolio_manager"].includes(step.role)
            )}
            empty="最终结论尚未生成。"
          />
          {run.reflection ? <ReflectionPanel run={run} /> : null}
        </TabsContent>
        {(["technical", "fundamentals", "news", "social", "macro"] as QuantAnalyst[]).map(
          (analyst) => (
            <TabsContent key={analyst} value={analyst} className="pt-3">
              <ReportCollection
                steps={run.steps.filter((step) => step.stepKey === `analyst:${analyst}`)}
                empty="该分析师尚无报告。"
              />
            </TabsContent>
          )
        )}
        <TabsContent value="debate" className="pt-3">
          <ReportCollection steps={debateSteps} empty="多空讨论尚未开始。" />
        </TabsContent>
        <TabsContent value="risk" className="pt-3">
          <ReportCollection steps={riskSteps} empty="风险复核尚未开始。" />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function FinalSummary({
  result,
  holdingConclusion,
}: {
  result: QuantFinalResult;
  holdingConclusion: HoldingConclusion | null;
}) {
  const rating = result.rating ?? "待定";
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex flex-wrap items-center gap-2">
          <span>最终研究结论</span>
          <Badge variant={ratingVariant(rating)}>{rating}</Badge>
        </CardTitle>
        <CardDescription>{result.summary || "暂无摘要"}</CardDescription>
        <CardAction>
          <span className="text-sm font-medium tabular-nums">
            {typeof result.confidence === "number" ? `${result.confidence}%` : "--"}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        {holdingConclusion ? (
          <Alert className="md:col-span-2">
            <WalletCardsIcon />
            <AlertTitle>结合当前持仓</AlertTitle>
            <AlertDescription className="grid gap-1">
              <p>{holdingConclusion.positionSummary}</p>
              <p className="font-medium text-foreground">
                {holdingConclusion.decisionSummary}
              </p>
            </AlertDescription>
          </Alert>
        ) : null}
        <ResultList title="核心证据" items={result.evidence} />
        <ResultList title="主要风险" items={result.risks} />
        <div>
          <div className="text-xs text-muted-foreground">目标价</div>
          <div className="mt-1 font-medium tabular-nums">
            {typeof result.targetPrice === "number" ? result.targetPrice.toFixed(2) : "未提供"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">时间周期</div>
          <div className="mt-1 font-medium">{result.timeHorizon || "未确定"}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function DataQuality({ run }: { run: QuantAnalysisRun }) {
  const analystSteps = run.steps.filter((step) => step.stepKey.startsWith("analyst:"));
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>数据质量</CardTitle>
        <CardDescription>sample 仅用于界面预览，不会进入 AI 决策链</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2">
        {run.analysts.map((analyst) => {
          const step = analystSteps.find((item) => item.stepKey === `analyst:${analyst}`);
          return (
            <Badge key={analyst} variant={step?.status === "completed" ? "secondary" : "outline"}>
              {analystName(analyst)} · {step ? stepStatusName(step.status) : "等待"}
            </Badge>
          );
        })}
      </CardContent>
    </Card>
  );
}

function StageTimeline({ run }: { run: QuantAnalysisRun }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>阶段时间线</CardTitle>
        <CardDescription>{run.mode === "deep" ? "3 轮多空与风险讨论" : "1 轮多空与风险讨论"}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {run.steps.length ? (
          run.steps.map((step) => (
            <div key={step.stepKey} className="flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2">
              <StepStatusIcon status={step.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{ROLE_NAMES[step.role] ?? step.role}</div>
                <div className="text-xs text-muted-foreground">
                  {stepStatusName(step.status)}
                  {step.durationMs ? ` · ${(step.durationMs / 1000).toFixed(1)}s` : ""}
                </div>
                {step.model ? (
                  <div className="truncate text-xs text-muted-foreground">{step.model}</div>
                ) : null}
              </div>
            </div>
          ))
        ) : (
          <div className="text-sm text-muted-foreground">任务进入运行队列后显示阶段。</div>
        )}
      </CardContent>
    </Card>
  );
}

function ReportCollection({
  steps,
  empty,
}: {
  steps: QuantAnalysisStep[];
  empty: string;
}) {
  if (!steps.length) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return (
    <div className="grid gap-3">
      {steps.map((step) => (
        <StepReport key={step.stepKey} step={step} />
      ))}
    </div>
  );
}

function StepReport({ step }: { step: QuantAnalysisStep }) {
  const output = step.output ?? {};
  const summary = typeof output.summary === "string" ? output.summary : "";
  const evidence = stringArray(output.evidence);
  const risks = stringArray(output.risks);
  const limitations = stringArray(output.dataLimitations);
  const reason = typeof output.reason === "string" ? output.reason : step.errorMessage;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{ROLE_NAMES[step.role] ?? step.role}</CardTitle>
        <CardDescription>
          {summary || reason || stepStatusName(step.status)}
          {step.model ? ` · ${step.model}` : ""}
        </CardDescription>
        <CardAction><StatusBadge status={step.status} /></CardAction>
      </CardHeader>
      <CardContent className="grid gap-3">
        {evidence.length ? <ResultList title="证据" items={evidence} /> : null}
        {risks.length ? <ResultList title="风险" items={risks} /> : null}
        {limitations.length ? <ResultList title="数据限制" items={limitations} /> : null}
        {step.dataSources.length ? (
          <div className="flex flex-wrap gap-2">
            {step.dataSources.map((source, index) =>
              source.url ? (
                <Button
                  key={`${source.name}-${index}`}
                  variant="link"
                  size="xs"
                  nativeButton={false}
                  render={<a href={source.url} target="_blank" rel="noreferrer" />}
                >
                  {source.name}
                </Button>
              ) : (
                <Badge key={`${source.name}-${index}`} variant="outline">{source.name}</Badge>
              )
            )}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ReflectionPanel({ run }: { run: QuantAnalysisRun }) {
  const performance = run.reflection?.performance;
  const review = run.reflection?.review ?? {};
  return (
    <Card size="sm" className="mt-3">
      <CardHeader>
        <CardTitle>五日结果反思</CardTitle>
        <CardDescription>{performance?.startDate} 至 {performance?.endDate}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-3">
        <Metric label={`${run.ticker} 收益`} value={performance?.tickerReturnPct} />
        <Metric label="SPY 收益" value={performance?.spyReturnPct} />
        <Metric label="超额收益" value={performance?.excessReturnPct} />
        <div className="sm:col-span-3">
          <ResultList title="有效依据" items={stringArray(review.validEvidence)} />
          <ResultList title="失效依据" items={stringArray(review.invalidEvidence)} />
          <ResultList title="下次改进" items={stringArray(review.improvements)} />
        </div>
      </CardContent>
    </Card>
  );
}

function ResultList({ title, items }: { title: string; items?: string[] }) {
  const values = items ?? [];
  return (
    <div>
      <div className="text-xs font-medium text-muted-foreground">{title}</div>
      {values.length ? (
        <ul className="mt-2 grid list-disc gap-1 pl-4 text-sm">
          {values.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
        </ul>
      ) : (
        <div className="mt-1 text-sm text-muted-foreground">暂无</div>
      )}
    </div>
  );
}

function Metric({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-base font-medium tabular-nums">
        {typeof value === "number" ? `${value.toFixed(2)}%` : "--"}
      </div>
    </div>
  );
}

function EmptyRun() {
  return (
    <div className="grid min-h-72 place-items-center border-y bg-muted/20 p-6 text-center">
      <div className="grid max-w-sm gap-2">
        <BrainCircuitIcon className="mx-auto size-7 text-muted-foreground" />
        <div className="font-medium">尚无量化分析报告</div>
        <div className="text-sm text-muted-foreground">选择分析师并开始首个任务。</div>
      </div>
    </div>
  );
}

function RunSkeleton() {
  return (
    <div className="grid gap-3">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "completed"
      ? "secondary"
      : status === "failed" || status === "interrupted"
        ? "destructive"
        : "outline";
  return <Badge variant={variant}>{stepStatusName(status)}</Badge>;
}

function StepStatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2Icon className="size-4 text-trade-buy" />;
  if (status === "running") return <LoaderCircleIcon className="size-4 animate-spin" />;
  if (status === "interrupted" || status === "failed") return <PauseCircleIcon className="size-4 text-destructive" />;
  if (["unavailable", "sample", "disabled"].includes(status)) return <BanIcon className="size-4 text-muted-foreground" />;
  return <CircleDotIcon className="size-4 text-muted-foreground" />;
}

function stepStatusName(status: string) {
  return {
    queued: "排队中",
    running: "运行中",
    cancel_requested: "正在停止",
    interrupted: "已中断",
    completed: "已完成",
    failed: "失败",
    canceled: "已取消",
    unavailable: "不可用",
    sample: "仅示例",
    disabled: "已禁用",
  }[status] ?? status;
}

function stageName(stage: string) {
  if (!stage) return "等待开始";
  if (stage === "completed") return "已完成";
  const analyst = stage.startsWith("analyst:") ? `analyst_${stage.split(":")[1]}` : "";
  if (analyst && ROLE_NAMES[analyst]) return ROLE_NAMES[analyst];
  if (stage.startsWith("debate:bull")) return ROLE_NAMES.bull;
  if (stage.startsWith("debate:bear")) return ROLE_NAMES.bear;
  if (stage.startsWith("risk:aggressive")) return ROLE_NAMES.risk_aggressive;
  if (stage.startsWith("risk:neutral")) return ROLE_NAMES.risk_neutral;
  if (stage.startsWith("risk:conservative")) return ROLE_NAMES.risk_conservative;
  return ROLE_NAMES[stage.replaceAll("-", "_")] ?? stage;
}

function analystName(analyst: QuantAnalyst) {
  return ANALYSTS.find((item) => item.id === analyst)?.title ?? analyst;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function ratingVariant(rating: string): "buy" | "sell" | "secondary" | "outline" {
  if (rating === "买入" || rating === "增持") return "buy";
  if (rating === "卖出" || rating === "减持") return "sell";
  return rating === "持有" ? "secondary" : "outline";
}
