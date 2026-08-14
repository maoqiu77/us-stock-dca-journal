"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  BotIcon,
  CoinsIcon,
  PencilIcon,
  FileInputIcon,
  FolderLockIcon,
  GitBranchIcon,
  KeyRoundIcon,
  PlusIcon,
  SaveIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ToggleGroup,
  ToggleGroupItem,
} from "@/components/ui/toggle-group";
import { Textarea } from "@/components/ui/textarea";
import { saveAiSettings, testAiSettings } from "@/features/platform/api";
import { useAiSettingsQuery } from "@/features/platform/queries";
import {
  formatMoney,
  formatRatio,
  formatShares,
  formatTradeNumberInput,
  normalizeTicker,
  parseTradeNumberInput,
  parseStockPoolText,
  todayIsoDate,
  updateTradeCalculation,
  type PositionPlan,
  type TradeCalculationField,
  type TradeAction,
  type TradeRecord,
} from "@/features/platform/trading-data";
import { useTradingData } from "@/features/platform/trading-data-context";

type TradeDraft = Omit<TradeRecord, "id" | "shares" | "unitPrice" | "amount"> & {
  shares: string;
  unitPrice: string;
  amount: string;
};
type ImportedTradeDraft = Omit<TradeRecord, "id" | "shares"> & {
  shares?: number;
};
type TradeImportPreview = {
  fileName: string;
  trades: ImportedTradeDraft[];
  errors: string[];
};

const emptyPosition: PositionPlan = {
  ticker: "",
  targetWeight: 0.1,
  assetType: "STOCK",
  takeProfitPct: 0.2,
  stopLossPct: 0.08,
  purchaseDate: "",
};

const initialTradeDraft: TradeDraft = {
  date: todayIsoDate(),
  ticker: "",
  action: "买入" as TradeAction,
  shares: "",
  unitPrice: "",
  amount: "",
  note: "",
};

export function DataManagementView() {
  const queryClient = useQueryClient();
  const [files, setFiles] = React.useState<string[]>([]);
  const [tradeImportPreview, setTradeImportPreview] = React.useState<
    TradeImportPreview[]
  >([]);
  const [importResult, setImportResult] = React.useState("");
  const [positionDraft, setPositionDraft] =
    React.useState<PositionPlan>(emptyPosition);
  const [tradeDraft, setTradeDraft] = React.useState(initialTradeDraft);
  const [recentTradeFields, setRecentTradeFields] = React.useState<
    TradeCalculationField[]
  >([]);
  const [editingTradeId, setEditingTradeId] = React.useState<string | null>(null);
  const {
    state,
    holdingCost,
    cash,
    updateAccount,
    updateStockPoolText,
    upsertPosition,
    removePosition,
    addTrade,
    importTrades,
    updateTrade,
    removeTrade,
    validationIssues,
    storageStatus,
  } = useTradingData();
  const aiSettingsQuery = useAiSettingsQuery();
  const [aiDraft, setAiDraft] = React.useState<{
    baseUrl?: string;
    model?: string;
    apiKey: string;
    clearApiKey: boolean;
  }>({
    apiKey: "",
    clearApiKey: false,
  });
  const [aiTestMessage, setAiTestMessage] = React.useState("");
  const aiSettingsMutation = useMutation({
    mutationFn: saveAiSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ai-settings"] });
      setAiDraft({
        apiKey: "",
        clearApiKey: false,
      });
    },
  });
  const aiSettingsTestMutation = useMutation({
    mutationFn: testAiSettings,
    onSuccess: (result) => {
      const endpoint = result.generationEndpoint
        ? `（${result.generationEndpoint}）`
        : "";
      setAiTestMessage(
        `${result.message} 模型数：${result.modelCount || "--"}。生成接口：${
          result.responsesOk ? `可用${endpoint}` : "不可用"
        }。`
      );
    },
    onError: (error) => {
      setAiTestMessage(error.message);
    },
  });
  const tradeAmount = parseTradeNumberInput(tradeDraft.amount);
  const tradeUnitPrice = parseTradeNumberInput(tradeDraft.unitPrice);
  const tradeShares = parseTradeNumberInput(tradeDraft.shares);
  const isEditingTrade = Boolean(editingTradeId);
  const stockPoolText = state.stockPool.join("\n");
  const stockPoolPreview = parseStockPoolText(stockPoolText);
  const aiBaseUrlValue = aiDraft.baseUrl ?? aiSettingsQuery.data?.baseUrl ?? "";
  const aiModelValue = aiDraft.model ?? aiSettingsQuery.data?.model ?? "";
  const importableTrades = React.useMemo(
    () => tradeImportPreview.flatMap((preview) => preview.trades),
    [tradeImportPreview]
  );
  const importErrors = React.useMemo(
    () => tradeImportPreview.flatMap((preview) => preview.errors),
    [tradeImportPreview]
  );
  const handleTradeCalculationChange = (
    field: TradeCalculationField,
    value: string
  ) => {
    const result = updateTradeCalculation(
      tradeDraft,
      field,
      value,
      recentTradeFields
    );
    setTradeDraft((current) => ({ ...current, ...result.draft }));
    setRecentTradeFields(result.recentFields);
  };
  const handleTradeFiles = React.useCallback(async (fileList: FileList | null) => {
    const selectedFiles = Array.from(fileList ?? []);
    setFiles(selectedFiles.map((file) => file.name));
    setImportResult("");
    const previews = await Promise.all(selectedFiles.map(readTradeImportFile));
    setTradeImportPreview(previews);
  }, []);

  return (
    <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <CoinsIcon />
              账户与股票池
            </CardTitle>
            <CardDescription>
              总资产、股票池会直接影响信号和 AI 上下文
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="data-total-assets">总资产</FieldLabel>
                <Input
                  id="data-total-assets"
                  type="number"
                  min="0"
                  step="100"
                  value={state.account.totalAssets}
                  onChange={(event) =>
                    updateAccount({ totalAssets: Number(event.target.value) })
                  }
                />
                <FieldDescription>
                  现金按总资产减持仓成本推算，市值和浮盈不反推可用现金。
                </FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="data-stock-pool">股票池</FieldLabel>
                <Textarea
                  id="data-stock-pool"
                  className="min-h-32 font-mono"
                  value={stockPoolText}
                  onChange={(event) => updateStockPoolText(event.target.value)}
                />
                <FieldDescription>
                  每行一个标的。当前解析 {stockPoolPreview.length} 个标的。
                </FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <SlidersHorizontalIcon />
              持仓目标
            </CardTitle>
            <CardDescription>编辑每个标的的目标仓位、类型、止盈和止损线</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="data-position-ticker">标的</FieldLabel>
                  <Input
                    id="data-position-ticker"
                    value={positionDraft.ticker}
                    onChange={(event) =>
                      setPositionDraft((current) => ({
                        ...current,
                        ticker: event.target.value.toUpperCase(),
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="data-asset-type">类型</FieldLabel>
                  <Select
                    value={positionDraft.assetType}
                    onValueChange={(value) =>
                      setPositionDraft((current) => ({
                        ...current,
                        assetType: value === "ETF" ? "ETF" : "STOCK",
                      }))
                    }
                  >
                    <SelectTrigger id="data-asset-type" className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="STOCK">STOCK</SelectItem>
                      <SelectItem value="ETF">ETF</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <RatioInput
                  id="data-target-weight"
                  label="目标仓位"
                  value={positionDraft.targetWeight}
                  onChange={(value) =>
                    setPositionDraft((current) => ({
                      ...current,
                      targetWeight: value,
                    }))
                  }
                />
                <RatioInput
                  id="data-take-profit"
                  label="止盈线"
                  value={positionDraft.takeProfitPct}
                  onChange={(value) =>
                    setPositionDraft((current) => ({
                      ...current,
                      takeProfitPct: value,
                    }))
                  }
                />
                <RatioInput
                  id="data-stop-loss"
                  label="止损线"
                  value={positionDraft.stopLossPct}
                  onChange={(value) =>
                    setPositionDraft((current) => ({
                      ...current,
                      stopLossPct: value,
                    }))
                  }
                />
                <Field>
                  <FieldLabel htmlFor="data-purchase-date">首次买入日期</FieldLabel>
                  <Input
                    id="data-purchase-date"
                    type="date"
                    value={positionDraft.purchaseDate}
                    onChange={(event) =>
                      setPositionDraft((current) => ({
                        ...current,
                        purchaseDate: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <Button
                onClick={() => {
                  upsertPosition(positionDraft);
                  setPositionDraft(emptyPosition);
                }}
                disabled={!positionDraft.ticker.trim()}
              >
                <SaveIcon data-icon="inline-start" />
                保存持仓目标
              </Button>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>持仓目标列表</CardTitle>
            <CardDescription>
              当前持仓股数和成本由交易流水推导，目标和风控线在这里维护
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="min-w-[820px]">
              <TableHeader>
                <TableRow>
                  <TableHead>标的</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead className="text-right">目标仓位</TableHead>
                  <TableHead className="text-right">止盈线</TableHead>
                  <TableHead className="text-right">止损线</TableHead>
                  <TableHead>首次买入</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.positions.map((position) => (
                  <TableRow key={position.ticker}>
                    <TableCell className="font-medium">{position.ticker}</TableCell>
                    <TableCell>{position.assetType}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRatio(position.targetWeight)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRatio(position.takeProfitPct)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRatio(position.stopLossPct)}
                    </TableCell>
                    <TableCell>{position.purchaseDate || "--"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setPositionDraft(position)}
                        >
                          编辑
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removePosition(position.ticker)}
                        >
                          <Trash2Icon />
                          <span className="sr-only">删除{position.ticker}</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <PlusIcon />
              交易录入
            </CardTitle>
            <CardDescription>
              交易金额、单支成本和股数任填两项，自动计算第三项
            </CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-3 md:grid-cols-3">
                <Field>
                  <FieldLabel htmlFor="trade-date">日期</FieldLabel>
                  <Input
                    id="trade-date"
                    type="date"
                    value={tradeDraft.date}
                    onChange={(event) =>
                      setTradeDraft((current) => ({
                        ...current,
                        date: event.target.value,
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-ticker">标的</FieldLabel>
                  <Input
                    id="trade-ticker"
                    value={tradeDraft.ticker}
                    onChange={(event) =>
                      setTradeDraft((current) => ({
                        ...current,
                        ticker: event.target.value.toUpperCase(),
                      }))
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-action">动作</FieldLabel>
                  <ToggleGroup
                    value={[tradeDraft.action]}
                    onValueChange={(value) => {
                      const nextValue = Array.isArray(value) ? value[0] : value;
                      if (nextValue === "买入" || nextValue === "卖出") {
                        setTradeDraft((current) => ({
                          ...current,
                          action: nextValue,
                        }));
                      }
                    }}
                    variant="outline"
                    size="sm"
                    className="w-fit"
                  >
                    <ToggleGroupItem
                      value="买入"
                      aria-label="买入"
                      className="data-[state=on]:border-trade-buy/30 data-[state=on]:bg-trade-buy/10 data-[state=on]:text-trade-buy data-[state=on]:hover:bg-trade-buy/15"
                    >
                      买入
                    </ToggleGroupItem>
                    <ToggleGroupItem
                      value="卖出"
                      aria-label="卖出"
                      className="data-[state=on]:border-trade-sell/30 data-[state=on]:bg-trade-sell/10 data-[state=on]:text-trade-sell data-[state=on]:hover:bg-trade-sell/15"
                    >
                      卖出
                    </ToggleGroupItem>
                  </ToggleGroup>
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-amount">交易金额</FieldLabel>
                  <Input
                    id="trade-amount"
                    type="number"
                    min="0"
                    step="0.0001"
                    value={tradeDraft.amount}
                    onChange={(event) =>
                      handleTradeCalculationChange("amount", event.target.value)
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-unit-price">单支成本</FieldLabel>
                  <Input
                    id="trade-unit-price"
                    type="number"
                    min="0"
                    step="0.0001"
                    value={tradeDraft.unitPrice}
                    onChange={(event) =>
                      handleTradeCalculationChange(
                        "unitPrice",
                        event.target.value
                      )
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-shares">股数</FieldLabel>
                  <Input
                    id="trade-shares"
                    type="number"
                    min="0"
                    step="0.000001"
                    value={tradeDraft.shares}
                    onChange={(event) =>
                      handleTradeCalculationChange("shares", event.target.value)
                    }
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="trade-note">备注</FieldLabel>
                  <Input
                    id="trade-note"
                    value={tradeDraft.note}
                    onChange={(event) =>
                      setTradeDraft((current) => ({
                        ...current,
                        note: event.target.value,
                      }))
                    }
                  />
                </Field>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-3 rounded-lg bg-muted/50 p-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => {
                      const normalizedTradeDraft = {
                        ...tradeDraft,
                        amount: tradeAmount,
                        unitPrice: tradeUnitPrice,
                        shares: tradeShares,
                      };
                      if (editingTradeId) {
                        updateTrade(editingTradeId, normalizedTradeDraft);
                      } else {
                        addTrade(normalizedTradeDraft);
                      }
                      setTradeDraft(initialTradeDraft);
                      setRecentTradeFields([]);
                      setEditingTradeId(null);
                    }}
                    disabled={
                      !tradeDraft.ticker.trim() ||
                      tradeAmount <= 0 ||
                      tradeUnitPrice <= 0 ||
                      tradeShares <= 0
                    }
                  >
                    <PlusIcon data-icon="inline-start" />
                    {isEditingTrade ? "保存修改" : "添加流水"}
                  </Button>
                  {isEditingTrade ? (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setTradeDraft(initialTradeDraft);
                        setRecentTradeFields([]);
                        setEditingTradeId(null);
                      }}
                    >
                      <XIcon data-icon="inline-start" />
                      取消编辑
                    </Button>
                  ) : null}
                </div>
              </div>
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle>交易流水</CardTitle>
            <CardDescription>
              旧项目字段：date、ticker、action、shares、unit_price、amount、note
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>日期</TableHead>
                  <TableHead>标的</TableHead>
                  <TableHead>动作</TableHead>
                  <TableHead className="text-right">股数</TableHead>
                  <TableHead className="text-right">单支成本</TableHead>
                  <TableHead className="text-right">金额</TableHead>
                  <TableHead>备注</TableHead>
                  <TableHead className="text-right">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {state.trades.map((trade) => (
                  <TableRow key={trade.id}>
                    <TableCell>{trade.date}</TableCell>
                    <TableCell className="font-medium">{trade.ticker}</TableCell>
                    <TableCell>
                      <Badge variant={trade.action === "买入" ? "buy" : "sell"}>
                        {trade.action}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatShares(trade.shares)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(trade.unitPrice)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(trade.amount)}
                    </TableCell>
                    <TableCell className="max-w-56 truncate">
                      {trade.note || "--"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="outline"
                          size="icon-sm"
                          onClick={() => {
                            setTradeDraft({
                              date: trade.date,
                              ticker: trade.ticker,
                              action: trade.action,
                              shares: formatTradeNumberInput(trade.shares, 6),
                              unitPrice: formatTradeNumberInput(trade.unitPrice),
                              amount: formatTradeNumberInput(trade.amount),
                              note: trade.note,
                            });
                            setRecentTradeFields([]);
                            setEditingTradeId(trade.id);
                          }}
                        >
                          <PencilIcon />
                          <span className="sr-only">编辑流水</span>
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => {
                            removeTrade(trade.id);
                            if (editingTradeId === trade.id) {
                              setTradeDraft(initialTradeDraft);
                              setRecentTradeFields([]);
                              setEditingTradeId(null);
                            }
                          }}
                        >
                          <Trash2Icon />
                          <span className="sr-only">删除流水</span>
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
      <div className="flex flex-col gap-3">
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <BotIcon />
              AI 连接设置
            </CardTitle>
            <CardDescription>OpenAI-compatible URL、模型和本地密钥</CardDescription>
            <Badge variant={aiSettingsQuery.data?.hasApiKey ? "secondary" : "outline"}>
              {aiSettingsQuery.data?.hasApiKey ? "密钥已保存" : "未配置密钥"}
            </Badge>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="data-ai-base-url">Base URL</FieldLabel>
                <Input
                  id="data-ai-base-url"
                  value={aiBaseUrlValue}
                  onChange={(event) =>
                    setAiDraft((current) => ({
                      ...current,
                      baseUrl: event.target.value,
                    }))
                  }
                  placeholder="https://api.openai.com/v1"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="data-ai-model">模型</FieldLabel>
                <Input
                  id="data-ai-model"
                  value={aiModelValue}
                  onChange={(event) =>
                    setAiDraft((current) => ({
                      ...current,
                      model: event.target.value,
                    }))
                  }
                  placeholder="gpt-5.1"
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="data-ai-api-key">API Key</FieldLabel>
                <Input
                  id="data-ai-api-key"
                  type="password"
                  value={aiDraft.apiKey}
                  onChange={(event) =>
                    setAiDraft((current) => ({
                      ...current,
                      apiKey: event.target.value,
                    }))
                  }
                  placeholder={
                    aiSettingsQuery.data?.hasApiKey
                      ? aiSettingsQuery.data.apiKeyMasked
                      : "sk-..."
                  }
                />
                <FieldDescription>
                  留空保存不会覆盖已保存密钥；接口只返回掩码，不返回原文。
                </FieldDescription>
              </Field>
              <Field orientation="horizontal">
                <Switch
                  checked={aiDraft.clearApiKey}
                  onCheckedChange={(checked) =>
                    setAiDraft((current) => ({
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
              <Button
                onClick={() =>
                  aiSettingsMutation.mutate({
                    baseUrl: aiBaseUrlValue,
                    model: aiModelValue,
                    apiKey: aiDraft.apiKey || undefined,
                    clearApiKey: aiDraft.clearApiKey,
                  })
                }
                disabled={aiSettingsMutation.isPending}
              >
                {aiSettingsMutation.isPending ? (
                  <KeyRoundIcon data-icon="inline-start" />
                ) : (
                  <SaveIcon data-icon="inline-start" />
                )}
                {aiSettingsMutation.isPending ? "保存中" : "保存 AI 设置"}
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  aiSettingsTestMutation.mutate({
                    baseUrl: aiBaseUrlValue,
                    model: aiModelValue,
                    apiKey: aiDraft.apiKey || undefined,
                    clearApiKey: false,
                  })
                }
                disabled={aiSettingsTestMutation.isPending}
              >
                <KeyRoundIcon data-icon="inline-start" />
                {aiSettingsTestMutation.isPending ? "测试中" : "测试 AI 连接"}
              </Button>
              {aiTestMessage ? (
                <div className="rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                  {aiTestMessage}
                </div>
              ) : null}
            </FieldGroup>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <CoinsIcon />
              账户口径
            </CardTitle>
            <CardDescription>总资产、持仓成本和现金由本地流水驱动</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell>总资产</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(state.account.totalAssets)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>持仓成本</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(holdingCost)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>可用现金</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatMoney(cash)}
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>交易流水</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {state.trades.length} 条
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <FileInputIcon />
              本地导入
            </CardTitle>
            <CardDescription>CSV、XLSX、交易流水、持仓快照</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="local-files">选择文件</FieldLabel>
                <Input
                  id="local-files"
                  type="file"
                  multiple
                  onChange={(event) => {
                    void handleTradeFiles(event.target.files);
                    event.currentTarget.value = "";
                  }}
                />
                <FieldDescription>
                  支持 CSV/TSV 交易流水：date、ticker、action、shares、unit_price、amount、note；XLSX 后续接入。
                </FieldDescription>
              </Field>
            </FieldGroup>
            <div className="mt-4 rounded-lg bg-muted/50 p-3">
              <div className="text-sm font-medium">导入队列</div>
              <div className="mt-2 flex flex-col gap-2">
                {files.length ? (
                  files.map((file) => (
                    <div key={file} className="text-sm text-muted-foreground">
                      {file}
                    </div>
                  ))
                ) : (
                  <div className="text-sm text-muted-foreground">暂无文件</div>
                )}
              </div>
            </div>
            {tradeImportPreview.length ? (
              <div className="mt-3 grid gap-3 rounded-lg bg-muted/50 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm">
                    有效交易{" "}
                    <span className="font-medium tabular-nums">
                      {importableTrades.length}
                    </span>{" "}
                    条，错误{" "}
                    <span className="font-medium tabular-nums">
                      {importErrors.length}
                    </span>{" "}
                    条
                  </div>
                  <Button
                    size="sm"
                    onClick={() => {
                      importTrades(importableTrades);
                      setImportResult(`已导入 ${importableTrades.length} 条交易流水。`);
                      setTradeImportPreview([]);
                      setFiles([]);
                    }}
                    disabled={!importableTrades.length}
                  >
                    <UploadIcon data-icon="inline-start" />
                    导入有效交易
                  </Button>
                </div>
                {importableTrades.length ? (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>日期</TableHead>
                        <TableHead>标的</TableHead>
                        <TableHead>动作</TableHead>
                        <TableHead className="text-right">股数</TableHead>
                        <TableHead className="text-right">单支成本</TableHead>
                        <TableHead className="text-right">金额</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {importableTrades.slice(0, 5).map((trade, index) => (
                        <TableRow key={`${trade.date}-${trade.ticker}-${index}`}>
                          <TableCell>{trade.date}</TableCell>
                          <TableCell className="font-medium">{trade.ticker}</TableCell>
                          <TableCell>{trade.action}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatShares(trade.shares)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(trade.unitPrice)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(trade.amount)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : null}
                {importableTrades.length > 5 ? (
                  <div className="text-xs text-muted-foreground">
                    仅预览前 5 条；导入会写入全部有效交易。
                  </div>
                ) : null}
                {importErrors.length ? (
                  <div className="grid gap-1 text-xs text-muted-foreground">
                    {importErrors.slice(0, 6).map((error) => (
                      <div key={error}>{error}</div>
                    ))}
                    {importErrors.length > 6 ? <div>...</div> : null}
                  </div>
                ) : null}
              </div>
            ) : null}
            {importResult ? (
              <div className="mt-3 rounded-lg bg-muted/50 p-3 text-sm text-muted-foreground">
                {importResult}
              </div>
            ) : null}
          </CardContent>
        </Card>
        <StorageCard
          icon={<GitBranchIcon />}
          title="可提交模板"
          path="storage/templates"
          badge="git"
        />
        <StorageCard
          icon={<FolderLockIcon />}
          title="本地私有数据"
          path="storage/local/app.db"
          badge={storageStatus === "api" ? "sqlite" : "fallback"}
        />
        <Card>
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <ShieldCheckIcon />
              安全检查
            </CardTitle>
            <CardDescription>提交前运行 public safety check</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableBody>
                <TableRow>
                  <TableCell>脚本</TableCell>
                  <TableCell className="text-right font-mono text-xs">
                    npm run check:public-safety
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>校验问题</TableCell>
                  <TableCell className="text-right">
                    {validationIssues.length}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RatioInput({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        type="number"
        min="0"
        max="100"
        step="1"
        value={percentInputValue(value)}
        onChange={(event) => onChange(Number(event.target.value) / 100)}
      />
    </Field>
  );
}

function StorageCard({
  icon,
  title,
  path,
  badge,
}: {
  icon: React.ReactNode;
  title: string;
  path: string;
  badge: string;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {icon}
          {title}
        </CardTitle>
        <CardDescription className="font-mono">{path}</CardDescription>
        <Badge variant="secondary">{badge}</Badge>
      </CardHeader>
    </Card>
  );
}

function percentInputValue(value: number) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number((value * 100).toFixed(4));
}

async function readTradeImportFile(file: File): Promise<TradeImportPreview> {
  if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
    return {
      fileName: file.name,
      trades: [],
      errors: [`${file.name}：当前仅支持 CSV/TSV 文本导入。`],
    };
  }

  const text = await file.text();
  return parseTradeCsv(file.name, text);
}

function parseTradeCsv(fileName: string, text: string): TradeImportPreview {
  const delimiter = firstLine(text).includes("\t") ? "\t" : ",";
  const rows = parseDelimitedRows(text, delimiter).filter((row) =>
    row.some((cell) => cell.trim())
  );
  if (rows.length < 2) {
    return { fileName, trades: [], errors: [`${fileName}：没有可导入的数据行。`] };
  }

  const header = rows[0].map(normalizeHeader);
  const columnByName = buildColumnMap(header);
  const trades: ImportedTradeDraft[] = [];
  const errors: string[] = [];

  rows.slice(1).forEach((row, index) => {
    const rowNumber = index + 2;
    const raw = (name: TradeImportColumn) => row[columnByName[name] ?? -1]?.trim() ?? "";
    const date = normalizeCsvDate(raw("date"));
    const ticker = normalizeTicker(raw("ticker"));
    const action = normalizeTradeAction(raw("action"));
    const shares = parseCsvNumber(raw("shares"));
    let unitPrice = parseCsvNumber(raw("unitPrice"));
    let amount = parseCsvNumber(raw("amount"));
    const note = raw("note");

    if (!date || !ticker || !action) {
      errors.push(`${fileName} 第 ${rowNumber} 行：缺少日期、标的或动作。`);
      return;
    }
    if (amount <= 0 && shares > 0 && unitPrice > 0) {
      amount = shares * unitPrice;
    }
    if (unitPrice <= 0 && shares > 0 && amount > 0) {
      unitPrice = amount / shares;
    }
    if (amount <= 0 || unitPrice <= 0) {
      errors.push(`${fileName} 第 ${rowNumber} 行：金额和单支成本无法计算。`);
      return;
    }

    trades.push({
      date,
      ticker,
      action,
      unitPrice,
      amount,
      shares: shares > 0 ? shares : undefined,
      note,
    });
  });

  return { fileName, trades, errors };
}

type TradeImportColumn =
  | "date"
  | "ticker"
  | "action"
  | "shares"
  | "unitPrice"
  | "amount"
  | "note";

const tradeColumnAliases: Record<TradeImportColumn, string[]> = {
  date: ["date", "日期", "trade_date", "交易日期"],
  ticker: ["ticker", "symbol", "标的", "代码"],
  action: ["action", "side", "动作", "操作", "买卖"],
  shares: ["shares", "quantity", "qty", "股数", "数量"],
  unitPrice: ["unitprice", "unit_price", "price", "成交价", "单支成本", "单价"],
  amount: ["amount", "value", "金额", "交易金额", "成交金额"],
  note: ["note", "notes", "备注", "说明"],
};

function buildColumnMap(header: string[]) {
  return (Object.keys(tradeColumnAliases) as TradeImportColumn[]).reduce<
    Partial<Record<TradeImportColumn, number>>
  >((output, column) => {
    const aliases = new Set(tradeColumnAliases[column].map(normalizeHeader));
    const index = header.findIndex((value) => aliases.has(value));
    if (index >= 0) {
      output[column] = index;
    }
    return output;
  }, {});
}

function parseDelimitedRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      cell += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell);
  rows.push(row);
  return rows;
}

function firstLine(text: string) {
  return text.split(/\r?\n/, 1)[0] ?? "";
}

function normalizeHeader(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, "");
}

function normalizeCsvDate(value: string) {
  const match = value.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (!match) {
    return "";
  }
  return `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
}

function normalizeTradeAction(value: string): TradeAction | "" {
  const normalized = value.trim().toLowerCase();
  if (normalized.includes("卖") || normalized === "sell" || normalized === "sold") {
    return "卖出";
  }
  if (normalized.includes("买") || normalized === "buy" || normalized === "bought") {
    return "买入";
  }
  return "";
}

function parseCsvNumber(value: string) {
  const parsed = Number(value.replace(/[$,\s]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
