"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpIcon, FilePlusIcon, RotateCcwIcon, Trash2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { confirmJournal, deleteJournalNote, errors, fetchAgentCapabilities, fetchCapabilities,
  fetchContextOptions, fetchJournalNote, fetchJournalSession, previewJournal, recoverJournalSession,
  saveJournalNote, JournalRequestError, type JournalPreview, type JournalRequest, type JournalSession } from "./api";
import { conversationRequest, followUpRequest, runIsActive } from "./state";

export type JournalMode = JournalRequest["task_type"];
export type EmbeddedJournalHandle = { followUp: (question: string) => Promise<boolean> };
type Props = { prefillKey?: string; session: JournalSession | null;
  journalDate?: string; onSessionChange: (session: JournalSession | null) => void; onModeChange?: (mode: JournalMode | null) => void; onBusyChange?: (busy: boolean) => void };

export const EmbeddedJournalComposer = React.forwardRef<EmbeddedJournalHandle, Props>(function EmbeddedJournalComposer(
  { prefillKey, session, journalDate, onSessionChange, onBusyChange }, ref
) {
  const [draft, setDraft] = React.useState<JournalRequest>(() => conversationRequest(prefillKey ?? null));
  const [preview, setPreview] = React.useState<JournalPreview | null>(null);
  const [note, setNote] = React.useState("");
  const [noteId, setNoteId] = React.useState<string>();
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [pendingSnapshot, setPendingSnapshot] = React.useState<string | null>(null);
  const [awaitingConfirmation, setAwaitingConfirmation] = React.useState(false);
  const version = React.useRef(0);
  const sending = React.useRef(false);
  const initializedSession = React.useRef<string | null>(null);
  const restoring = React.useRef(false);
  const queryClient = useQueryClient();
  React.useEffect(() => { onBusyChange?.(busy); }, [busy, onBusyChange]);
  const acceptSession = React.useCallback(async (value: JournalSession) => {
    await queryClient.cancelQueries({ queryKey: ["ai-journal-session", value.id] });
    queryClient.setQueryData(["ai-journal-session", value.id], value);
    onSessionChange(value);
  }, [queryClient, onSessionChange]);
  const options = useQuery({ queryKey: ["ai-journal-context"], queryFn: fetchContextOptions });
  const agent = useQuery({ queryKey: ["ai-journal-agent-capabilities"], queryFn: fetchAgentCapabilities });
  const capability = useQuery({ queryKey: ["ai-journal-capabilities", draft.instrument_key],
    queryFn: ({ signal }) => fetchCapabilities(draft.instrument_key!, signal), enabled: Boolean(draft.instrument_key) });
  const active = session?.turns.some((turn) => turn.status === "pending" || runIsActive(turn.run?.status)) ?? false;
  const currentSession = useQuery({ queryKey: ["ai-journal-session", session?.id],
    queryFn: () => fetchJournalSession(session!.id), enabled: Boolean(session?.id),
    refetchInterval: active ? 1000 : false, refetchOnReconnect: true, refetchOnWindowFocus: true });

  React.useEffect(() => {
    if (currentSession.data) onSessionChange(currentSession.data);
  }, [currentSession.data, onSessionChange]);
  React.useEffect(() => {
    if (!session) {
      if (initializedSession.current) {
        version.current += 1;
        setDraft(conversationRequest()); setPreview(null);
      }
      initializedSession.current = null;
      return;
    }
    if (initializedSession.current === session.id) return;
    version.current += 1;
    initializedSession.current = session.id;
    const last = session.turns.at(-1);
    if (last) setDraft(followUpRequest(last.snapshot, session.id, last.id));
  }, [session]);
  React.useEffect(() => {
    if (!prefillKey) return;
    version.current += 1;
    onSessionChange(null);
    window.sessionStorage.removeItem("ai-journal-session");
    setDraft(conversationRequest(prefillKey));
    setPreview(null);
  }, [prefillKey, onSessionChange]);
  React.useEffect(() => {
    if (session || prefillKey || restoring.current) return;
    restoring.current = true;
    const restoreVersion = version.current;
    const pending = window.sessionStorage.getItem("ai-journal-pending-snapshot");
    const saved = window.sessionStorage.getItem("ai-journal-session");
    if (pending) {
      setPendingSnapshot(pending);
      void recoverJournalSession(pending).then((value) => {
        if (restoreVersion !== version.current) return;
        void acceptSession(value);
        window.sessionStorage.setItem("ai-journal-session", value.id);
        window.sessionStorage.removeItem("ai-journal-pending-snapshot");
        setPendingSnapshot(null);
      }).catch(() => setError("发送结果待核验，请查询原记录。"));
    } else if (saved) {
      void fetchJournalSession(saved).then((value) => {
        if (restoreVersion === version.current) void acceptSession(value);
      }).catch(() => setError("会话暂时无法读取。"));
    }
  }, [session, prefillKey, acceptSession]);

  const update = (patch: Partial<JournalRequest>) => {
    version.current += 1;
    setDraft((value) => ({ ...value, ...patch }));
    setPreview(null); setError("");
  };
  const submit = React.useCallback(async (question: string) => {
    if (!question.trim() || sending.current || active || pendingSnapshot) return false;
    sending.current = true; setBusy(true); setError("");
    const current = version.current;
    try {
      const last = session?.turns.filter((turn) => turn.status === "completed").at(-1);
      const request = { ...(session && last ? followUpRequest(last.snapshot, session.id, last.id) : draft),
        session_id: session?.id ?? draft.session_id,
        auto_context: true, memory_mode: "suggest_related" as const, reuse_snapshot_id: null,
        note_ids: draft.note_ids, trade_ids: draft.trade_ids,
        ...(session?.task_type === "conversation" ? { instrument_key: draft.instrument_key } : {}),
        question: question.trim(), memory_excluded_ids: draft.memory_excluded_ids ?? [],
        engine: draft.engine ?? (agent.data?.enabled ? "agent" : "llm") };
      const value = await previewJournal(request);
      if (current !== version.current) return false;
      setPreview(value);
      if (request.engine === "agent" && !value.agent_available) { setError(errors.agent_execution_not_ready); return false; }
      if (!value.ai_configured) { setError(errors.ai_not_configured); return false; }
      setPreview(value);
      setAwaitingConfirmation(true);
      return true;
    } catch (reason) {
      if (reason instanceof JournalRequestError && reason.status < 500) {
        window.sessionStorage.removeItem("ai-journal-pending-snapshot"); setPendingSnapshot(null);
      }
      setError(reason instanceof Error ? reason.message : "请求失败，请查询原记录。"); return false;
    }
    finally { sending.current = false; setBusy(false); }
  }, [active, pendingSnapshot, session, draft, agent.data?.enabled]);
  const confirmPreview = async () => {
    if (!preview || sending.current) return;
    sending.current = true; setBusy(true); setError(""); setAwaitingConfirmation(false);
    try {
      window.sessionStorage.setItem("ai-journal-pending-snapshot", preview.id);
      setPendingSnapshot(preview.id);
      const result = await confirmJournal(preview, crypto.randomUUID());
      window.sessionStorage.setItem("ai-journal-session", result.id);
      window.sessionStorage.removeItem("ai-journal-pending-snapshot"); setPendingSnapshot(null);
      await acceptSession(result);
      const failed = result.turns.find((turn) => turn.snapshot_id === preview.id && turn.status === "failed");
      if (failed) { setError(errors[failed.error_code] ?? "本轮未能完成。"); return; }
      setDraft((previous) => ({ ...previous, question: "" }));
    } catch (reason) {
      if (reason instanceof JournalRequestError && reason.status < 500) {
        window.sessionStorage.removeItem("ai-journal-pending-snapshot"); setPendingSnapshot(null);
      }
      setError(reason instanceof Error ? reason.message : "请求失败，请查询原记录。");
    }
    finally { sending.current = false; setBusy(false); }
  };
  React.useImperativeHandle(ref, () => ({ followUp: submit }), [submit]);
  const recover = async () => {
    if (!pendingSnapshot) return;
    setBusy(true);
    try {
      const value = await recoverJournalSession(pendingSnapshot);
      await acceptSession(value); window.sessionStorage.setItem("ai-journal-session", value.id);
      window.sessionStorage.removeItem("ai-journal-pending-snapshot"); setPendingSnapshot(null); setError("");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "记录暂时无法读取。"); }
    finally { setBusy(false); }
  };
  const newConversation = () => {
    restoring.current = true;
    version.current += 1; onSessionChange(null); setDraft(conversationRequest()); setPreview(null);
    setPendingSnapshot(null); setError("");
    window.sessionStorage.removeItem("ai-journal-session"); window.sessionStorage.removeItem("ai-journal-pending-snapshot");
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try { await saveJournalNote(note, noteId, journalDate); update({}); setNote(""); setNoteId(undefined); void options.refetch(); void queryClient.invalidateQueries({ queryKey: ["ai-journal-calendar"] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "手记保存失败"); }
    finally { setBusy(false); }
  };
  const editNote = async (id: string) => {
    try { const value = await fetchJournalNote(id); setNoteId(value.id); setNote(value.body); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "手记读取失败"); }
  };
  const deleteNote = async (id: string) => {
    setBusy(true);
    try { await deleteJournalNote(id); update({}); void options.refetch(); void queryClient.invalidateQueries({ queryKey: ["ai-journal-calendar"] }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "手记删除失败"); }
    finally { setBusy(false); }
  };
  return <div className="grid min-w-0 gap-3" data-testid="embedded-ai-journal">
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 break-words text-sm font-medium">{session?.title ?? "新对话"}</span>
      <Button size="sm" variant="ghost" disabled={busy || active || Boolean(pendingSnapshot)} onClick={newConversation}><FilePlusIcon />新建对话</Button>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Select value={draft.engine ?? (agent.data?.enabled ? "agent" : "llm")} disabled={busy || active}
        onValueChange={(value) => update({ engine: value as "llm" | "agent" })}>
        <SelectTrigger aria-label="分析方式" className="w-40"><SelectValue>{(draft.engine ?? (agent.data?.enabled ? "agent" : "llm")) === "agent" ? "自主研究" : "快速分析"}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value="llm">快速分析</SelectItem><SelectItem value="agent" disabled={!agent.data?.enabled}>自主研究{agent.data?.enabled ? "" : "（未启用）"}</SelectItem></SelectContent>
      </Select>
      {draft.instrument_key ? <span className="min-w-0 break-words text-xs">{capability.data?.instrument.name ?? draft.instrument_key}</span> : null}
      {draft.instrument_key ? <Button size="icon-sm" variant="ghost" title="清除标的" aria-label="清除标的" disabled={busy} onClick={() => update({ instrument_key: null })}><RotateCcwIcon /></Button> : null}
    </div>
    <p className="text-xs text-muted-foreground">{(draft.engine ?? (agent.data?.enabled ? "agent" : "llm")) === "agent"
      ? "自主研究：按问题查行情、阅读新闻原文，遇到疑点继续追查。"
      : "快速分析：根据本轮已取得的资料一次作答，适合快速解读和追问。"}</p>
    {!session ? <div className="flex flex-wrap gap-2">
      {["检查我的持仓，先告诉我最需要处理什么", "分析英伟达，结合近期新闻判断是否适合买入", "比较 SPY 和 QQQ，现在更适合关注哪个"].map((question) => <Button key={question} size="sm" variant="outline" className="h-auto whitespace-normal text-left" disabled={busy} onClick={() => update({ question })}>{question}</Button>)}
    </div> : null}
    <Textarea aria-label="AI 对话问题" value={draft.question} disabled={busy || active} maxLength={4000}
      onKeyDown={(event) => {
        if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
          event.preventDefault(); void submit(draft.question);
        }
      }}
      onChange={(event) => update({ question: event.target.value })} placeholder="例如：这只股票还能买吗？结合我的持仓，下一步该怎么做？" />
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground" role="status">{busy ? "正在核对资料并分析…" : active ? "正在自主研究，可在上方查看进度" : "自动结合持仓、相关手记与市场资料 · ⌘ / Ctrl + Enter 发送"}</span>
      <Button title="发送问题" aria-label="发送问题" disabled={!draft.question.trim() || busy || active || Boolean(pendingSnapshot) || awaitingConfirmation} onClick={() => void submit(draft.question)}><ArrowUpIcon />{busy || active ? "核对中" : "预览发送范围"}</Button>
    </div>
    {awaitingConfirmation && preview ? <div className="grid gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm"><p className="font-medium">请确认本轮发送范围</p><p>将发送 {preview.facts.length} 项市场事实和 {Object.keys(preview.private_context ?? {}).length} 类本地资料；排除项与未取得资料已在快照中标明。确认后才会调用模型。</p><div className="flex gap-2"><Button size="sm" onClick={() => void confirmPreview()}>确认发送</Button><Button size="sm" variant="outline" onClick={() => { setAwaitingConfirmation(false); setPreview(null); }}>取消</Button></div></div> : null}
    {pendingSnapshot ? <Button variant="outline" disabled={busy} onClick={() => void recover()}><RotateCcwIcon />查询原记录</Button> : null}
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    {!error && session?.turns.at(-1)?.status === "failed" && !session.turns.at(-1)?.run ? <p role="status" className="break-words text-sm text-destructive">{errors[session.turns.at(-1)!.error_code] ?? "本轮未能完成，问题与快照已保留。"}</p> : null}
    {currentSession.error ? <p className="text-xs text-destructive">连接中断，原任务已保留。<Button variant="ghost" size="icon-sm" title="重新连接" aria-label="重新连接" onClick={() => void currentSession.refetch()}><RotateCcwIcon /></Button></p> : null}
    {preview ? <details className="min-w-0 text-xs"><summary className="cursor-pointer text-muted-foreground">本轮数据快照</summary>
      <div className="grid gap-2 py-2"><p>{preview.model.provider} · {preview.model.model}</p><p>市场事实 {preview.facts.length} 项</p>
        {preview.missing.map((item) => <p className="break-words text-muted-foreground" key={item}>{item}</p>)}
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(preview.private_context, null, 2)}</pre>
      </div></details> : null}
    <details open className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium">投资手记</summary><div className="grid gap-2 py-3">
      <Textarea aria-label="投资手记" value={note} onChange={(event) => setNote(event.target.value)} placeholder="记录今天的观察" maxLength={12000} />
      <div className="flex flex-wrap gap-2"><Button size="sm" disabled={!note.trim() || busy} onClick={() => void saveNote()}>{noteId ? "保存修改" : "保存手记"}</Button>
        {noteId ? <Button size="sm" variant="outline" onClick={() => { setNoteId(undefined); setNote(""); }}>取消编辑</Button> : null}</div>
      {(options.data?.notes ?? []).slice(0, 10).map((item) => <div className="flex min-w-0 items-center gap-1" key={item.id}>
        <Button size="sm" variant="ghost" className="min-w-0 flex-1 justify-start truncate" onClick={() => void editNote(item.id)}>{item.label}</Button>
        <Button size="icon-sm" variant="ghost" title="删除手记" aria-label="删除手记" onClick={() => setDeleteId(item.id)}><Trash2Icon /></Button>
      </div>)}
    </div></details>
    <Dialog open={Boolean(deleteId)} onOpenChange={(open) => { if (!open) setDeleteId(null); }}><DialogContent>
      <DialogHeader><DialogTitle>删除这条手记？</DialogTitle><DialogDescription>已保存的 AI 快照仍会保留引用副本，原手记会标记为已删除。</DialogDescription></DialogHeader>
      <DialogFooter><Button variant="outline" onClick={() => setDeleteId(null)}>取消</Button><Button variant="destructive" onClick={() => { if (deleteId) void deleteNote(deleteId); setDeleteId(null); }}>确认删除</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>;
});
