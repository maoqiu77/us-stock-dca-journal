"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BotIcon, ChevronDownIcon, KeyRoundIcon, SaveIcon } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { saveAiSettings, testAiSettings, type AiProtocol, type AiSettingsInput } from "@/features/platform/api";
import { connectionAddress, connectionError } from "@/features/platform/ai-connection-form";
import { useAiSettingsQuery } from "@/features/platform/queries";
import { ResearchSettingsCard } from "@/features/quant-analysis/research-settings-card";

const protocols: { value: AiProtocol; label: string }[] = [
  { value: "auto", label: "自动检测（OpenAI 兼容）" },
  { value: "chat/completions", label: "Chat Completions" },
  { value: "responses", label: "Responses" },
  { value: "messages", label: "Anthropic Messages（Claude 原生）" },
];

type Draft = Partial<AiSettingsInput>;

export function AiModelSettingsView() {
  return (
    <div className="grid gap-3 xl:grid-cols-2 xl:items-start">
      <AiConnectionCard />
      <ResearchSettingsCard />
    </div>
  );
}

function AiConnectionCard() {
  const queryClient = useQueryClient();
  const settingsQuery = useAiSettingsQuery();
  const [selectedProvider, setSelectedProvider] = React.useState<string>();
  const [drafts, setDrafts] = React.useState<Record<string, Draft>>({});
  const [advanced, setAdvanced] = React.useState(false);
  const [status, setStatus] = React.useState<{ text: string; error?: boolean }>();
  const [discoveredModels, setDiscoveredModels] = React.useState<string[]>([]);
  const settings = settingsQuery.data;
  const provider = selectedProvider ?? settings?.provider ?? "custom";
  const preset = settings?.providers.find((item) => item.id === provider);
  const saved = settings?.profiles[provider];
  const draft = drafts[provider] ?? {};
  const custom = provider === "custom";
  const baseUrl = draft.baseUrl ?? saved?.baseUrl ?? preset?.baseUrl ?? "";
  const complexModel = draft.complexModel ?? saved?.complexModel ?? preset?.complexModel ?? "";
  const simpleModel = draft.simpleModel ?? saved?.simpleModel ?? preset?.simpleModel ?? "";
  const protocol = draft.protocol ?? saved?.protocol ?? preset?.protocol ?? "auto";
  const hasSavedKey = Boolean(saved?.hasApiKey && !draft.clearApiKey && connectionAddress(baseUrl) === connectionAddress(saved.baseUrl));
  const models = [...new Set([...(preset?.models ?? []), ...discoveredModels])];

  function updateDraft(patch: Draft) {
    setDrafts((current) => ({ ...current, [provider]: { ...current[provider], ...patch } }));
    setStatus(undefined);
    if ("baseUrl" in patch || "apiKey" in patch || "protocol" in patch) setDiscoveredModels([]);
  }

  const saveMutation = useMutation({
    mutationFn: saveAiSettings,
    onSuccess: (result) => {
      queryClient.setQueryData(["ai-settings"], result);
      setDrafts((current) => ({ ...current, [result.provider]: {} }));
      setStatus({ text: "设置已保存。" });
      if (!result.hasApiKey) setStatus({ text: "设置已保存；填入密钥后即可使用 AI。" });
    },
    onError: (error) => setStatus({ text: connectionError(error.message), error: true }),
  });
  const testMutation = useMutation({
    mutationFn: testAiSettings,
    onSuccess: (result) => {
      setDiscoveredModels(result.models ?? []);
      setStatus({ text: "连接成功，所选模型可以正常回复。记得保存设置。" });
    },
    onError: (error) => setStatus({ text: connectionError(error.message), error: true }),
  });
  const busy = saveMutation.isPending || testMutation.isPending;
  const input: AiSettingsInput = { provider, protocol, baseUrl, complexModel, simpleModel, apiKey: draft.apiKey || undefined, clearApiKey: draft.clearApiKey ?? false };
  const canTest = Boolean(baseUrl.trim() && complexModel.trim() && simpleModel.trim() && (draft.apiKey?.trim() || hasSavedKey));

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2"><BotIcon />AI 连接设置</CardTitle>
        <CardDescription>选择服务商，填入密钥，即可连接你的 AI。</CardDescription>
      </CardHeader>
      <CardContent>
        {settingsQuery.isError ? (
          <div className="grid gap-2" role="alert">
            <p className="text-sm text-destructive">无法读取 AI 设置，请确认本地服务已启动。</p>
            <Button variant="outline" onClick={() => void settingsQuery.refetch()}>重新加载</Button>
          </div>
        ) : !settings || !preset ? (
          <p className="text-sm text-muted-foreground" role="status">正在加载连接设置…</p>
        ) : (
          <fieldset disabled={busy} className="min-w-0">
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="ai-settings-provider">AI 服务商</FieldLabel>
                <Select value={provider} disabled={busy} onValueChange={(value) => {
                  if (!value) return;
                  setSelectedProvider(value);
                  setStatus(undefined);
                  setDiscoveredModels([]);
                  setAdvanced(false);
                }}>
                  <SelectTrigger id="ai-settings-provider" className="w-full"><SelectValue>{preset.label}</SelectValue></SelectTrigger>
                  <SelectContent>{settings.providers.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
                <FieldDescription>{custom ? "填写服务商提供的接口地址和密钥。" : "接口地址和模型已配好，只需填写此服务商的 API 密钥。"}</FieldDescription>
              </Field>
              {custom && (
                <Field>
                  <FieldLabel htmlFor="ai-settings-base-url">接口地址</FieldLabel>
                  <Input id="ai-settings-base-url" value={baseUrl} onChange={(event) => {
                    const nextUrl = event.target.value;
                    updateDraft({ baseUrl: nextUrl, ...(connectionAddress(nextUrl) !== connectionAddress(baseUrl) ? { apiKey: "" } : {}) });
                  }} placeholder="https://你的服务商地址/v1" autoComplete="off" spellCheck={false} />
                  <FieldDescription>支持基础地址，也支持以 /chat/completions、/responses 或 /messages 结尾的完整地址。</FieldDescription>
                </Field>
              )}
              <Field>
                <div className="flex items-center justify-between gap-2">
                  <FieldLabel htmlFor="ai-settings-api-key">API 密钥</FieldLabel>
                  {preset.keyUrl && <a href={preset.keyUrl} target="_blank" rel="noreferrer" className="text-xs text-primary underline underline-offset-4">获取密钥 ↗</a>}
                </div>
                <Input id="ai-settings-api-key" type="password" value={draft.apiKey ?? ""} onChange={(event) => updateDraft({ apiKey: event.target.value, clearApiKey: false })} placeholder={hasSavedKey ? "已保存，留空继续使用" : "粘贴此服务商的 API 密钥"} autoComplete="new-password" spellCheck={false} />
                <FieldDescription className="flex flex-wrap items-center gap-2">
                  {hasSavedKey && <Badge variant="secondary">密钥已保存</Badge>}
                  密钥保存在本机，各服务商分别保存。
                </FieldDescription>
              </Field>
              <div className="grid gap-3">
                <Button type="button" variant="ghost" className="w-fit px-0 text-muted-foreground" aria-expanded={advanced} aria-controls="ai-settings-advanced" onClick={() => setAdvanced(!advanced)}>
                  <ChevronDownIcon className={advanced ? "rotate-180" : ""} />高级设置（可选）
                </Button>
                {advanced && (
                  <div id="ai-settings-advanced" className="grid gap-4 rounded-lg border bg-muted/20 p-4">
                    {!custom && <p className="break-all text-xs text-muted-foreground">官方地址：{baseUrl}</p>}
                    <Field>
                      <FieldLabel htmlFor="ai-settings-protocol">接口协议</FieldLabel>
                      <Select value={protocol} disabled={busy || preset.protocols.length === 1} onValueChange={(value) => value && updateDraft({ protocol: value as AiProtocol })}>
                        <SelectTrigger id="ai-settings-protocol" className="w-full"><SelectValue>{protocols.find((item) => item.value === protocol)?.label}</SelectValue></SelectTrigger>
                        <SelectContent>{protocols.filter((item) => preset.protocols.includes(item.value)).map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                      </Select>
                      <FieldDescription>{custom ? "不确定时保持自动检测；服务商有明确要求时再修改。" : "已按官方接口配置，一般无需修改。"}</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="ai-settings-complex-model">复杂任务模型</FieldLabel>
                      <Input id="ai-settings-complex-model" list="ai-settings-models" value={complexModel} onChange={(event) => updateDraft({ complexModel: event.target.value })} autoComplete="off" />
                      <FieldDescription>用于深度研究和 AI 建议，可选择或输入模型名称。</FieldDescription>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="ai-settings-simple-model">简单任务模型</FieldLabel>
                      <Input id="ai-settings-simple-model" list="ai-settings-models" value={simpleModel} onChange={(event) => updateDraft({ simpleModel: event.target.value })} autoComplete="off" />
                      <FieldDescription>用于常规分析；识别持仓截图时需选择支持图片的模型。</FieldDescription>
                    </Field>
                    <datalist id="ai-settings-models">{models.map((model) => <option key={model} value={model} />)}</datalist>
                    {preset.textOnlyModels.includes(simpleModel) && <p className="text-xs text-muted-foreground">当前简单任务模型仅支持文字，不能识别持仓截图。</p>}
                    {(saved?.hasApiKey || draft.clearApiKey) && (
                      <Field orientation="horizontal">
                        <Switch id="ai-settings-clear-key" checked={draft.clearApiKey ?? false} onCheckedChange={(checked) => updateDraft({ clearApiKey: checked, apiKey: "" })} />
                        <FieldLabel htmlFor="ai-settings-clear-key">保存时清除此服务商的密钥</FieldLabel>
                      </Field>
                    )}
                  </div>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <Button variant="outline" onClick={() => testMutation.mutate(input)} disabled={busy || !canTest}>
                  <KeyRoundIcon data-icon="inline-start" />{testMutation.isPending ? "正在测试…" : "测试连接"}
                </Button>
                <Button onClick={() => saveMutation.mutate(input)} disabled={busy || !baseUrl.trim() || !complexModel.trim() || !simpleModel.trim()}>
                  <SaveIcon data-icon="inline-start" />{saveMutation.isPending ? "正在保存…" : "保存设置"}
                </Button>
              </div>
              {status && <p role={status.error ? "alert" : "status"} className={`rounded-lg bg-muted/50 p-3 text-sm ${status.error ? "text-destructive" : "text-muted-foreground"}`}>{status.text}</p>}
            </FieldGroup>
          </fieldset>
        )}
      </CardContent>
    </Card>
  );
}
