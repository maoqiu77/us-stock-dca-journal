"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { BotIcon, KeyRoundIcon, SaveIcon } from "lucide-react";
import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { saveAiSettings, testAiSettings } from "@/features/platform/api";
import { useAiSettingsQuery } from "@/features/platform/queries";
import { ResearchSettingsCard } from "@/features/quant-analysis/research-settings-card";

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
  const [draft, setDraft] = React.useState<{
    baseUrl?: string;
    model?: string;
    apiKey: string;
    clearApiKey: boolean;
  }>({
    apiKey: "",
    clearApiKey: false,
  });
  const [message, setMessage] = React.useState("");
  const baseUrl = draft.baseUrl ?? settingsQuery.data?.baseUrl ?? "";
  const model = draft.model ?? settingsQuery.data?.model ?? "";
  const saveMutation = useMutation({
    mutationFn: saveAiSettings,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
      setDraft({ apiKey: "", clearApiKey: false });
      setMessage("AI 设置已保存到本地。");
    },
    onError: (error) => setMessage(error.message),
  });
  const testMutation = useMutation({
    mutationFn: testAiSettings,
    onSuccess: (result) => {
      const endpoint = result.generationEndpoint
        ? `（${result.generationEndpoint}）`
        : "";
      setMessage(
        `${result.message} 模型数：${result.modelCount || "--"}。生成接口：${
          result.responsesOk ? `可用${endpoint}` : "不可用"
        }。`
      );
    },
    onError: (error) => setMessage(error.message),
  });

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <BotIcon />
          AI 连接设置
        </CardTitle>
        <CardDescription>OpenAI-compatible URL、模型和本地密钥</CardDescription>
        <Badge variant={settingsQuery.data?.hasApiKey ? "secondary" : "outline"}>
          {settingsQuery.data?.hasApiKey ? "密钥已保存" : "未配置密钥"}
        </Badge>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="ai-settings-base-url">Base URL</FieldLabel>
            <Input
              id="ai-settings-base-url"
              value={baseUrl}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  baseUrl: event.target.value,
                }))
              }
              placeholder="https://api.openai.com/v1"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ai-settings-model">模型</FieldLabel>
            <Input
              id="ai-settings-model"
              value={model}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  model: event.target.value,
                }))
              }
              placeholder="gpt-5.1"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="ai-settings-api-key">API Key</FieldLabel>
            <Input
              id="ai-settings-api-key"
              type="password"
              value={draft.apiKey}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  apiKey: event.target.value,
                }))
              }
              placeholder={
                settingsQuery.data?.hasApiKey
                  ? settingsQuery.data.apiKeyMasked
                  : "sk-..."
              }
            />
            <FieldDescription>
              留空保存不会覆盖已保存密钥；接口只返回掩码，不返回原文。
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Switch
              checked={draft.clearApiKey}
              onCheckedChange={(checked) =>
                setDraft((current) => ({
                  ...current,
                  clearApiKey: checked,
                  apiKey: checked ? "" : current.apiKey,
                }))
              }
              aria-label="清空 AI 密钥"
            />
            <FieldContent>
              <FieldTitle>清空已保存密钥</FieldTitle>
              <FieldDescription>
                只清除 storage/local/app.db 中的本地密钥。
              </FieldDescription>
            </FieldContent>
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              onClick={() =>
                saveMutation.mutate({
                  baseUrl,
                  model,
                  apiKey: draft.apiKey || undefined,
                  clearApiKey: draft.clearApiKey,
                })
              }
              disabled={saveMutation.isPending}
            >
              <SaveIcon data-icon="inline-start" />
              {saveMutation.isPending ? "保存中" : "保存 AI 设置"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                testMutation.mutate({
                  baseUrl,
                  model,
                  apiKey: draft.apiKey || undefined,
                  clearApiKey: false,
                })
              }
              disabled={testMutation.isPending}
            >
              <KeyRoundIcon data-icon="inline-start" />
              {testMutation.isPending ? "测试中" : "测试 AI 连接"}
            </Button>
          </div>
          {message ? (
            <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
              {message}
            </div>
          ) : null}
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
