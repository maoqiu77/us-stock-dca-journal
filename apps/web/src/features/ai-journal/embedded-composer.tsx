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
import { JournalRunPanel } from "./run-panel";

export type JournalMode = JournalRequest["task_type"];
export type EmbeddedJournalHandle = { followUp: (question: string) => Promise<boolean> };
type Props = { prefillKey?: string; session: JournalSession | null;
  onSessionChange: (session: JournalSession | null) => void; onModeChange?: (mode: JournalMode | null) => void };

export const EmbeddedJournalComposer = React.forwardRef<EmbeddedJournalHandle, Props>(function EmbeddedJournalComposer(
  { prefillKey, session, onSessionChange }, ref
) {
  const [draft, setDraft] = React.useState<JournalRequest>(() => conversationRequest(prefillKey ?? null));
  const [preview, setPreview] = React.useState<JournalPreview | null>(null);
  const [note, setNote] = React.useState("");
  const [noteId, setNoteId] = React.useState<string>();
  const [deleteId, setDeleteId] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [pendingSnapshot, setPendingSnapshot] = React.useState<string | null>(null);
  const version = React.useRef(0);
  const sending = React.useRef(false);
  const initializedSession = React.useRef<string | null>(null);
  const queryClient = useQueryClient();
  const acceptSession = React.useCallback(async (value: JournalSession) => {
    await queryClient.cancelQueries({ queryKey: ["ai-journal-session", value.id] });
    queryClient.setQueryData(["ai-journal-session", value.id], value);
    onSessionChange(value);
  }, [queryClient, onSessionChange]);
  const options = useQuery({ queryKey: ["ai-journal-context"], queryFn: fetchContextOptions });
  const agent = useQuery({ queryKey: ["ai-journal-agent-capabilities"], queryFn: fetchAgentCapabilities });
  const capability = useQuery({ queryKey: ["ai-journal-capabilities", draft.instrument_key],
    queryFn: ({ signal }) => fetchCapabilities(draft.instrument_key!, signal), enabled: Boolean(draft.instrument_key) });
  const active = session?.turns.some((turn) => runIsActive(turn.run?.status)) ?? false;
  const currentSession = useQuery({ queryKey: ["ai-journal-session", session?.id],
    queryFn: () => fetchJournalSession(session!.id), enabled: Boolean(session?.id),
    refetchInterval: active ? 1000 : false, refetchOnReconnect: true, refetchOnWindowFocus: true });

  React.useEffect(() => {
    if (currentSession.data) onSessionChange(currentSession.data);
  }, [currentSession.data, onSessionChange]);
  React.useEffect(() => {
    if (!session) { initializedSession.current = null; return; }
    if (initializedSession.current === session.id) return;
    initializedSession.current = session.id;
    const last = session.turns.at(-1);
    if (last) setDraft(followUpRequest(last.snapshot, session.id, last.id));
  }, [session]);
  React.useEffect(() => {
    if (!prefillKey) return;
    setDraft(conversationRequest(prefillKey));
    setPreview(null);
    version.current += 1;
  }, [prefillKey]);
  React.useEffect(() => {
    if (session || prefillKey) return;
    const pending = window.sessionStorage.getItem("ai-journal-pending-snapshot");
    const saved = window.sessionStorage.getItem("ai-journal-session");
    if (pending) {
      setPendingSnapshot(pending);
      void recoverJournalSession(pending).then((value) => {
        void acceptSession(value);
        window.sessionStorage.setItem("ai-journal-session", value.id);
        window.sessionStorage.removeItem("ai-journal-pending-snapshot");
        setPendingSnapshot(null);
      }).catch(() => setError("发送结果待核验，请查询原记录。"));
    } else if (saved) {
      void fetchJournalSession(saved).then(acceptSession).catch(() => setError("会话暂时无法读取。"));
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
        engine: draft.engine ?? last?.snapshot.request.engine ?? (agent.data?.enabled ? "agent" : "llm") };
      const value = await previewJournal(request);
      if (current !== version.current) return false;
      setPreview(value);
      if (request.engine === "agent" && !value.agent_available) { setError(errors.agent_execution_not_ready); return false; }
      if (!value.ai_configured) { setError(errors.ai_not_configured); return false; }
      window.sessionStorage.setItem("ai-journal-pending-snapshot", value.id);
      setPendingSnapshot(value.id);
      const result = await confirmJournal(value, crypto.randomUUID());
      window.sessionStorage.setItem("ai-journal-session", result.id);
      window.sessionStorage.removeItem("ai-journal-pending-snapshot"); setPendingSnapshot(null);
      await acceptSession(result);
      const failed = result.turns.find((turn) => turn.snapshot_id === value.id && turn.status === "failed");
      if (failed) { setError(errors[failed.error_code] ?? "本轮未能完成。"); return false; }
      setDraft((previous) => ({ ...previous, question: "" }));
      return true;
    } catch (reason) {
      if (reason instanceof JournalRequestError && reason.status < 500) {
        window.sessionStorage.removeItem("ai-journal-pending-snapshot"); setPendingSnapshot(null);
      }
      setError(reason instanceof Error ? reason.message : "请求失败，请查询原记录。"); return false;
    }
    finally { sending.current = false; setBusy(false); }
  }, [active, pendingSnapshot, session, draft, agent.data?.enabled, acceptSession]);
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
    version.current += 1; onSessionChange(null); setDraft(conversationRequest()); setPreview(null);
    setPendingSnapshot(null); setError("");
    window.sessionStorage.removeItem("ai-journal-session"); window.sessionStorage.removeItem("ai-journal-pending-snapshot");
  };
  const saveNote = async () => {
    if (!note.trim()) return;
    setBusy(true);
    try { await saveJournalNote(note, noteId); update({}); setNote(""); setNoteId(undefined); void options.refetch(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "手记保存失败"); }
    finally { setBusy(false); }
  };
  const editNote = async (id: string) => {
    try { const value = await fetchJournalNote(id); setNoteId(value.id); setNote(value.body); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "手记读取失败"); }
  };
  const deleteNote = async (id: string) => {
    setBusy(true);
    try { await deleteJournalNote(id); update({}); void options.refetch(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "手记删除失败"); }
    finally { setBusy(false); }
  };
  return <div className="grid min-w-0 gap-3" data-testid="embedded-ai-journal">
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 break-words text-sm font-medium">{session?.title ?? "新对话"}</span>
      <Button size="icon-sm" variant="ghost" title="新建对话" aria-label="新建对话" disabled={busy} onClick={newConversation}><FilePlusIcon /></Button>
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <Select value={draft.engine ?? (agent.data?.enabled ? "agent" : "llm")} disabled={busy || active}
        onValueChange={(value) => update({ engine: value as "llm" | "agent" })}>
        <SelectTrigger aria-label="分析方式" className="w-40"><SelectValue>{(draft.engine ?? (agent.data?.enabled ? "agent" : "llm")) === "agent" ? "Agent" : "文本分析"}</SelectValue></SelectTrigger>
        <SelectContent><SelectItem value="llm">文本分析</SelectItem><SelectItem value="agent" disabled={!agent.data?.enabled}>Agent{agent.data?.enabled ? "" : "（未启用）"}</SelectItem></SelectContent>
      </Select>
      {draft.instrument_key ? <span className="min-w-0 break-words text-xs">{capability.data?.instrument.name ?? draft.instrument_key}</span> : null}
      {draft.instrument_key ? <Button size="icon-sm" variant="ghost" title="清除标的" aria-label="清除标的" disabled={busy} onClick={() => update({ instrument_key: null })}><RotateCcwIcon /></Button> : null}
    </div>
    <Textarea aria-label="AI 对话问题" value={draft.question} disabled={busy} maxLength={4000}
      onChange={(event) => update({ question: event.target.value })} placeholder="输入问题" />
    <div className="flex justify-end">
      <Button size="icon" title="发送问题" aria-label="发送问题" disabled={!draft.question.trim() || busy || active || Boolean(pendingSnapshot)} onClick={() => void submit(draft.question)}><ArrowUpIcon /></Button>
    </div>
    {pendingSnapshot ? <Button variant="outline" disabled={busy} onClick={() => void recover()}><RotateCcwIcon />查询原记录</Button> : null}
    {error ? <p role="alert" className="break-words text-sm text-destructive">{error}</p> : null}
    {!error && session?.turns.at(-1)?.status === "failed" && !session.turns.at(-1)?.run ? <p role="status" className="break-words text-sm text-destructive">{errors[session.turns.at(-1)!.error_code] ?? "本轮未能完成，问题与快照已保留。"}</p> : null}
    {currentSession.error ? <p className="text-xs text-destructive">连接中断，原任务已保留。<Button variant="ghost" size="icon-sm" title="重新连接" aria-label="重新连接" onClick={() => void currentSession.refetch()}><RotateCcwIcon /></Button></p> : null}
    {session?.turns.at(-1)?.run ? <JournalRunPanel run={session.turns.at(-1)!.run!} onRefresh={() => void currentSession.refetch()} /> : null}
    {session?.turns.slice(0, -1).filter((turn) => turn.run).map((turn) => <details key={turn.id} className="min-w-0 text-xs">
      <summary className="cursor-pointer break-words text-muted-foreground">{turn.snapshot.request.question}</summary>
      <JournalRunPanel run={turn.run!} onRefresh={() => void currentSession.refetch()} />
    </details>)}
    {preview ? <details className="min-w-0 text-xs"><summary className="cursor-pointer text-muted-foreground">本轮数据快照</summary>
      <div className="grid gap-2 py-2"><p>{preview.model.provider} · {preview.model.model}</p><p>市场事实 {preview.facts.length} 项</p>
        {preview.missing.map((item) => <p className="break-words text-muted-foreground" key={item}>{item}</p>)}
        <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(preview.private_context, null, 2)}</pre>
      </div></details> : null}
    <details className="border-t pt-3"><summary className="cursor-pointer text-sm font-medium">投资手记</summary><div className="grid gap-2 py-3">
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
