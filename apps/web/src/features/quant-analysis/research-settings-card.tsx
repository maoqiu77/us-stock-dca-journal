"use client";

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DatabaseZapIcon, KeyRoundIcon, SaveIcon } from "lucide-react";

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
import {
  fetchResearchSettings,
  saveResearchSettings,
  testFredConnection,
} from "./api";

export function ResearchSettingsCard() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["research-settings"],
    queryFn: fetchResearchSettings,
  });
  const [fredApiKey, setFredApiKey] = React.useState("");
  const [clearFredApiKey, setClearFredApiKey] = React.useState(false);
  const [message, setMessage] = React.useState("");
  const saveMutation = useMutation({
    mutationFn: saveResearchSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(["research-settings"], settings);
      setFredApiKey("");
      setClearFredApiKey(false);
      setMessage("FRED 设置已保存到本地。");
    },
    onError: (error) => setMessage(error.message),
  });
  const testMutation = useMutation({
    mutationFn: testFredConnection,
    onSuccess: (result) => setMessage(result.message),
    onError: (error) => setMessage(error.message),
  });

  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <DatabaseZapIcon />
          研究数据设置
        </CardTitle>
        <CardDescription>FRED 宏观序列的本地访问密钥</CardDescription>
        <Badge variant={settingsQuery.data?.hasFredApiKey ? "secondary" : "outline"}>
          {settingsQuery.data?.hasFredApiKey ? "FRED 已配置" : "FRED 未配置"}
        </Badge>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="research-fred-key">FRED API Key</FieldLabel>
            <Input
              id="research-fred-key"
              type="password"
              value={fredApiKey}
              onChange={(event) => setFredApiKey(event.target.value)}
              placeholder={settingsQuery.data?.fredApiKeyMasked || "FRED API Key"}
            />
            <FieldDescription>
              留空不会覆盖已保存密钥；接口只返回掩码。
            </FieldDescription>
          </Field>
          <Field orientation="horizontal">
            <Switch
              checked={clearFredApiKey}
              onCheckedChange={(checked) => {
                setClearFredApiKey(checked);
                if (checked) setFredApiKey("");
              }}
              aria-label="清空 FRED 密钥"
            />
            <FieldContent>
              <FieldTitle>清空已保存密钥</FieldTitle>
              <FieldDescription>只清除本地数据库中的 FRED Key。</FieldDescription>
            </FieldContent>
          </Field>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              onClick={() =>
                saveMutation.mutate({
                  fredApiKey: fredApiKey || undefined,
                  clearFredApiKey,
                })
              }
              disabled={saveMutation.isPending}
            >
              <SaveIcon data-icon="inline-start" />
              {saveMutation.isPending ? "保存中" : "保存 FRED 设置"}
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                testMutation.mutate({ fredApiKey: fredApiKey || undefined })
              }
              disabled={testMutation.isPending}
            >
              <KeyRoundIcon data-icon="inline-start" />
              {testMutation.isPending ? "测试中" : "测试 FRED 连接"}
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
