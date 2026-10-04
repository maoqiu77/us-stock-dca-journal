"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BotIcon, CalendarDaysIcon, ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAiAdviceCalendarQuery, useAiSettingsQuery } from "@/features/platform/queries";
import { EmbeddedJournalComposer } from "@/features/ai-journal/embedded-composer";
import { JournalRunPanel } from "@/features/ai-journal/run-panel";
import { errors, fetchJournalCalendar, fetchJournalNote, fetchJournalSession, fetchNoteVersions,
  type CalendarEntry, type JournalNote, type JournalSession } from "@/features/ai-journal/api";
import { beijingDay, calendarCells, shiftMonth } from "@/features/ai-journal/calendar";
import { runIsActive } from "@/features/ai-journal/state";
import { SaveJudgmentButton } from "@/features/ai-journal/user-records-panel";

export function AiAdviceView() {
  const queryClient = useQueryClient();
  const today = beijingDay();
  const [selectedDate, setSelectedDate] = React.useState(() => readDateParam(today));
  const [month, setMonth] = React.useState(() => readDateParam(today).slice(0, 7));
  const [session, setSession] = React.useState<JournalSession | null>(null);
  const [prefillKey, setPrefillKey] = React.useState<string | undefined>(() => readInstrumentParam() ?? undefined);
  const [loadingId, setLoadingId] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [note, setNote] = React.useState<JournalNote | null>(null);
  const noteVersions = useQuery({ queryKey: ["ai-journal-note-versions", note?.id], queryFn: () => fetchNoteVersions(note!.id), enabled: Boolean(note) });
  const [sending, setSending] = React.useState(false);
  const selectionVersion = React.useRef(0);
  const end = React.useRef<HTMLDivElement>(null);
  const calendar = useQuery({ queryKey: ["ai-journal-calendar"], queryFn: fetchJournalCalendar });
  const legacy = useAiAdviceCalendarQuery(selectedDate);
  const settings = useAiSettingsQuery();
  const active = sending || (session?.turns.some((turn) => turn.status === "pending" || runIsActive(turn.run?.status)) ?? false);
  const ready = Boolean(settings.data?.hasApiKey && settings.data?.baseUrl && settings.data?.model);
  const savedDates = new Set([...(calendar.data?.dates ?? []), ...(legacy.data?.dates ?? [])]);
  // List a conversation once per day, while retaining its complete turn history.
  const entries = (calendar.data?.items ?? []).filter((entry) => entry.date === selectedDate)
    .filter((entry, index, all) => !entry.session_id || entry.kind !== "session" ||
      all.findIndex((other) => other.kind === "session" && other.session_id === entry.session_id) === index);
  const record = legacy.data?.record?.date === selectedDate ? legacy.data.record : null;

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session");
    if (sessionId) {
      void fetchJournalSession(sessionId).then(value => setSession(value)).catch(reason => setError(reason instanceof Error ? reason.message : "会话暂时无法读取。"));
    }
    const saved = window.localStorage.getItem("ai-journal-prefill-key");
    if (saved) {
      // Hydrate the browser-only handoff after mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPrefillKey(saved);
      window.localStorage.removeItem("ai-journal-prefill-key");
    }
    const onPrefill = (event: Event) => {
      setPrefillKey((event as CustomEvent<string>).detail);
      window.localStorage.removeItem("ai-journal-prefill-key");
    };
    window.addEventListener("ai-journal-prefill", onPrefill);
    return () => window.removeEventListener("ai-journal-prefill", onPrefill);
  }, []);

  const acceptSession = React.useCallback((value: JournalSession | null) => {
    setSession(value); setError("");
    const url = new URL(window.location.href);
    if (value) { url.searchParams.set("session", value.id); void queryClient.invalidateQueries({ queryKey: ["ai-journal-calendar"] }); }
    else url.searchParams.delete("session");
    window.history.replaceState({}, "", url);
  }, [queryClient]);

  const last = session?.turns.at(-1);
  React.useEffect(() => {
    const target = window.location.hash.startsWith("#turn-") ? document.getElementById(decodeURIComponent(window.location.hash.slice(1))) : null;
    (target ?? end.current)?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [session?.id, session?.turns.length, last?.answer, last?.run?.status]);

  const openEntry = async (entry: CalendarEntry) => {
    const version = ++selectionVersion.current;
    setLoadingId(entry.id); setError("");
    try {
      if (entry.kind === "note") {
        const value = await fetchJournalNote(entry.id);
        if (version === selectionVersion.current) setNote(value);
      } else if (entry.session_id) {
        const value = await fetchJournalSession(entry.session_id);
        if (version !== selectionVersion.current) return;
        window.sessionStorage.setItem("ai-journal-session", value.id);
        const url = new URL(window.location.href); url.searchParams.set("view", "ai"); url.searchParams.set("date", selectedDate); url.searchParams.set("session", value.id); window.history.replaceState({}, "", url);
        setSession(value);
      }
    } catch (reason) {
      if (version === selectionVersion.current) setError(reason instanceof Error ? reason.message : "记录暂时无法读取");
    } finally {
      if (version === selectionVersion.current) setLoadingId(null);
    }
  };

  const chooseDay = (day: string) => {
    selectionVersion.current += 1;
    setSelectedDate(day); setSession(null); setLoadingId(null); setError("");
    window.sessionStorage.removeItem("ai-journal-session");
    const url = new URL(window.location.href); url.searchParams.set("view", "ai"); url.searchParams.set("date", day); url.searchParams.delete("session"); window.history.replaceState({}, "", url);
  };

  return <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
    <Card className="min-w-0">
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2"><BotIcon className="size-5" />AI 投资助手 <Badge variant="secondary">{ready ? "已连接" : "待配置模型"}</Badge></CardTitle>
        <CardDescription>聊一只股票、检查持仓，或了解新闻对交易的影响。每次分析自动保存在右侧日历。</CardDescription>
      </CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        <div className="flex max-h-[60vh] min-h-60 flex-col gap-4 overflow-y-auto rounded-lg bg-muted/20 p-3" aria-label="投资助手对话" aria-live="polite">
          {!session ? <div className="m-auto max-w-lg py-8 text-center">
            <p className="text-lg font-medium">今天想研究什么？</p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">直接输入股票名称或代码，也可以问“我的持仓应该怎么调整”。我会先查资料，再用容易理解的话说明判断和下一步。</p>
          </div> : session.turns.map((turn) => <div key={turn.id} id={`turn-${turn.id}`} className="grid min-w-0 gap-3">
            <div className="ml-auto max-w-[90%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-sm text-primary-foreground">{turn.snapshot.request.question}</div>
            <div className="min-w-0 rounded-2xl rounded-bl-sm border bg-background p-4">
              {turn.run ? <JournalRunPanel run={turn.run} onRefresh={() => void queryClient.invalidateQueries({ queryKey: ["ai-journal-session", session.id] })} /> :
                turn.answer ? <div className="whitespace-pre-wrap break-words text-sm leading-7">{turn.answer}</div> :
                  <p className="text-sm text-muted-foreground">{turn.status === "failed" ? errors[turn.error_code] ?? "这次分析未完成，可以继续提问。" : "正在查阅资料并整理回答…"}</p>}
              {!turn.run && turn.snapshot.facts.some((fact) => fact.kind === "新闻") ? <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">本轮新闻来源</summary>
                <div className="grid gap-2 pt-2">{turn.snapshot.facts.filter((fact) => fact.kind === "新闻").map((fact, index) => <a key={index} href={String(fact.value.url)} target="_blank" rel="noreferrer" className="underline">{String(fact.value.title)} · {String(fact.value.publisher)} · {String(fact.value.published_at).slice(0, 10)}</a>)}</div>
              </details> : null}
              {turn.status === "completed" && (turn.answer || turn.run?.status === "succeeded") ? <SaveJudgmentButton turnId={turn.id} scope={session.instrument_key ?? "我的组合"} /> : null}
              <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer">原冻结快照</summary><p>观察记录时间：{turn.snapshot.created_at} · 快照 {turn.snapshot_id}</p><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify({ facts: turn.snapshot.facts, missing: turn.snapshot.missing }, null, 2)}</pre>{turn.deleted_note_ids.length ? <p>部分原手记已删除；旧快照仍保留当时证据，不再加入新上下文。</p> : null}</details>
            </div>
          </div>)}
          <div ref={end} />
        </div>
        <EmbeddedJournalComposer prefillKey={prefillKey} journalDate={selectedDate} session={session} onSessionChange={acceptSession} onBusyChange={setSending} />
        {!ready && !settings.isLoading ? <p className="text-sm text-muted-foreground">在「AI 模型配置」连接模型后即可开始对话，投资手记可以直接保存。</p> : null}
      </CardContent>
    </Card>
    <Card className="min-w-0">
      <CardHeader><CardTitle className="flex items-center gap-2"><CalendarDaysIcon className="size-4" />AI 分析日历</CardTitle><CardDescription>回看研究、继续对话和查阅手记</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center justify-between gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="上个月" onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeftIcon /></Button>
          <span className="text-sm font-medium">{month.replace("-", " 年 ")} 月</span>
          <Button variant="ghost" size="icon-sm" aria-label="下个月" onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRightIcon /></Button>
        </div>
        <div className="grid grid-cols-7 gap-1">
          {["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day} className="py-1 text-center text-xs text-muted-foreground">{day}</span>)}
          {calendarCells(month).map((day, index) => day ? <Button key={day} size="sm" variant={day === selectedDate ? "secondary" : "ghost"} className="relative h-9 min-w-0 px-0 tabular-nums" disabled={active}
            aria-pressed={day === selectedDate} aria-label={`${day}${savedDates.has(day) ? "，已有记录" : "，无记录"}`} onClick={() => chooseDay(day)}>
            {Number(day.slice(-2))}{savedDates.has(day) ? <span className="absolute bottom-1 size-1 rounded-full bg-primary" /> : null}
          </Button> : <span key={`empty-${index}`} />)}
        </div>
        <Button variant="outline" size="sm" disabled={active} onClick={() => { setMonth(today.slice(0, 7)); chooseDay(today); }}>回到今天</Button>
        <div className="grid gap-2 border-t pt-3">
          <p className="text-xs font-medium text-muted-foreground">{selectedDate} · {entries.length} 条记录</p>
          {calendar.isLoading ? <p className="text-sm text-muted-foreground">正在读取记录…</p> : null}
          {calendar.isError ? <Button variant="outline" onClick={() => void calendar.refetch()}>日历读取失败，点击重试</Button> : null}
          {entries.map((entry) => entry.kind === "legacy" ? null : <Button key={`${entry.kind}-${entry.id}`} variant="ghost" className="h-auto min-w-0 justify-start py-2 text-left" disabled={active || Boolean(loadingId) || (entry.kind !== "note" && !entry.session_id)} onClick={() => void openEntry(entry)}>
            <span className="grid min-w-0 gap-1"><span className="truncate">{entry.title}</span><span className="text-xs font-normal text-muted-foreground">{loadingId === entry.id ? "读取中…" : entry.kind === "note" ? "投资手记" : statusLabel(entry.status)}</span></span>
          </Button>)}
          {!entries.length && !calendar.isLoading ? <p className="text-sm text-muted-foreground">这一天还没有记录，可以直接开始新对话。</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        </div>
        {record ? <details className="border-t pt-3"><summary className="cursor-pointer text-sm">旧版分析与对话</summary><div className="grid max-h-96 gap-3 overflow-auto pt-3 text-sm leading-relaxed">
          <p className="whitespace-pre-wrap break-words">{record.content}</p>
          {record.messages.slice(1).map((message, index) => <p key={index} className="whitespace-pre-wrap break-words"><span className="font-medium">{message.role === "user" ? "你：" : "AI："}</span>{message.content}</p>)}
        </div></details> : null}
      </CardContent>
    </Card>
    <Dialog open={Boolean(note)} onOpenChange={(open) => { if (!open) setNote(null); }}><DialogContent className="max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>投资手记</DialogTitle></DialogHeader><p className="whitespace-pre-wrap break-words text-sm leading-7">{note?.body}</p><details><summary className="cursor-pointer text-sm">手记历史版本</summary>{noteVersions.isError ? <p role="alert">历史版本暂时无法读取。</p> : null}{noteVersions.data?.versions.map(version => <div key={version.version} className="my-2 rounded border p-2 text-sm"><p>v{version.version} · {version.recorded_at} · 归档 {version.journal_date ?? "创建日期"}</p><p className="whitespace-pre-wrap break-words">{version.body}</p></div>)}</details></DialogContent></Dialog>
  </div>;
}

function readDateParam(fallback: string) {
 if(typeof window==="undefined")return fallback;
 const value=new URLSearchParams(window.location.search).get("date");
 return value&&/^\d{4}-\d{2}-\d{2}$/.test(value)?value:fallback;
}
function readInstrumentParam() { return typeof window==="undefined"?null:new URLSearchParams(window.location.search).get("instrument"); }

function statusLabel(status?: string) {
  return ({ completed: "已完成 · 点击继续对话", pending: "分析中", failed: "未完成 · 点击查看", succeeded: "已完成" } as Record<string, string>)[status ?? ""] ?? "查看记录";
}
