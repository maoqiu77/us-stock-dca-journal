"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpenIcon, SquareIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { cancelAgentRun, errors, fetchAgentSources, type AgentEvidence, type AgentRun } from "./api";
import { runIsActive } from "./state";
import { indicatorObservationTime } from "./evidence";

const statuses: Record<AgentRun["status"], string> = { queued: "等待分析", running: "正在分析", succeeded: "分析完成",
  failed: "分析未完成", outcome_unknown: "结果待核验", cancel_requested: "正在取消", cancelled: "已取消" };
const tools: Record<string, string> = { read_portfolio_snapshot: "持仓", read_investment_policy: "投资计划",
  search_investment_memory: "个人原文", get_market_facts: "市场资料", get_price_series: "已收盘日线",
  calculate_indicators: "技术指标", calculate_portfolio_exposure: "组合集中度", get_news_and_fundamentals: "新闻与基本面" };
const kinds: Record<AgentEvidence["kind"], string> = { position: "持仓", policy: "投资计划", note: "手记",
  trade_reason: "交易理由", quote: "市场观察", series: "已收盘日线", calculation: "计算结果" };
const stances = { observe: "观察", maintain: "维持", conditional_change: "条件调整", insufficient_data: "资料不足" };
const date = (value: string | null) => value ? new Date(value).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" }) : "未知";

export function JournalRunPanel({ run, onRefresh }: { run: AgentRun; onRefresh: () => void }) {
  const [open, setOpen] = React.useState(false);
  const [selected, setSelected] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const sources = useQuery({ queryKey: ["ai-journal-sources", run.id, run.source_count],
    queryFn: () => fetchAgentSources(run.id), enabled: open || run.status === "succeeded" });
  const show = (ids: string[]) => { setSelected(ids); setOpen(true); };
  const cancel = async () => {
    setBusy(true); setError("");
    try { await cancelAgentRun(run.id); onRefresh(); }
    catch { setError("取消请求未能确认，请查询原任务。"); }
    finally { setBusy(false); }
  };
  return <section className="grid min-w-0 gap-3 border-t pt-3" aria-label="分析任务">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm" role="status">{statuses[run.status]}</span>
      <div className="flex items-center gap-1">
        <Button size="icon-sm" variant="ghost" title="查看来源" aria-label="查看来源" onClick={() => show([])}><BookOpenIcon /></Button>
        {runIsActive(run.status) ? <Button size="icon-sm" variant="ghost" disabled={busy} title="取消分析" aria-label="取消分析" onClick={() => void cancel()}><SquareIcon /></Button> : null}
      </div>
    </div>
    {run.events.length ? <ul className="grid gap-1 text-xs text-muted-foreground">{run.events.map((event, index) => <li key={index}>
      {tools[event.tool] ?? "资料核对"} · {event.status === "failed" ? "未完成" : event.status === "cached" ? "复用本轮结果" : event.source_count ? "已完成" : "无可用来源"} · {event.source_count} 项来源
    </li>)}</ul> : null}
    {run.error_code ? <p className="break-words text-xs text-destructive">{errors[run.error_code] ?? statuses[run.status]}</p> : null}
    {run.cancel_requested || run.status === "outcome_unknown" ? <p className="break-words text-xs text-muted-foreground">供应商可能仍在处理并计费，最终用量和费用待核验。</p> : null}
    {error ? <p className="text-xs text-destructive">{error}</p> : null}
    {run.result ? <div className="grid gap-3 text-sm">
      <p className="text-xs text-muted-foreground">{stances[run.result.stance]}</p>
      <p className="break-words leading-relaxed">{run.result.summary}</p>
      {([ ["依据", run.result.facts], ["判断", run.result.interpretations], ["风险", run.result.risks] ] as const).map(([title, rows]) => rows.length ? <div key={title} className="grid gap-1">
        <h4 className="text-sm font-medium">{title}</h4>
        {rows.map((row, index) => <p key={index} className="break-words leading-relaxed">{row.text}
          <Button size="icon-sm" variant="ghost" title="查看引用来源" aria-label="查看引用来源" onClick={() => show(row.source_ids)}><BookOpenIcon /></Button>
        </p>)}
      </div> : null)}
      {run.result.missing.length ? <div className="grid gap-1"><h4 className="text-sm font-medium">待确认</h4>{run.result.missing.map((item, index) => <p key={index} className="break-words text-muted-foreground">{item}</p>)}</div> : null}
      {run.result.next_questions.length ? <div className="grid gap-1"><h4 className="text-sm font-medium">进一步问题</h4>{run.result.next_questions.map((item, index) => <p key={index} className="break-words">{item}</p>)}</div> : null}
    </div> : null}
    {sources.data?.items.filter((source) => source.kind === "calculation").map((source) => <Calculation key={source.id} source={source} />)}
    <Sheet open={open} onOpenChange={setOpen}><SheetContent className="overflow-y-auto data-[side=right]:w-full data-[side=right]:sm:max-w-lg">
      <SheetHeader><SheetTitle>本轮来源</SheetTitle><SheetDescription>{run.source_count} 项 · {statuses[run.status]}</SheetDescription></SheetHeader>
      <div className="grid min-w-0 gap-4 p-4">
        {sources.isLoading ? <p className="text-sm">读取中</p> : null}
        {sources.error ? <p className="text-sm text-destructive">来源暂时无法读取。<Button variant="ghost" onClick={() => void sources.refetch()}>重新读取</Button></p> : null}
        {sources.data?.items.filter((source) => !selected.length || selected.includes(source.id)).map((source) => <article key={source.id} className="grid min-w-0 gap-2 border-b pb-4 text-sm">
          <h4 className="font-medium">{kinds[source.kind]}{source.payload.ticker || source.payload.instrument_key ? ` · ${String(source.payload.ticker ?? source.payload.instrument_key)}` : ""}</h4>
          {source.original_deleted ? <p className="text-xs text-muted-foreground">原手记已删除，以下为本轮保存的引用副本。</p> : source.original_changed ? <p className="text-xs text-muted-foreground">原手记已修改，以下为本轮保存的原版本。</p> : null}
          <p className="text-xs text-muted-foreground">{source.kind === "calculation" && "ma5" in source.payload
            ? <>指标截至：{date(indicatorObservationTime(source.payload))}</>
            : <>观察 / 原文版本：{date(source.as_of)}</>}<br />本轮取得：{date(source.available_at)}</p>
          {source.kind === "note" || source.kind === "trade_reason" ? <p className="whitespace-pre-wrap break-words">{String(source.payload.body ?? source.payload.note ?? "")}</p> : <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(source.payload, null, 2)}</pre>}
          {source.input_source_ids.length ? <Button variant="ghost" className="justify-start" onClick={() => setSelected(source.input_source_ids)}><BookOpenIcon />计算输入来源</Button> : null}
        </article>)}
        {sources.data && !sources.data.items.length ? <p className="text-sm text-muted-foreground">本轮尚未取得来源。</p> : null}
      </div>
    </SheetContent></Sheet>
  </section>;
}

function Calculation({ source }: { source: AgentEvidence }) {
  const values = source.payload;
  const observedAt = indicatorObservationTime(values);
  if (!("ma5" in values)) return null;
  return <div className="grid grid-cols-3 gap-2" aria-label="技术指标">
    {["ma5", "ma20", "ma60"].map((key) => <div className="min-w-0 rounded-md border p-2" key={key}>
      <p className="text-xs text-muted-foreground">{key.toUpperCase()}</p><p className="break-all text-sm tabular-nums">{values[key] == null ? "—" : Number(values[key]).toLocaleString("zh-CN", { maximumFractionDigits: 4 })}</p>
    </div>)}
    <p className="col-span-3 break-words text-xs text-muted-foreground">{String(values.currency ?? "")} · {String(values.period ?? "")} · 截至 {date(observedAt)} · {String(values.adjustment ?? "")}</p>
  </div>;
}
