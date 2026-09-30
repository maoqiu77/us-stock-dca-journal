"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  AlertCircleIcon,
  BotIcon,
  CalendarDaysIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileTextIcon,
  MessageSquareIcon,
  RefreshCcwIcon,
  SendIcon,
  Trash2Icon,
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
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchAiAdviceCalendar,
  clearAiAdviceChat,
  sendAiAdviceChat,
} from "@/features/platform/api";
import {
  useAiAdviceCalendarQuery,
  useAiSettingsQuery,
} from "@/features/platform/queries";
import {
  isAiAdviceCompositionEnter,
  isAiAdviceSubmitShortcut,
} from "@/features/platform/ai-advice-shortcut";
import {
  EmbeddedJournalComposer,
  type EmbeddedJournalHandle,
} from "@/features/ai-journal/embedded-composer";
import type { JournalSession } from "@/features/ai-journal/api";

export function AiAdviceView() {
  const queryClient = useQueryClient();
  const [chatPrompt, setChatPrompt] = React.useState("");
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [isRecoveringAiResponse, setIsRecoveringAiResponse] =
    React.useState(false);
  const [journalSession, setJournalSession] = React.useState<JournalSession | null>(null);
  const journalRef = React.useRef<EmbeddedJournalHandle>(null);
  const chatContainerRef = React.useRef<HTMLDivElement>(null);
  const [calendarMonth, setCalendarMonth] = React.useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const aiCalendarQuery = useAiAdviceCalendarQuery(selectedDate);
  const aiSettingsQuery = useAiSettingsQuery();
  const [journalKey, setJournalKey] = React.useState<string | undefined>();
  React.useEffect(() => {
    const saved = window.localStorage.getItem("ai-journal-prefill-key");
    if (saved) { // eslint-disable-next-line react-hooks/set-state-in-effect
      setJournalKey(saved);
    }
    const onPrefill = (event: Event) => setJournalKey((event as CustomEvent<string>).detail);
    window.addEventListener("ai-journal-prefill", onPrefill);
    return () => window.removeEventListener("ai-journal-prefill", onPrefill);
  }, []);
  const calendarData = aiCalendarQuery.data;
  const record = calendarData?.record ?? null;
  const applyCalendarResponse = React.useCallback(
    (response: Awaited<ReturnType<typeof fetchAiAdviceCalendar>>) => {
      queryClient.setQueryData(["ai-advice", "default"], response);
      const nextDate = response.record?.date ?? response.selectedDate ?? response.today;
      if (nextDate) {
        queryClient.setQueryData(["ai-advice", nextDate], response);
        setSelectedDate(nextDate);
        const [year, month] = nextDate.split("-").map(Number);
        setCalendarMonth({ year, month });
      }
      void queryClient.invalidateQueries({ queryKey: ["ai-advice"] });
    },
    [queryClient]
  );
  const recoverSavedAiAdvice = React.useCallback(
    async (previousSignature: string, resetMutation: () => void) => {
      setIsRecoveringAiResponse(true);
      try {
        for (let attempt = 0; attempt < 12; attempt += 1) {
          if (attempt > 0) {
            await wait(2500);
          }
          const response = await fetchAiAdviceCalendar();
          const nextSignature = aiAdviceRecordSignature(response.record);
          if (
            response.record &&
            response.selectedDate === response.today &&
            nextSignature !== previousSignature
          ) {
            applyCalendarResponse(response);
            resetMutation();
            return;
          }
        }
      } catch {
        // Keep the original mutation error visible when recovery cannot confirm a saved record.
      } finally {
        setIsRecoveringAiResponse(false);
      }
    },
    [applyCalendarResponse]
  );
  const chatMutation = useMutation({
    mutationFn: sendAiAdviceChat,
    onMutate: getCurrentAiAdviceSignature,
    onSuccess: (response) => {
      applyCalendarResponse(response);
    },
    onError: (error, _variables, context) => {
      if (isRecoverableAiAdviceError(error)) {
        void recoverSavedAiAdvice(
          context?.previousSignature ?? "",
          () => chatMutation.reset()
        );
      }
    },
  });
  const clearChatMutation = useMutation({
    mutationFn: clearAiAdviceChat,
    onSuccess: (response) => {
      chatMutation.reset();
      setChatPrompt("");
      applyCalendarResponse(response);
    },
  });
  const savedDates = new Set(calendarData?.dates ?? []);
  const selectedCalendarDate = selectedDate ?? calendarData?.selectedDate ?? null;
  const days = calendarDays(calendarMonth.year, calendarMonth.month);
  const aiReady =
    Boolean(aiSettingsQuery.data?.hasApiKey) &&
    Boolean(aiSettingsQuery.data?.baseUrl) &&
    Boolean(aiSettingsQuery.data?.model);
  const selectedIsToday =
    Boolean(selectedCalendarDate) && selectedCalendarDate === calendarData?.today;
  const chatMessages = record ? record.messages.slice(1) : [];
  const pendingChatPrompt =
    chatMutation.isPending || chatMutation.isError
      ? chatMutation.variables?.trim()
      : "";
  React.useEffect(() => {
    const container = chatContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [chatMessages.length, pendingChatPrompt, chatMutation.isPending]);
  const aiStatus = aiReady ? "ready" : "missing-config";
  const aiUnavailableReason = !aiReady
    ? "请先在 AI 模型配置补齐 Base URL、模型和 API Key。"
    : "";
  const submitChat = async () => {
    const prompt = chatPrompt.trim();
    if (!prompt || !aiReady || chatMutation.isPending || isRecoveringAiResponse) {
      return;
    }
    setChatPrompt("");
    if (journalSession) {
      const completed = await journalRef.current?.followUp(prompt);
      if (!completed) {
        setChatPrompt(prompt);
      }
      return;
    }
    chatMutation.mutate(prompt);
  };
  const journalMessages = journalSession
    ? journalSession.turns.flatMap((turn) => [
        { role: "user" as const, content: turn.snapshot.request.question },
        ...(turn.answer
          ? [{ role: "assistant" as const, content: turn.answer }]
          : []),
      ])
    : [];
  const journalAnswer = journalSession?.turns
    .filter((turn) => turn.status === "completed" && turn.answer)
    .at(-1)?.answer;
  const canChat = Boolean(journalSession) || selectedIsToday;

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <CalendarDaysIcon />
              AI 分析日历
            </CardTitle>
            <CardDescription>按本地持仓数据和 AI 模型配置生成</CardDescription>
            <CardAction>
              <Badge variant={aiStatus === "ready" ? "secondary" : "outline"}>
                {aiStatus}
              </Badge>
            </CardAction>
          </CardHeader>
          <CardContent>
            <div className="grid min-w-0 gap-2">
              <div className="flex items-center justify-between gap-2">
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() =>
                    setCalendarMonth(shiftMonth(calendarMonth, -1))
                  }
                  title="上个月"
                >
                  <ChevronLeftIcon />
                  <span className="sr-only">上个月</span>
                </Button>
                <div className="text-sm font-medium">
                  {calendarMonth.year} 年 {calendarMonth.month} 月
                </div>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() =>
                    setCalendarMonth(shiftMonth(calendarMonth, 1))
                  }
                  title="下个月"
                >
                  <ChevronRightIcon />
                  <span className="sr-only">下个月</span>
                </Button>
              </div>
              <div className="grid grid-cols-8 gap-1">
                {days.map((day) => (
                  <Button
                    key={day}
                    variant={
                      day === selectedCalendarDate ? "secondary" : "outline"
                    }
                    size="sm"
                    disabled={!savedDates.has(day)}
                    onClick={() => setSelectedDate(day)}
                    className="relative h-9 min-w-0 px-1 text-base font-medium"
                    aria-label={`${day}${
                      savedDates.has(day) ? "，已有 AI 分析" : "，无 AI 分析"
                    }`}
                  >
                    {Number(day.slice(-2))}
                    {savedDates.has(day) ? (
                      <span
                        className="absolute right-1 top-1 size-1 rounded-full bg-current"
                        aria-hidden="true"
                      />
                    ) : null}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="flex min-w-0 flex-col gap-3">
          <Card className="min-w-0">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <FileTextIcon />
              AI 分析
            </CardTitle>
            <CardDescription>
              {journalSession
                ? journalSession.title
                : record
                ? `${record.date}，生成时间 ${record.generated_at}`
                : "尚未选择或保存 AI 分析"}
            </CardDescription>
            <CardAction>
              <Badge variant="outline">{record?.source ?? "local"}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4">
            <EmbeddedJournalComposer
              ref={journalRef}
              prefillKey={journalKey}
              session={journalSession}
              onSessionChange={setJournalSession}
            />
            {journalAnswer ? (
              <div className="max-h-[560px] overflow-auto rounded-lg bg-muted/50 p-3">
                <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                  {journalAnswer}
                </pre>
              </div>
            ) : null}
            {aiCalendarQuery.isLoading ? (
              <div className="grid gap-2">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-72 w-full" />
              </div>
            ) : record && !journalSession ? (
              <div className="grid gap-4">
                <div className="rounded-lg bg-muted/50 p-3">
                  <div className="text-sm text-muted-foreground">交易时段</div>
                  <div className="mt-1 text-sm">
                    {record.beijing_context.estimated_session_status ?? "--"}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {record.beijing_context.timing_suggestion ?? ""}
                  </div>
                </div>
                <div className="max-h-[560px] overflow-auto rounded-lg bg-muted/50 p-3">
                  <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
                    {record.content}
                  </pre>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                选择“持仓分析”或“标的快研”后，这里会保存分析并开启追问。
              </div>
            )}
            {aiUnavailableReason ? (
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {aiUnavailableReason}
              </div>
            ) : null}
          </CardContent>
          </Card>
        </div>
        <div className="flex flex-col gap-3">
          <Card className="min-h-[560px]">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <MessageSquareIcon />
              AI 对话
            </CardTitle>
            <CardDescription>
              {journalSession
                ? "基于当前研究继续追问"
                : record
                ? selectedIsToday
                  ? "基于今日分析继续追问"
                  : `${record.date} 的历史对话`
                : "生成今日 AI 分析后可继续追问"}
            </CardDescription>
            <CardAction className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearChatMutation.mutate()}
                disabled={
                  Boolean(journalSession) ||
                  !selectedIsToday ||
                  chatMessages.length === 0 ||
                  chatMutation.isPending ||
                  clearChatMutation.isPending
                }
                title="仅清空今日追问，保留 AI 首次总结"
              >
                <Trash2Icon data-icon="inline-start" />
                {clearChatMutation.isPending ? "清空中" : "清空今日对话"}
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent className="flex min-h-0 flex-1 flex-col gap-3">
            <div
              ref={chatContainerRef}
              className="flex max-h-[520px] min-h-72 flex-1 flex-col gap-3 overflow-y-auto rounded-lg bg-muted/30 p-3"
              aria-live="polite"
            >
              {chatMessages.length === 0 && journalMessages.length === 0 && !pendingChatPrompt ? (
                <div className="m-auto max-w-64 text-center text-sm text-muted-foreground">
                  {journalSession
                    ? "在下方输入问题，继续这次研究。"
                    : record
                    ? "在下方输入问题，AI 的回答会显示在这里。"
                    : "请选择持仓分析或标的快研。"}
                </div>
              ) : null}
              {journalMessages.map((message, index) => (
                <ChatMessageBubble
                  key={`journal-${index}-${message.role}`}
                  role={message.role}
                  content={message.content}
                />
              ))}
              {chatMessages.map((message, index) => (
                <ChatMessageBubble
                  key={`${message.created_at}-${message.role}-${index}`}
                  role={message.role}
                  content={message.content}
                  createdAt={message.created_at}
                />
              ))}
              {pendingChatPrompt ? (
                <ChatMessageBubble role="user" content={pendingChatPrompt} />
              ) : null}
              {chatMutation.isPending ? (
                <div className="mr-auto flex max-w-[85%] items-center gap-2 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <BotIcon className="size-4" />
                  AI 正在回复…
                </div>
              ) : null}
            </div>
            {chatMutation.error ? (
              <div className="flex items-start justify-between gap-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <div className="flex min-w-0 items-start gap-2">
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">{chatMutation.error.message}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    chatMutation.mutate(
                      chatMutation.variables?.trim() || chatPrompt.trim()
                    )
                  }
                  disabled={chatMutation.isPending || !aiReady}
                >
                  <RefreshCcwIcon data-icon="inline-start" />
                  重试
                </Button>
              </div>
            ) : null}
            {clearChatMutation.error ? (
              <div className="flex items-start justify-between gap-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                <div className="flex min-w-0 items-start gap-2">
                  <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />
                  <span className="min-w-0">{clearChatMutation.error.message}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => clearChatMutation.mutate()}
                  disabled={clearChatMutation.isPending}
                >
                  <RefreshCcwIcon data-icon="inline-start" />
                  重试
                </Button>
              </div>
            ) : null}
            {canChat ? (
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="ai-chat-prompt">追问</FieldLabel>
                  <Textarea
                    id="ai-chat-prompt"
                    value={chatPrompt}
                    onChange={(event) => setChatPrompt(event.target.value)}
                    onKeyDown={(event) => {
                      if (isAiAdviceCompositionEnter(event)) {
                        return;
                      }
                      if (isAiAdviceSubmitShortcut(event)) {
                        event.preventDefault();
                        submitChat();
                      }
                    }}
                    className="min-h-24 resize-none"
                    placeholder="输入追问；Control + Enter 发送，Enter 换行"
                  />
                </Field>
                <Button
                  onClick={submitChat}
                  disabled={!aiReady || !chatPrompt.trim() || chatMutation.isPending || isRecoveringAiResponse}
                >
                  <SendIcon data-icon="inline-start" />
                  {chatMutation.isPending ? "发送中" : "发送追问"}
                </Button>
                {aiUnavailableReason ? (
                  <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                    {aiUnavailableReason}
                  </div>
                ) : null}
              </FieldGroup>
            ) : record ? (
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                历史记录仅供查看；请选择今天继续追问。
              </div>
            ) : null}
          </CardContent>
          </Card>
          <Card>
          <CardHeader className="border-b">
            <CardTitle>AI-prompt</CardTitle>
            <CardDescription>当前分析和对话发送给 AI 的上下文类型</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {record ? (
              AI_PROMPT_CONTEXT_ITEMS.map((item) => (
                <div key={item} className="rounded-lg bg-muted/50 p-3 text-sm">
                  {item}
                </div>
              ))
            ) : (
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                选择持仓分析或标的快研后，这里会展示发送给 AI 的上下文类型。
              </div>
            )}
          </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}

function ChatMessageBubble({
  role,
  content,
  createdAt,
}: {
  role: "user" | "assistant";
  content: string;
  createdAt?: string;
}) {
  const isUser = role === "user";
  return (
    <div
      className={
        isUser
          ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground"
          : "mr-auto max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3 py-2"
      }
    >
      <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
        {content}
      </pre>
      {createdAt ? (
        <div
          className={
            isUser
              ? "mt-1 text-right text-[11px] text-primary-foreground/70"
              : "mt-1 text-[11px] text-muted-foreground"
          }
        >
          {createdAt}
        </div>
      ) : null}
    </div>
  );
}

function aiAdviceRecordSignature(
  record: Awaited<ReturnType<typeof fetchAiAdviceCalendar>>["record"]
) {
  if (!record) {
    return "";
  }
  const lastMessage = record.messages.at(-1);
  return [
    record.date,
    record.generated_at,
    record.content,
    record.messages.length,
    lastMessage?.role ?? "",
    lastMessage?.content ?? "",
  ].join("\n");
}

async function getCurrentAiAdviceSignature() {
  try {
    const response = await fetchAiAdviceCalendar();
    return { previousSignature: aiAdviceRecordSignature(response.record) };
  } catch {
    return { previousSignature: "" };
  }
}

function isRecoverableAiAdviceError(error: unknown) {
  return (
    error instanceof Error &&
    (/^API 5\d\d: \/api\/ai-advice\//.test(error.message) ||
      error.message === "Failed to fetch" ||
      error.message === "Load failed")
  );
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

const AI_PROMPT_CONTEXT_ITEMS = [
  "账户摘要：账户规模、现金、持仓成本和当前仓位状态。",
  "持仓快照：标的、资产类型、股数、成本与建仓日期。",
  "交易流水：历史买卖记录和备注。",
  "市场观察：报价、均线、RSI、回撤和日内走势。",
  "北京时间上下文：当前交易时段。",
  "用户额外问题：生成日报或追问时输入的补充问题。",
];

function calendarDays(year: number, month: number) {
  const last = new Date(year, month, 0);
  return Array.from({ length: last.getDate() }, (_, index) =>
    formatDate(year, month, index + 1)
  );
}

function shiftMonth(
  value: { year: number; month: number },
  offset: number
) {
  const next = new Date(value.year, value.month - 1 + offset, 1);
  return { year: next.getFullYear(), month: next.getMonth() + 1 };
}

function formatDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(
    2,
    "0"
  )}`;
}
