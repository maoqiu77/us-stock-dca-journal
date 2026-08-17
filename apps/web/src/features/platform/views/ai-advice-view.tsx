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
  SparklesIcon,
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchAiAdviceCalendar,
  clearAiAdviceChat,
  generateAiAdvice,
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

export function AiAdviceView() {
  const queryClient = useQueryClient();
  const [chatPrompt, setChatPrompt] = React.useState("");
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [isRecoveringAiResponse, setIsRecoveringAiResponse] =
    React.useState(false);
  const [confirmGenerate, setConfirmGenerate] = React.useState(false);
  const chatContainerRef = React.useRef<HTMLDivElement>(null);
  const [calendarMonth, setCalendarMonth] = React.useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1 };
  });
  const aiCalendarQuery = useAiAdviceCalendarQuery(selectedDate);
  const aiSettingsQuery = useAiSettingsQuery();
  const calendarData = aiCalendarQuery.data;
  const record = calendarData?.record ?? null;
  const applyCalendarResponse = React.useCallback(
    (response: Awaited<ReturnType<typeof generateAiAdvice>>) => {
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
  const externalMutation = useMutation({
    mutationFn: () => generateAiAdvice(""),
    onMutate: getCurrentAiAdviceSignature,
    onSuccess: applyCalendarResponse,
    onError: (error, _variables, context) => {
      if (isRecoverableAiAdviceError(error)) {
        void recoverSavedAiAdvice(
          context?.previousSignature ?? "",
          () => externalMutation.reset()
        );
      }
    },
  });
  const chatMutation = useMutation({
    mutationFn: sendAiAdviceChat,
    onMutate: getCurrentAiAdviceSignature,
    onSuccess: (response) => {
      setChatPrompt("");
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
  const generationPending =
    externalMutation.isPending || isRecoveringAiResponse;
  let generateButtonLabel = "生成每日 AI 建议";
  if (externalMutation.isPending) {
    generateButtonLabel = "生成中";
  }
  if (isRecoveringAiResponse) {
    generateButtonLabel = "同步结果中";
  }
  const generationError =
    isRecoveringAiResponse
      ? ""
      : externalMutation.error?.message ?? "";
  const aiStatus = aiReady ? "ready" : "missing-config";
  const aiUnavailableReason = !aiReady
    ? "请先在数据管理补齐 AI Base URL、模型和 API Key。"
    : "";
  const submitChat = () => {
    const prompt = chatPrompt.trim();
    if (!prompt || !aiReady || chatMutation.isPending) {
      return;
    }
    chatMutation.mutate(prompt);
  };

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card className="min-w-0 xl:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <CalendarDaysIcon />
              AI 建议日历
            </CardTitle>
            <CardDescription>按数据管理中的私有数据和 AI 配置生成</CardDescription>
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
                      savedDates.has(day) ? "，已有 AI 建议" : "，无 AI 建议"
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
              AI 建议
              <Button
                className="ml-4 sm:ml-12 xl:ml-56"
                variant="secondary"
                size="default"
                onClick={() => setConfirmGenerate(true)}
                disabled={!aiReady || generationPending}
              >
                <SparklesIcon data-icon="inline-start" />
                {generateButtonLabel}
              </Button>
            </CardTitle>
            <CardDescription>
              {record
                ? `${record.date}，生成时间 ${record.generated_at}`
                : "尚未选择或保存 AI 建议"}
            </CardDescription>
            <CardAction>
              <Badge variant="outline">{record?.source ?? "local"}</Badge>
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4">
            {aiCalendarQuery.isLoading ? (
              <div className="grid gap-2">
                <Skeleton className="h-5 w-1/3" />
                <Skeleton className="h-72 w-full" />
              </div>
            ) : record ? (
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
                生成今日 AI 建议后，这里会保存记录并开启追问。
              </div>
            )}
            {aiUnavailableReason ? (
              <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {aiUnavailableReason}
              </div>
            ) : null}
            {generationError ? (
              <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                <div className="flex min-w-0 items-start gap-2">
                  <AlertCircleIcon />
                  <span className="min-w-0">{generationError}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => externalMutation.mutate()}
                  disabled={generationPending || !aiReady}
                >
                  <RefreshCcwIcon data-icon="inline-start" />
                  重试
                </Button>
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
              {record
                ? selectedIsToday
                  ? "基于今日建议继续追问"
                  : `${record.date} 的历史对话`
                : "生成今日 AI 建议后可继续追问"}
            </CardDescription>
            <CardAction className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => clearChatMutation.mutate()}
                disabled={
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
              {chatMessages.length === 0 && !pendingChatPrompt ? (
                <div className="m-auto max-w-64 text-center text-sm text-muted-foreground">
                  {record
                    ? "在下方输入问题，AI 的回答会显示在这里。"
                    : "请先生成今日 AI 建议。"}
                </div>
              ) : null}
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
            {selectedIsToday ? (
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
                  disabled={
                    !aiReady || !chatPrompt.trim() || chatMutation.isPending
                  }
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
            <CardDescription>每日总结发送给 AI 的上下文类型</CardDescription>
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
                生成每日总结后，这里会展示发送给 AI 的上下文类型。
              </div>
            )}
          </CardContent>
          </Card>
        </div>
      </div>
      <AiSendConfirmDialog
        open={confirmGenerate}
        isPending={externalMutation.isPending}
        onOpenChange={setConfirmGenerate}
        onConfirm={() => {
          externalMutation.mutate();
          setConfirmGenerate(false);
        }}
      />
    </>
  );
}

function AiSendConfirmDialog({
  open,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>确认发送给 AI</DialogTitle>
          <DialogDescription>
            继续后会调用你在数据管理中配置的 OpenAI-compatible 接口。请先确认这些本地上下文可以发送给外部模型。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          <div className="rounded-lg bg-muted/50 p-3">账户摘要：账户规模、现金、持仓成本和仓位状态。</div>
          <div className="rounded-lg bg-muted/50 p-3">持仓计划：股票池、目标仓位、止盈止损和资产类型。</div>
          <div className="rounded-lg bg-muted/50 p-3">交易流水：历史买卖记录和备注。</div>
          <div className="rounded-lg bg-muted/50 p-3">行情与策略信号：报价、均线、RSI、回撤和平台信号。</div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            确认生成建议
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
  "持仓计划：股票池、目标仓位、止盈止损和资产类型。",
  "交易流水：历史买卖记录和备注。",
  "策略配置：分层角色、加仓阈值、止损规则和风险参数。",
  "行情信号：报价、均线、RSI、回撤、日内走势和平台建议。",
  "北京时间上下文：当前交易时段和执行节奏建议。",
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
