"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { searchInstruments } from "../market-board/api";
import { useResource } from "../market-board/use-resource";
import type { ObservationMeta } from "../market-board/types";
import {
  confirmJournal,
  deleteJournalNote,
  errors,
  fetchCapabilities,
  fetchContextOptions,
  fetchJournalNote,
  fetchJournalSession,
  previewJournal,
  saveJournalNote,
  type Capabilities,
  type ContextOption,
  type JournalPreview,
  type JournalRequest,
  type JournalSession,
} from "./api";
import {
  canConfirm,
  emptyRequest,
  followUpRequest,
  toggleSelection,
} from "./state";

export type JournalMode = JournalRequest["task_type"];

export type EmbeddedJournalHandle = {
  followUp: (question: string) => Promise<boolean>;
};

type Props = {
  prefillKey?: string;
  session: JournalSession | null;
  onSessionChange: (session: JournalSession | null) => void;
  onModeChange?: (mode: JournalMode | null) => void;
};

export const EmbeddedJournalComposer = React.forwardRef<
  EmbeddedJournalHandle,
  Props
>(function EmbeddedJournalComposer(
  { prefillKey, session, onSessionChange, onModeChange },
  ref
) {
  const [mode, setMode] = React.useState<JournalMode | null>(null);
  const [draft, setDraft] = React.useState<JournalRequest>(() =>
    emptyRequest(prefillKey ?? null)
  );
  const [preview, setPreview] = React.useState<JournalPreview | null>(null);
  const [query, setQuery] = React.useState("");
  const [market, setMarket] = React.useState<"US" | "CN">("US");
  const [note, setNote] = React.useState("");
  const [noteId, setNoteId] = React.useState<string>();
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [clock, setClock] = React.useState(() => Date.now());
  const version = React.useRef(0);
  const idempotency = React.useRef("");

  const options = useQuery({
    queryKey: ["ai-journal-context"],
    queryFn: fetchContextOptions,
  });
  const capabilities = useQuery<Capabilities>({
    queryKey: ["ai-journal-capabilities", draft.instrument_key],
    queryFn: ({ signal }) => fetchCapabilities(draft.instrument_key!, signal),
    enabled: Boolean(draft.instrument_key),
  });
  const search = useResource(
    query + market,
    React.useCallback(
      (signal: AbortSignal) =>
        query.trim()
          ? searchInstruments(query, market, undefined, signal)
          : Promise.resolve({ items: [] }),
      [query, market]
    ),
    300
  );

  React.useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  React.useEffect(() => {
    if (prefillKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMode("instrument_research");
      setDraft(emptyRequest(prefillKey));
    }
  }, [prefillKey]);

  React.useEffect(() => {
    if (prefillKey || session) return;
    const saved = window.sessionStorage.getItem("ai-journal-session");
    if (!saved) return;
    void fetchJournalSession(saved)
      .then(onSessionChange)
      .catch(() => window.sessionStorage.removeItem("ai-journal-session"));
  }, [prefillKey, session, onSessionChange]);

  const update = (patch: Partial<JournalRequest>) => {
    version.current += 1;
    setDraft((value) => ({ ...value, ...patch }));
    setPreview(null);
    idempotency.current = "";
    setError("");
  };

  const chooseMode = (nextMode: JournalMode) => {
    version.current += 1;
    setMode(nextMode);
    onModeChange?.(nextMode);
    setDraft({
      ...emptyRequest(nextMode === "instrument_research" ? draft.instrument_key : null),
      task_type: nextMode,
    });
    setPreview(null);
    setError("");
    if (nextMode === "portfolio_review") {
      setQuery("");
    }
  };

  const chooseInstrument = (key: string) => {
    version.current += 1;
    setDraft({ ...emptyRequest(key), task_type: "instrument_research" });
    setPreview(null);
    setQuery("");
    setError("");
  };

  const runPreview = async (request: JournalRequest) => {
    const current = version.current;
    const value = await previewJournal(request);
    if (current === version.current) {
      setPreview(value);
      idempotency.current = crypto.randomUUID();
    }
    return value;
  };

  const confirm = async () => {
    if (!preview || !canConfirm(preview, draft, clock)) return;
    setBusy(true);
    setError("");
    try {
      const value = await confirmJournal(preview, idempotency.current);
      window.sessionStorage.setItem("ai-journal-session", value.id);
      onSessionChange(value);
      const failed = value.turns.find((turn) => turn.snapshot_id === preview.id && turn.status === "failed");
      if (failed) {
        setError(errors[failed.error_code] ?? "分析失败，请重试。");
        return;
      }
      setPreview(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "请求失败，请重试");
    } finally {
      setBusy(false);
    }
  };

  const followUp = React.useCallback(
    async (question: string) => {
      const last = session?.turns.filter((turn) => turn.status === "completed").at(-1);
      if (!last || !session || !question.trim()) return false;
      setBusy(true);
      setError("");
      try {
        const request = {
          ...followUpRequest(last.snapshot, session.id),
          question: question.trim(),
        };
        const nextPreview = await runPreview(request);
        const value = await confirmJournal(nextPreview, crypto.randomUUID());
        window.sessionStorage.setItem("ai-journal-session", value.id);
        onSessionChange(value);
        const failed = value.turns.find((turn) => turn.snapshot_id === nextPreview.id && turn.status === "failed");
        if (failed) {
          setError(errors[failed.error_code] ?? "分析失败，请重试。");
          return false;
        }
        setPreview(null);
        return true;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "请求失败，请重试");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [session, onSessionChange]
  );

  React.useImperativeHandle(ref, () => ({ followUp }), [followUp]);

  const pick = (
    field:
      | "position_tickers"
      | "note_ids"
      | "history_turn_ids",
    id: string
  ) => update({ [field]: toggleSelection(draft[field], id) });

  const saveNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try {
      await saveJournalNote(note, noteId);
      setNote("");
      setNoteId(undefined);
      void options.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "手记保存失败");
    } finally {
      setBusy(false);
    }
  };

  const editNote = async (id: string) => {
    try {
      const value = await fetchJournalNote(id);
      setNoteId(value.id);
      setNote(value.body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "手记读取失败");
    }
  };

  const deleteNote = async (id: string) => {
    setBusy(true);
    try {
      await deleteJournalNote(id);
      void options.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "手记删除失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-w-0 gap-3" data-testid="embedded-ai-journal">
      <div className="grid grid-cols-2 gap-2 sm:max-w-md">
        <Button
          variant={mode === "portfolio_review" ? "secondary" : "outline"}
          onClick={() => chooseMode("portfolio_review")}
        >
          持仓分析
        </Button>
        <Button
          variant={mode === "instrument_research" ? "secondary" : "outline"}
          onClick={() => chooseMode("instrument_research")}
        >
          标的快研
        </Button>
      </div>
      {mode ? (
        <div className="grid gap-3 rounded-lg border p-3">
          {mode === "instrument_research" ? (
            <>
              <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
                {(["US", "CN"] as const).map((value) => (
                  <Button
                    key={value}
                    size="sm"
                    variant={market === value ? "secondary" : "outline"}
                    onClick={() => setMarket(value)}
                  >
                    {value === "US" ? "美股" : "国内"}
                  </Button>
                ))}
              </div>
              <Input
                aria-label="快研搜索标的"
                placeholder="搜索名称或代码，选择明确身份"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {query ? (
                <div className="grid gap-1">
                  {search.data?.items.map((item) => (
                    <Button
                      key={item.key}
                      variant="outline"
                      className="h-auto justify-start whitespace-normal text-left"
                      onClick={() => chooseInstrument(item.key)}
                    >
                      {item.symbol} · {item.name} · {item.exchange} · {item.currency}
                    </Button>
                  ))}
                </div>
              ) : null}
              <p className="break-words text-sm">
                {capabilities.data
                  ? `${capabilities.data.instrument.name} · ${capabilities.data.instrument.symbol} · ${capabilities.data.instrument.exchange} · ${capabilities.data.instrument.currency}`
                  : draft.instrument_key ?? "尚未选择标的"}
              </p>
            </>
          ) : (
            <div className="grid gap-2 text-sm text-muted-foreground">
              <p>选择要纳入本轮的持仓和私有上下文，再生成事实预览。</p>
              <Choices
                title="实际持仓"
                items={(options.data?.positions ?? []).map((item) => ({
                  id: item.ticker,
                  label: `${item.ticker} · ${item.quantity} 股 · ${item.cost} ${item.currency}`,
                }))}
                selected={draft.position_tickers}
                onChange={(id) => pick("position_tickers", id)}
              />
              <Choices
                title="个人手记"
                items={options.data?.notes ?? []}
                selected={draft.note_ids}
                onChange={(id) => pick("note_ids", id)}
              />
              <Choices
                title="历史回答"
                items={options.data?.history ?? []}
                selected={draft.history_turn_ids}
                onChange={(id) => pick("history_turn_ids", id)}
              />
              {options.data?.excluded.map((item) => (
                <p className="text-xs" key={item.ticker}>
                  排除 {item.ticker}：{item.reason}
                </p>
              ))}
            </div>
          )}
          <Textarea
            value={draft.question}
            onChange={(event) => update({ question: event.target.value })}
            placeholder={mode === "portfolio_review" ? "例如：检查当前持仓的集中度和主要风险" : "输入一个明确的标的研究问题"}
            maxLength={4000}
          />
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={
                !draft.question.trim() ||
                busy ||
                (mode === "instrument_research" && !draft.instrument_key)
              }
              onClick={() => void runPreview(draft).catch((reason) => setError(reason instanceof Error ? reason.message : "预览失败，请重试"))}
            >
              生成事实预览
            </Button>
            {preview ? (
              <Button disabled={busy || !canConfirm(preview, draft, clock)} onClick={() => void confirm()}>
                确认范围并分析
              </Button>
            ) : null}
          </div>
          {preview ? <Snapshot snapshot={preview} /> : null}
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span>未选择的手记和历史回答不会发送。</span>
        {session ? <span>当前会话：{session.title}</span> : null}
      </div>
      <div className="grid gap-2 rounded-lg border p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">投资手记</span>
          <span className="text-xs text-muted-foreground">仅在预览中逐项选择后发送</span>
        </div>
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录今天的观察" maxLength={12000} />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={!note.trim() || busy} onClick={() => void saveNote()}>
            {noteId ? "保存手记修改" : "保存手记"}
          </Button>
          {noteId ? (
            <Button size="sm" variant="outline" onClick={() => { setNoteId(undefined); setNote(""); }}>
              取消编辑
            </Button>
          ) : null}
          {(options.data?.notes ?? []).slice(0, 3).map((item) => (
            <span className="inline-flex items-center gap-1" key={item.id}>
              <Button size="sm" variant="ghost" onClick={() => void editNote(item.id)}>{item.label}</Button>
              <Button size="sm" variant="ghost" onClick={() => setDeleteId(item.id)}>删除</Button>
            </span>
          ))}
        </div>
      </div>
      <Dialog open={Boolean(deleteId)} onOpenChange={(open) => { if (!open) setDeleteId(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除这条手记？</DialogTitle>
            <DialogDescription>已确认的 AI 快照仍会保留引用副本，并标记原手记已删除。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteId(null)}>取消</Button>
            <Button variant="destructive" onClick={() => { if (deleteId) void deleteNote(deleteId); setDeleteId(null); }}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
});

function Choices({
  title,
  items,
  selected,
  onChange,
}: {
  title: string;
  items: ContextOption[];
  selected: string[];
  onChange: (id: string) => void;
}) {
  return (
    <fieldset className="grid gap-1">
      <legend className="font-medium text-foreground">{title}</legend>
      {items.length ? items.map((item) => (
        <label className="flex items-start gap-2" key={item.id}>
          <input type="checkbox" checked={selected.includes(item.id)} onChange={() => onChange(item.id)} />
          <span className="min-w-0 break-words">{item.label}</span>
        </label>
      )) : <p>暂无可选内容</p>}
    </fieldset>
  );
}

function Snapshot({ snapshot }: { snapshot: JournalPreview }) {
  return (
    <div className="grid min-w-0 gap-2 rounded bg-muted/40 p-3 text-sm">
      <p>模型：{snapshot.model.provider} · {snapshot.model.model} · 有效至 {new Date(snapshot.expires_at).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</p>
      <p>问题：{snapshot.request.question} · 事实 {snapshot.facts.length} 项</p>
      {snapshot.facts.map((fact, index) => (
        <details key={index}>
          <summary>{fact.kind}</summary>
          <Metadata meta={fact.value.meta as ObservationMeta | undefined} />
          <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(fact.value, null, 2)}</pre>
        </details>
      ))}
      <p>将发送的私人内容：{Object.keys(snapshot.private_context).length ? JSON.stringify(snapshot.private_context) : "未选择"}</p>
      {snapshot.missing.map((item) => <p className="text-xs text-muted-foreground" key={item}>{item}</p>)}
    </div>
  );
}

function Metadata({ meta }: { meta?: ObservationMeta }) {
  if (!meta) return null;
  return <p className="text-xs text-muted-foreground">来源：{meta.source} · 状态：{meta.status} · 观察：{meta.fetched_at}</p>;
}
