"use client";

import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { beijingDay } from "./calendar";
import { JournalRequestError } from "./api";
import { actions, dueRecords, fetchRecordHistory, fetchUserRecords, pendingRecordKey, putUserRecord, recordDraft, recordKey, recordStatuses, recordTime, sourceHref, stances, type RecordDraft, type RecordWrite, type UserRecord } from "./user-records";

type Editor = { item?: UserRecord; source?: { turnId: string; scope: string }; policy?: boolean };

export function SaveJudgmentButton({ turnId, scope }: { turnId: string; scope: string }) {
  const [open, setOpen] = React.useState(false);
  return <><Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(true)}>记下我的判断</Button>
    {open ? <RecordEditor source={{ turnId, scope }} onClose={() => setOpen(false)} /> : null}</>;
}

export function UserRecordsPanel() {
  const query = useQuery({ queryKey: recordKey, queryFn: fetchUserRecords, refetchOnWindowFocus: true });
  const [open, setOpen] = React.useState(false);
  const [editor, setEditor] = React.useState<Editor | null>(null);
  const items = query.data?.items ?? [];
  const due = dueRecords(items, beijingDay());
  const policy = items.find(item => item.kind === "investment_policy");
  return <section aria-label="判断与日期复盘" className="mb-4 grid gap-2 rounded-lg border p-3">
    <PendingRecordRecovery />
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm">{query.isError ? "判断与复盘暂时无法读取" : query.isLoading ? "正在读取日期复盘…" : `到期复盘 ${due.length} 条`}<span className="ml-2 text-xs text-muted-foreground">打开应用时检查 · 无后台通知</span></p>
      <Button variant="outline" size="sm" onClick={() => { setOpen(true); void query.refetch(); }}>我的判断与投资政策</Button>
    </div>
    {due.slice(0, 3).map(item => <Button key={item.id} variant="ghost" className="h-auto justify-start whitespace-normal text-left" onClick={() => setEditor({ item })}>{item.review_date} · {item.scope} · {stances[item.stance]}</Button>)}
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>我的判断与投资政策</DialogTitle><DialogDescription>仅保存用户确认的原文。判断和政策不写入交易，也不会自动发送给 AI。</DialogDescription></DialogHeader>
      {query.isError ? <Button onClick={() => void query.refetch()}>读取失败，重试</Button> : null}
      {query.isLoading ? <p>读取中…</p> : null}
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={() => setEditor({})}>手动记判断</Button><Button variant="outline" disabled={query.isLoading || query.isError} onClick={() => setEditor({ item: policy, policy: true })}>{policy ? "修订投资政策" : "自愿填写投资政策"}</Button></div>
      {items.map(item => <div key={item.id} className="grid gap-2 rounded-lg border p-3">
        <p className="font-medium">{item.kind === "investment_policy" ? "投资政策" : item.scope} · v{item.version} · {item.status === "active" ? "有效" : item.status === "completed" ? "已完成" : "已取消"}</p>
        <p className="whitespace-pre-wrap break-words text-sm">{item.reason}</p>
        <p className="text-xs text-muted-foreground">{item.review_date ? `复盘日期 ${item.review_date}` : "未设复盘日期"} · 确认于 {recordTime(item.confirmed_at)}</p>
        <Button variant="outline" onClick={() => setEditor({ item })}>打开 / 复盘 / 查看旧版</Button>
      </div>)}
      {!items.length && !query.isLoading && !query.isError ? <p className="text-sm text-muted-foreground">还没有确认的判断或政策。</p> : null}
    </DialogContent></Dialog>
    {editor ? <RecordEditor {...editor} onClose={() => setEditor(null)} /> : null}
  </section>;
}

function RecordEditor({ item, source, policy, onClose }: Editor & { onClose: () => void }) {
  const client = useQueryClient();
  const [draft, setDraft] = React.useState(() => recordDraft(item, source, policy));
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [conflict, setConflict] = React.useState(false);
  const [pending, setPending] = React.useState<Parameters<typeof putUserRecord>[1] | null>(null);
  const [id] = React.useState(() => item?.id ?? (policy ? "investment-policy" : crypto.randomUUID()));
  const history = useQuery({ queryKey: [...recordKey, id], queryFn: () => fetchRecordHistory(id), enabled: Boolean(item) });
  const isPolicy = draft.kind === "investment_policy";
  const editable = draft.action === "create" || draft.action === "revise";
  function change<K extends keyof RecordDraft>(key: K, value: RecordDraft[K]) {
    setDraft(current => ({ ...current, [key]: value })); setConfirmed(false);
  }
  async function save() {
    const body = pending ?? { ...draft, expected_version: item?.version ?? 0, confirmed: true as const, operation_id: crypto.randomUUID() };
    setPending(body); setBusy(true); setError("");
    try {
      const old = window.sessionStorage.getItem(pendingRecordKey);
      if (old && JSON.parse(old).body.operation_id !== body.operation_id) {
        setPending(null); setError("此窗口有另一笔待核验保存，请先关闭并核验，当前候选未发送。"); return;
      }
      window.sessionStorage.setItem(pendingRecordKey, JSON.stringify({ id, body }));
      await putUserRecord(id, body);
      window.sessionStorage.removeItem(pendingRecordKey);
      await client.invalidateQueries({ queryKey: recordKey });
      onClose();
    } catch (reason) {
      if (reason instanceof JournalRequestError && reason.status < 500) {
        window.sessionStorage.removeItem(pendingRecordKey);
        setPending(null);
        if (reason.status === 409) { setConflict(true); void history.refetch(); }
        setError(reason.status === 409 ? "另一窗口已修改此记录。你的候选保留在此，可复制后关闭并重新打开最新版；没有覆盖远端。" : `保存未完成：${reason.message}`);
      } else setError("保存结果待核验，候选已保留在此窗口。请用下方按钮核验同一操作，勿关闭窗口。");
    } finally { setBusy(false); }
  }
  const locked = busy || Boolean(pending);
  return <Dialog open onOpenChange={value => { if (!value && !locked) onClose(); }}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
    <DialogHeader><DialogTitle>{isPolicy ? "投资政策 · 自愿确认" : item ? "判断复盘" : "记下我的判断"}</DialogTitle><DialogDescription>{isPolicy ? "填写期限、现金需要、限制与目标；确认时生效并保留旧版。目前仅供本地回看，不自动作为 AI 个人规则。" : "用自己的话记录。继续观察、暂不行动或不同意见都可以；不会生成成交。"}</DialogDescription></DialogHeader>
    {item ? <div className="grid gap-2 rounded-lg bg-muted/40 p-3 text-sm"><p>当时依据（v{item.version}）：{item.reason}</p><SourceLink item={item} /><p className="text-xs text-muted-foreground">新增事实由你填写，尚未核验。未取得同口径的新快照时，无法自动比较市场变化。</p></div> : source ? <p className="text-xs text-muted-foreground">将关联当前回答和原冻结快照；下方理由由你填写，未确认不会保存。</p> : <p className="text-xs text-muted-foreground">手动记录：来源为空，不推测原回答。</p>}
    <fieldset disabled={locked} className="grid min-w-0 gap-3">
      {item && !isPolicy ? <div className="flex flex-wrap gap-2">{Object.entries(actions).map(([key, label]) => <Button key={key} type="button" size="sm" variant={draft.action === key ? "default" : "outline"} onClick={() => {
        const action = key as RecordDraft["action"];
        setDraft({ ...recordDraft(item), action, status: action === "complete" ? "completed" : action === "cancel" ? "cancelled" : "active", review_date: action === "maintain" || action === "complete" || action === "cancel" ? null : item.review_date }); setConfirmed(false);
      }}>{label}</Button>)}</div> : null}
      <label className="grid gap-1 text-sm">范围<Input value={draft.scope} readOnly={!editable} maxLength={200} onChange={event => change("scope", event.target.value)} /></label>
      {!isPolicy ? <div className="flex flex-wrap gap-2" aria-label="立场">{Object.entries(stances).map(([key, label]) => <Button key={key} type="button" size="sm" disabled={!editable} variant={draft.stance === key ? "default" : "outline"} onClick={() => change("stance", key as RecordDraft["stance"])}>{label}</Button>)}</div> : null}
      <label className="grid gap-1 text-sm">{isPolicy ? "政策说明" : "我的理由"}<Textarea value={draft.reason} readOnly={!editable} maxLength={6000} onChange={event => change("reason", event.target.value)} /></label>
      {isPolicy ? ([['horizon', '投资期限'], ['cash_needs', '预算 / 现金需要'], ['restrictions', '限制'], ['goals', '目标']] as const).map(([key, label]) => <label key={key} className="grid gap-1 text-sm">{label}<Textarea value={draft[key]} maxLength={1000} onChange={event => change(key, event.target.value)} /></label>) : <>
        {draft.status === "active" ? <label className="grid gap-1 text-sm">复盘日期（可留空）<Input type="date" value={draft.review_date ?? ""} onChange={event => change("review_date", event.target.value || null)} /></label> : null}
        {item ? <label className="grid gap-1 text-sm">本次新增事实 / 复盘说明<Textarea value={draft.new_facts} maxLength={6000} onChange={event => change("new_facts", event.target.value)} /></label> : null}
      </>}
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} />我确认以上内容代表我自己的判断{isPolicy ? "与政策" : ""}</label>
    </fieldset>
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    <div className="flex flex-wrap gap-2"><Button disabled={busy || conflict || (!pending && (!confirmed || !draft.scope.trim() || !draft.reason.trim()))} onClick={() => void save()}>{busy ? "保存中…" : pending ? "核验并重试同一操作" : "确认保存到本地数据库"}</Button><Button variant="outline" disabled={locked} onClick={onClose}>关闭</Button>
      {error ? <Button variant="outline" onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify({ id, draft, pending }, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = "user-record-candidate.json"; link.click(); URL.revokeObjectURL(url);
      }}>导出此候选</Button> : null}
    </div>
    {item ? <details className="border-t pt-3"><summary className="cursor-pointer text-sm">查看历史版本 / 导出原文</summary>
      {history.isError ? <Button variant="outline" onClick={() => void history.refetch()}>版本读取失败，重试</Button> : null}
      <Button variant="outline" size="sm" className="my-2" disabled={!history.data} onClick={() => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(history.data, null, 2)], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = `user-record-${id}.json`; link.click(); URL.revokeObjectURL(url);
      }}>导出所有版本</Button>
      {history.data?.versions.map(version => <div key={version.version} className="my-2 grid gap-1 rounded border p-2 text-sm"><p>v{version.version} · {recordTime(version.confirmed_at)} · {version.action === "create" ? "首次确认" : actions[version.action]} · {stances[version.stance]}</p><p className="whitespace-pre-wrap break-words">{version.reason}</p>{version.kind === "investment_policy" ? <p className="whitespace-pre-wrap break-words">期限：{version.horizon}；现金：{version.cash_needs}；限制：{version.restrictions}；目标：{version.goals}</p> : null}<p>复盘日期：{version.review_date ?? "无"} · {recordStatuses[version.status]}</p>{version.new_facts ? <p>新增记录：{version.new_facts}</p> : null}<SourceLink item={version} /></div>)}
    </details> : null}
  </DialogContent></Dialog>;
}

function PendingRecordRecovery() {
  const client = useQueryClient();
  const [pending, setPending] = React.useState<{ id: string; body: RecordWrite } | null>(null);
  const [message, setMessage] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  React.useEffect(() => {
    try {
      const raw = window.sessionStorage.getItem(pendingRecordKey);
      if (raw) {
        // Restore only the user's saved candidate; never resend on mount.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPending(JSON.parse(raw));
      }
    } catch { setMessage("未决保存副本无法读取，请保留浏览器资料后排查。"); }
  }, []);
  async function recover(retry: boolean) {
    if (!pending) return;
    setBusy(true);
    try {
      if (retry) await putUserRecord(pending.id, pending.body);
      else {
        const result = await fetchRecordHistory(pending.id);
        if (!result.versions.some(row => row.operation_id === pending.body.operation_id)) {
          setMessage("未找到此操作回执。可以用原操作再次确认；版本冲突时不会覆盖。"); return;
        }
      }
      window.sessionStorage.removeItem(pendingRecordKey); setPending(null); setMessage("已核验，保存已完成。");
      await client.invalidateQueries({ queryKey: recordKey });
    } catch (reason) { setMessage(reason instanceof JournalRequestError && reason.status === 409 ? "版本已变化。候选仍保留，请导出后核对最新版本。" : "结果仍待核验，未自动重发。可用原操作再次确认。"); }
    finally { setBusy(false); }
  }
  return <>{pending ? <div className="grid gap-2 rounded border p-2 text-sm"><p>上次判断 / 政策保存结果待核验：{pending.body.scope}</p><p className="whitespace-pre-wrap break-words">{pending.body.reason}</p><div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy} onClick={() => void recover(false)}>查询原操作回执</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => void recover(true)}>再次确认同一操作</Button><Button size="sm" variant="outline" onClick={() => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(pending, null, 2)], { type: "application/json" })); const link = document.createElement("a"); link.href = url; link.download = "pending-user-record.json"; link.click(); URL.revokeObjectURL(url);
  }}>导出未决候选</Button><Button size="sm" variant="outline" disabled={busy} onClick={() => { window.sessionStorage.removeItem(pendingRecordKey); setPending(null); setMessage("已结束本窗口核验，请在记录列表检查已入库版本；数据库未改变。"); }}>已保留候选，结束本次核验</Button></div></div> : null}{message ? <p role="status" className="text-sm">{message}</p> : null}</>;
}

function SourceLink({ item }: { item: UserRecord }) {
  const href = sourceHref(item);
  return href ? <a className="text-sm underline" href={href}>返回原回答与来源快照 · {recordTime(item.source!.observed_at)}</a> : <p className="text-xs text-muted-foreground">{item.source ? "原回答已删除或不可用；保留原关联，冻结快照随完整备份保存，不猜测缺失正文。" : "无原回答关联"}</p>;
}
