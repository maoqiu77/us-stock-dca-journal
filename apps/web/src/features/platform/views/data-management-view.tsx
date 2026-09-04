"use client";

import {
  EyeIcon,
  HistoryIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
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
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  formatMoney,
  formatShares,
  formatTradeNumberInput,
  parseTradeNumberInput,
  sortTradesNewestFirst,
  todayIsoDate,
  updateTradeCalculation,
  type AssetType,
  type TradeAction,
  type TradeCalculationField,
  type TradeRecord,
} from "@/features/platform/trading-data";
import { useTradingData } from "@/features/platform/trading-data-context";
import { PositionScreenshotImport } from "@/features/platform/views/position-screenshot-import";

type TradeDraft = Omit<TradeRecord, "id" | "shares" | "unitPrice" | "amount"> & {
  shares: string;
  unitPrice: string;
  amount: string;
};
type EntryAction = TradeAction | "仅观察";

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
  const { state, observeTicker, addTrade, updateTrade, removeTrade } = useTradingData();
  const [tradeDraft, setTradeDraft] = React.useState(initialTradeDraft);
  const [entryAction, setEntryAction] = React.useState<EntryAction>("买入");
  const [assetType, setAssetType] = React.useState<AssetType>("STOCK");
  const [recentTradeFields, setRecentTradeFields] = React.useState<
    TradeCalculationField[]
  >([]);
  const [editingTradeId, setEditingTradeId] = React.useState<string | null>(null);
  const tradeAmount = parseTradeNumberInput(tradeDraft.amount);
  const tradeUnitPrice = parseTradeNumberInput(tradeDraft.unitPrice);
  const tradeShares = parseTradeNumberInput(tradeDraft.shares);
  const isEditingTrade = Boolean(editingTradeId);
  const tradesNewestFirst = React.useMemo(
    () => sortTradesNewestFirst(state.trades),
    [state.trades]
  );

  const resetDraft = () => {
    setTradeDraft(initialTradeDraft);
    setEntryAction("买入");
    setAssetType("STOCK");
    setRecentTradeFields([]);
    setEditingTradeId(null);
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
  const saveEntry = () => {
    if (entryAction === "仅观察") {
      observeTicker(tradeDraft.ticker, assetType);
      resetDraft();
      return;
    }
    const normalizedTradeDraft = {
      ...tradeDraft,
      action: entryAction,
      amount: tradeAmount,
      unitPrice: tradeUnitPrice,
      shares: tradeShares,
    };
    if (editingTradeId) {
      updateTrade(editingTradeId, normalizedTradeDraft, assetType);
    } else {
      addTrade(normalizedTradeDraft, assetType);
    }
    resetDraft();
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PositionScreenshotImport />
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <PlusIcon />
            {isEditingTrade ? "编辑交易" : "手动录入交易"}
          </CardTitle>
          <CardDescription>
            买卖会写入交易流水；仅观察只把标的加入总览
          </CardDescription>
        </CardHeader>
        <CardContent>
          <FieldGroup>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <Field>
                <FieldLabel htmlFor="trade-date">日期</FieldLabel>
                <Input
                  id="trade-date"
                  type="date"
                  value={tradeDraft.date}
                  disabled={entryAction === "仅观察"}
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
                  placeholder="例如 NVDA"
                  onChange={(event) =>
                    setTradeDraft((current) => ({
                      ...current,
                      ticker: event.target.value.toUpperCase(),
                    }))
                  }
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="trade-asset-type">类型</FieldLabel>
                <Select
                  value={assetType}
                  onValueChange={(value) =>
                    setAssetType(value === "ETF" ? "ETF" : "STOCK")
                  }
                >
                  <SelectTrigger id="trade-asset-type">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="STOCK">股票</SelectItem>
                    <SelectItem value="ETF">ETF</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel htmlFor="trade-action">动作</FieldLabel>
                <ToggleGroup
                  value={[entryAction]}
                  onValueChange={(value) => {
                    const nextValue = Array.isArray(value) ? value[0] : value;
                    if (nextValue === "买入" || nextValue === "卖出") {
                      setEntryAction(nextValue);
                      setTradeDraft((current) => ({
                        ...current,
                        action: nextValue,
                      }));
                    } else if (nextValue === "仅观察" && !isEditingTrade) {
                      setEntryAction(nextValue);
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
                  {!isEditingTrade ? (
                    <ToggleGroupItem value="仅观察" aria-label="仅观察">
                      <EyeIcon data-icon="inline-start" />
                      仅观察
                    </ToggleGroupItem>
                  ) : null}
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
                  disabled={entryAction === "仅观察"}
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
                  disabled={entryAction === "仅观察"}
                  onChange={(event) =>
                    handleTradeCalculationChange("unitPrice", event.target.value)
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
                  disabled={entryAction === "仅观察"}
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
                  disabled={entryAction === "仅观察"}
                  onChange={(event) =>
                    setTradeDraft((current) => ({
                      ...current,
                      note: event.target.value,
                    }))
                  }
                />
              </Field>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {isEditingTrade ? (
                <Button variant="outline" onClick={resetDraft}>
                  <XIcon data-icon="inline-start" />
                  取消编辑
                </Button>
              ) : null}
              <Button
                onClick={saveEntry}
                disabled={
                  !tradeDraft.ticker.trim() ||
                  (entryAction !== "仅观察" &&
                    (tradeAmount <= 0 ||
                      tradeUnitPrice <= 0 ||
                      tradeShares <= 0))
                }
              >
                {entryAction === "仅观察" ? (
                  <EyeIcon data-icon="inline-start" />
                ) : (
                  <PlusIcon data-icon="inline-start" />
                )}
                {entryAction === "仅观察"
                  ? "加入总览"
                  : isEditingTrade
                    ? "保存修改"
                    : "添加流水"}
              </Button>
            </div>
          </FieldGroup>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <HistoryIcon />
            交易流水
          </CardTitle>
          <CardDescription>所有持仓数量与成本均由这里的买卖记录计算</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table className="min-w-[780px]">
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
              {tradesNewestFirst.map((trade) => (
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
                    <div className="flex justify-end gap-1">
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
                          setEntryAction(trade.action);
                          setAssetType(
                            state.positions.find(
                              (position) => position.ticker === trade.ticker
                            )?.assetType ?? "STOCK"
                          );
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
                            resetDraft();
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
              {!state.trades.length ? (
                <TableRow>
                  <TableCell colSpan={8} className="h-24 text-center text-muted-foreground">
                    暂无交易流水。
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
