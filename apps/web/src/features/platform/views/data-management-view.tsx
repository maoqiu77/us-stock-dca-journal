"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import * as React from "react";
import {
  BotIcon,
  CoinsIcon,
  PencilIcon,
  FolderLockIcon,
  GitBranchIcon,
  KeyRoundIcon,
  PlusIcon,
  SaveIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
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
  formatShares,
  formatTradeNumberInput,
  parseTradeNumberInput,
  parseStockPoolText,
  sortPositionPlans,
  todayIsoDate,
  updateTradeCalculation,
  type PositionPlan,
  type TradeCalculationField,
  type TradeAction,
  type TradeRecord,
} from "@/features/platform/trading-data";
import { useTradingData } from "@/features/platform/trading-data-context";
import { PositionScreenshotImport } from "@/features/platform/views/position-screenshot-import";

type TradeDraft = Omit<TradeRecord, "id" | "shares" | "unitPrice" | "amount"> & {
  shares: string;
  unitPrice: string;
  amount: string;
};
const emptyPosition: PositionPlan = {
  ticker: "",
  targetWeight: 0,
  assetType: "STOCK",
  takeProfitPct: 0,
  stopLossPct: 0,
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
  const [isAddingPosition, setIsAddingPosition] = React.useState(false);
  const [newPositionDraft, setNewPositionDraft] =
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
    updateTrade,
    removeTrade,
    validationIssues,
    storageStatus,
  } = useTradingData();
  const sortedPositions = React.useMemo(
    () => sortPositionPlans(state.positions),
    [state.positions]
  );
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
  const updatePosition = (position: PositionPlan, patch: Partial<PositionPlan>) => {
    upsertPosition({ ...position, ...patch });
  };
  const commitNewPosition = (position: PositionPlan) => {
    if (!position.ticker.trim()) {
      return;
    }
    upsertPosition(position);
    setIsAddingPosition(false);
  };
  const updateNewPosition = <K extends keyof PositionPlan>(
    field: K,
    value: PositionPlan[K]
  ) => {
    const nextPosition = { ...newPositionDraft, [field]: value };
    setNewPositionDraft(nextPosition);
  };
  const handleNewPositionBlur = (
    event: React.FocusEvent<HTMLTableRowElement>
  ) => {
    const nextFocus = event.relatedTarget as Node | null;
    if (nextFocus && event.currentTarget.contains(nextFocus)) {
      return;
    }
    commitNewPosition(newPositionDraft);
  };
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
  return (
    <div className="grid min-w-0 gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="flex min-w-0 flex-col gap-3">
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
          <CardHeader className="flex flex-row items-start justify-between gap-3 border-b">
            <div className="min-w-0">
              <CardTitle className="flex items-center gap-2">
                <SlidersHorizontalIcon />
                持仓目标列表
              </CardTitle>
              <CardDescription>
                直接编辑目标、类型和风控线，目标仓位会自动从高到低排序
              </CardDescription>
            </div>
            <Button
              size="sm"
              onClick={() => {
                setNewPositionDraft(emptyPosition);
                setIsAddingPosition(true);
              }}
              disabled={isAddingPosition}
            >
              <PlusIcon data-icon="inline-start" />
              添加新标的
            </Button>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table className="min-w-[620px] table-fixed">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-16 text-center">标的</TableHead>
                  <TableHead className="w-20 text-center">类型</TableHead>
                  <TableHead className="w-20 text-center">目标仓位</TableHead>
                  <TableHead className="w-20 text-center">止盈线</TableHead>
                  <TableHead className="w-20 text-center">止损线</TableHead>
                  <TableHead className="w-36 text-center">首次买入</TableHead>
                  <TableHead className="w-8 p-0 text-center" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedPositions.map((position) => (
                  <TableRow key={position.ticker}>
                    <TableCell className="px-2 font-medium">{position.ticker}</TableCell>
                    <TableCell className="px-1">
                      <Select
                        value={position.assetType}
                        onValueChange={(value) =>
                          updatePosition(position, {
                            assetType: value === "ETF" ? "ETF" : "STOCK",
                          })
                        }
                      >
                        <SelectTrigger
                          aria-label={`${position.ticker} 类型`}
                          className="w-20"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="STOCK">STOCK</SelectItem>
                          <SelectItem value="ETF">ETF</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="px-1 text-right">
                      <RatioTableInput
                        aria-label={`${position.ticker} 目标仓位`}
                        value={position.targetWeight}
                        onChange={(value) =>
                          updatePosition(position, { targetWeight: value })
                        }
                      />
                    </TableCell>
                    <TableCell className="px-1 text-right">
                      <RatioTableInput
                        aria-label={`${position.ticker} 止盈线`}
                        value={position.takeProfitPct}
                        onChange={(value) =>
                          updatePosition(position, { takeProfitPct: value })
                        }
                      />
                    </TableCell>
                    <TableCell className="px-1 text-right">
                      <RatioTableInput
                        aria-label={`${position.ticker} 止损线`}
                        value={position.stopLossPct}
                        onChange={(value) =>
                          updatePosition(position, { stopLossPct: value })
                        }
                      />
                    </TableCell>
                    <TableCell className="px-1">
                      <Input
                        aria-label={`${position.ticker} 首次买入日期`}
                        className="w-32"
                        type="date"
                        value={position.purchaseDate}
                        onChange={(event) =>
                          updatePosition(position, {
                            purchaseDate: event.target.value,
                          })
                        }
                      />
                    </TableCell>
                    <TableCell className="w-8 p-0 text-center">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`删除${position.ticker}`}
                        onClick={() => removePosition(position.ticker)}
                      >
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {isAddingPosition ? (
                  <TableRow onBlur={handleNewPositionBlur}>
                    <TableCell className="px-1">
                      <Input
                        autoFocus
                        aria-label="新标的代码"
                        className="w-20 font-medium uppercase"
                        placeholder="Ticker"
                        value={newPositionDraft.ticker}
                        onChange={(event) =>
                          setNewPositionDraft((current) => ({
                            ...current,
                            ticker: event.target.value.toUpperCase(),
                          }))
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <Select
                        value={newPositionDraft.assetType}
                        onValueChange={(value) =>
                          updateNewPosition(
                            "assetType",
                            value === "ETF" ? "ETF" : "STOCK"
                          )
                        }
                      >
                        <SelectTrigger
                          aria-label="新标的类型"
                          className="w-20"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="STOCK">STOCK</SelectItem>
                          <SelectItem value="ETF">ETF</SelectItem>
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell className="px-1 text-right">
                      <RatioTableInput
                        aria-label="新标的目标仓位"
                        value={newPositionDraft.targetWeight}
                        onChange={(value) => updateNewPosition("targetWeight", value)}
                      />
                    </TableCell>
                    <TableCell className="px-1 text-right">
                      <RatioTableInput
                        aria-label="新标的止盈线"
                        value={newPositionDraft.takeProfitPct}
                        onChange={(value) => updateNewPosition("takeProfitPct", value)}
                      />
                    </TableCell>
                    <TableCell className="px-1 text-right">
                      <RatioTableInput
                        aria-label="新标的止损线"
                        value={newPositionDraft.stopLossPct}
                        onChange={(value) => updateNewPosition("stopLossPct", value)}
                      />
                    </TableCell>
                    <TableCell className="px-1">
                      <Input
                        aria-label="新标的首次买入日期"
                        className="w-32"
                        type="date"
                        value={newPositionDraft.purchaseDate}
                        onChange={(event) =>
                          updateNewPosition("purchaseDate", event.target.value)
                        }
                      />
                    </TableCell>
                    <TableCell className="w-8 p-0 text-center">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="取消添加新标的"
                        onClick={() => setIsAddingPosition(false)}
                      >
                        <XIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ) : null}
                {!sortedPositions.length && !isAddingPosition ? (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="h-20 text-center text-muted-foreground"
                    >
                      暂无持仓目标，点击右上角添加新标的
                    </TableCell>
                  </TableRow>
                ) : null}
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
        <PositionScreenshotImport />
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

function RatioTableInput({
  value,
  onChange,
  className,
  ...props
}: Omit<React.ComponentProps<typeof Input>, "value" | "onChange"> & {
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <Input
      {...props}
      className={`w-20 text-right tabular-nums ${className ?? ""}`}
      type="number"
      min="0"
      max="100"
      step="0.01"
      value={percentInputValue(value)}
      onChange={(event) => onChange(Number(event.target.value) / 100)}
    />
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
