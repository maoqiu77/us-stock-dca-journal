import { request } from "./api.ts";

export type RecordDraft = {
  kind: "user_decision" | "investment_policy";
  scope: string;
  stance: "observe" | "no_action" | "disagree" | "maintain";
  reason: string;
  review_date: string | null;
  status: "active" | "completed" | "cancelled";
  action: "create" | "revise" | "maintain" | "defer" | "complete" | "cancel";
  new_facts: string;
  source_turn_id: string | null;
  horizon: string;
  cash_needs: string;
  restrictions: string;
  goals: string;
};
export type UserRecord = RecordDraft & {
  id: string; version: number; confirmed_at: string; effective_at: string;
  operation_id?: string;
  source_available: boolean;
  source: { session_id: string; turn_id: string; snapshot_id: string; instrument_key: string | null; observed_at: string } | null;
};
export const recordKey = ["ai-journal-user-records"];
export const fetchUserRecords = () => request<{ items: UserRecord[] }>("/user-records");
export const fetchRecordHistory = (id: string) => request<{ versions: UserRecord[] }>(`/user-records/${encodeURIComponent(id)}`);
export type RecordWrite = RecordDraft & { operation_id: string; expected_version: number; confirmed: true };
export const putUserRecord = (id: string, body: RecordWrite) =>
  request<UserRecord>(`/user-records/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
export const pendingRecordKey = "ai-journal-pending-user-record";
export const stances = { observe: "继续观察", no_action: "暂不行动", disagree: "保留不同意见", maintain: "维持判断" };
export const actions = { revise: "修订判断", maintain: "维持并完成复盘", defer: "延后", complete: "完成", cancel: "取消复盘" };
export const recordStatuses = { active: "有效", completed: "已完成", cancelled: "已取消" };
export function recordTime(stamp: string) {
  return new Date(stamp).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }) + "（北京时间）";
}
export function dueRecords(items: UserRecord[], today: string) {
  return items.filter(item => item.kind === "user_decision" && item.status === "active" && item.review_date && item.review_date <= today)
    .sort((a, b) => a.review_date!.localeCompare(b.review_date!) || a.id.localeCompare(b.id));
}
export function sourceHref(item: UserRecord) {
  if (!item.source || !item.source_available) return null;
  const params = new URLSearchParams({ view: "ai", session: item.source.session_id });
  // The saved session owns its identity; a prefill parameter would start a new conversation.
  return `/?${params}#turn-${encodeURIComponent(item.source.turn_id)}`;
}
export function recordDraft(item?: UserRecord, source?: { turnId: string; scope: string }, policy = false): RecordDraft {
  return {
    kind: item?.kind ?? (policy ? "investment_policy" : "user_decision"), scope: item?.scope ?? source?.scope ?? "我的组合",
    stance: item?.stance ?? "observe", reason: item?.reason ?? "", review_date: item?.review_date ?? null,
    status: "active", action: item ? "revise" : "create", new_facts: "", source_turn_id: item?.source?.turn_id ?? source?.turnId ?? null,
    horizon: item?.horizon ?? "", cash_needs: item?.cash_needs ?? "", restrictions: item?.restrictions ?? "", goals: item?.goals ?? "",
  };
}
