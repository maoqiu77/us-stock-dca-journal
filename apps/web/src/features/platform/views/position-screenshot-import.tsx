"use client";

import { useMutation } from "@tanstack/react-query";
import * as React from "react";
import { AlertTriangleIcon, ImageUpIcon, LoaderCircleIcon, Trash2Icon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
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
import {
  recognizePositionScreenshot,
  type PositionRecognitionResult,
  type RecognizedPosition,
  type RecognizedTrade,
} from "@/features/platform/api";
import { normalizeTicker, todayIsoDate, previewLegacyMigration } from "@/features/platform/trading-data";
import { useTradingData } from "@/features/platform/trading-data-context";
import type { Checkpoint } from "@/features/platform/checkpoints";

type EditablePosition = RecognizedPosition & { id: string };
type EditableTrade = RecognizedTrade & { id: string; date: string; note: string };

type ScrollMetrics = {
  clientWidth: number;
  scrollLeft: number;
  scrollWidth: number;
};

type PreviewItem = { name: string; url: string };
type BatchRecognitionResult = PositionRecognitionResult & { mixed: boolean };

function ScreenshotPreview({ items }: { items: PreviewItem[] }) {
  return (
    <div className="relative rounded-md border bg-muted/20">
      <div
        className="grid max-h-56 grid-cols-2 gap-2 overflow-y-auto p-2 sm:grid-cols-4"
      >
        {items.map((item) => (
          <figure key={item.url} className="min-w-0 rounded-md border bg-background p-1">
            {/* The broker image is user-selected and remains browser-local after recognition. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.url} alt={`待确认的券商截图：${item.name}`} className="h-28 w-full object-contain" />
            <figcaption className="truncate px-1 pt-1 text-xs text-muted-foreground">{item.name}</figcaption>
          </figure>
        ))}
      </div>
    </div>
  );
}

function PersistentHorizontalScrollbar({
  viewportRef,
  label,
}: {
  viewportRef: React.RefObject<HTMLDivElement | null>;
  label: string;
}) {
  const [metrics, setMetrics] = React.useState<ScrollMetrics>({
    clientWidth: 0,
    scrollLeft: 0,
    scrollWidth: 0,
  });

  const updateMetrics = React.useCallback(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setMetrics({
      clientWidth: viewport.clientWidth,
      scrollLeft: viewport.scrollLeft,
      scrollWidth: viewport.scrollWidth,
    });
  }, [viewportRef]);

  React.useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(viewport);
    if (viewport.firstElementChild) observer.observe(viewport.firstElementChild);
    viewport.addEventListener("scroll", updateMetrics, { passive: true });
    updateMetrics();
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", updateMetrics);
    };
  }, [updateMetrics, viewportRef]);

  const maxScrollLeft = Math.max(metrics.scrollWidth - metrics.clientWidth, 0);
  const hasOverflow = maxScrollLeft > 0;
  const thumbWidth = hasOverflow
    ? Math.max((metrics.clientWidth / metrics.scrollWidth) * 100, 12)
    : 100;
  const thumbLeft = hasOverflow
    ? (metrics.scrollLeft / maxScrollLeft) * (100 - thumbWidth)
    : 0;

  function scrollFromPointer(event: React.PointerEvent<HTMLDivElement>) {
    const viewport = viewportRef.current;
    if (!viewport || !hasOverflow) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const thumbPixels = (thumbWidth / 100) * bounds.width;
    const trackPixels = bounds.width - thumbPixels;
    const position = Math.min(
      Math.max(event.clientX - bounds.left - thumbPixels / 2, 0),
      trackPixels
    );
    viewport.scrollLeft = (position / trackPixels) * maxScrollLeft;
  }

  return (
    <div
      aria-controls="screenshot-import-table"
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemax={maxScrollLeft}
      aria-valuemin={0}
      aria-valuenow={Math.round(metrics.scrollLeft)}
      className={`mx-4 mb-2 h-3 rounded-full bg-muted p-0.5 ${hasOverflow ? "cursor-pointer" : "cursor-default"}`}
      role="scrollbar"
      tabIndex={hasOverflow ? 0 : -1}
      onKeyDown={(event) => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const step = Math.max(viewport.clientWidth * 0.2, 40);
        if (event.key === "ArrowLeft") viewport.scrollLeft -= step;
        else if (event.key === "ArrowRight") viewport.scrollLeft += step;
        else if (event.key === "Home") viewport.scrollLeft = 0;
        else if (event.key === "End") viewport.scrollLeft = maxScrollLeft;
        else return;
        event.preventDefault();
      }}
      onPointerDown={(event) => {
        if (!hasOverflow) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        scrollFromPointer(event);
      }}
      onPointerMove={(event) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
          scrollFromPointer(event);
        }
      }}
    >
      <div
        aria-hidden="true"
        className="h-full rounded-full bg-muted-foreground/55"
        style={{ marginLeft: `${thumbLeft}%`, width: `${thumbWidth}%` }}
      />
    </div>
  );
}

export function PositionScreenshotImport() {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [previewItems, setPreviewItems] = React.useState<PreviewItem[]>([]);
  const [rows, setRows] = React.useState<EditablePosition[]>([]);
  const [mode, setMode] = React.useState<"auto" | "portfolio" | "trades">("auto");
  const [detectedMode, setDetectedMode] = React.useState<"portfolio" | "trades">("portfolio");
  const [tradeRows, setTradeRows] = React.useState<EditableTrade[]>([]);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [resultMessage, setResultMessage] = React.useState("");
  const [recognitionProgress, setRecognitionProgress] = React.useState({ completed: 0, total: 0 });
  const tableViewportRef = React.useRef<HTMLDivElement>(null);
  const { state, derivedPositions, applyRecognizedTrades, addCheckpoint, checkpointRevision } = useTradingData();
  const migrationPreview = React.useMemo(() => previewLegacyMigration(state), [state]);
  const heldTickers = React.useMemo(
    () => new Set(derivedPositions.filter((item) => item.shares > 0).map((item) => item.ticker)),
    [derivedPositions]
  );
  const recognition = useMutation<BatchRecognitionResult, Error, File[]>({
    mutationFn: async (files) => {
      const results: PositionRecognitionResult[] = [];
      const failures: string[] = [];
      setRecognitionProgress({ completed: 0, total: files.length });
      for (const [index, file] of files.entries()) {
        try {
          results.push(await recognizePositionScreenshot(await resizeImage(file), mode));
        } catch (error) {
          failures.push(`${file.name}：${error instanceof Error ? error.message : "识别失败"}`);
        } finally {
          setRecognitionProgress({ completed: index + 1, total: files.length });
        }
      }
      if (!results.length) throw new Error(failures.join("；") || "没有成功识别任何截图。");
      const modes = new Set(results.map((result) => result.mode));
      const positions = results.flatMap((result) => result.positions);
      const duplicateTickers = positions.filter((row, index) => positions.findIndex(other => normalizeTicker(other.ticker) === normalizeTicker(row.ticker)) !== index).map(row => row.ticker);
      return {
        mode: modes.size === 1 ? results[0].mode : "portfolio",
        positions,
        trades: results.flatMap((result) => result.trades),
        warnings: [...results.flatMap((result) => result.warnings), ...failures, ...(duplicateTickers.length ? [`重复标的需核对：${duplicateTickers.join("、")}`] : [])],
        endpoint: results.map((result) => result.endpoint).filter(Boolean).join(", "),
        mixed: modes.size > 1,
      };
    },
    onSuccess: (result) => {
      if (result.mixed) {
        setRows([]);
        setTradeRows([]);
        setWarnings(result.warnings);
        setResultMessage(
          [
            "这批截图识别出了不同类型，请只选择交易记录截图或只选择完整持仓截图后重试。",
            ...result.warnings,
          ].join("；")
        );
        return;
      }
      setDetectedMode(result.mode);
      setTradeRows(result.trades.map((row, index) => ({ ...row, id: `${row.ticker}-${row.action}-${index}`, date: todayIsoDate(), note: "券商交易截图导入" })));
      setRows(result.positions.map((row, index) => ({ ...row, id: `${row.ticker}-${index}` })));
      setWarnings(result.warnings);
      setOpen(true);
    },
    onError: (error) => {
      setRows([]);
      setTradeRows([]);
      setWarnings([]);
      setResultMessage(error.message);
    },
  });
  React.useEffect(() => {
    return () => {
      previewItems.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, [previewItems]);
  const validRows = rows.filter(
    (row) =>
      normalizeTicker(row.ticker) &&
      row.shares > 0 &&
      (row.averageCost ?? 0) > 0 &&
      (detectedMode === "portfolio" || !heldTickers.has(normalizeTicker(row.ticker)))
  );
  const tradeConflicts = React.useMemo(() => {
    const sharesByTicker = new Map(derivedPositions.map((row) => [row.ticker, row.shares]));
    const conflicts = new Map<string, string>();
    tradeRows.forEach((row) => {
      const ticker = normalizeTicker(row.ticker);
      const current = sharesByTicker.get(ticker) ?? 0;
      if (!ticker || row.shares <= 0 || row.unitPrice <= 0 || row.amount <= 0) {
        conflicts.set(row.id, "代码、金额、单价和股数必须完整且大于 0");
        return;
      }
      const next = row.action === "买入" ? current + row.shares : current - row.shares;
      if (next < -1e-6) conflicts.set(row.id, `卖出 ${row.shares} 股，但当前流水持仓只有 ${current} 股`);
      sharesByTicker.set(ticker, Math.max(next, 0));
    });
    return conflicts;
  }, [derivedPositions, tradeRows]);

  function handleFiles(files: File[]) {
    if (!files.length) return;
    setResultMessage("");
    setWarnings([]);
    setRows([]);
    setTradeRows([]);
    setPreviewItems(files.map((file) => ({ name: file.name, url: URL.createObjectURL(file) })));
    recognition.mutate(files);
  }

  function updateRow(id: string, patch: Partial<EditablePosition>) {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  }
  function updateTradeRow(id: string, patch: Partial<EditableTrade>) {
    setTradeRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
  }

  return (
    <>
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <ImageUpIcon />
            AI 截图导入
          </CardTitle>
          <CardDescription>交易截图经确认可记入流水；持仓截图校准暂不可写入</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            onChange={(event) => {
              handleFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <Button
            variant="outline"
            className="w-full"
            onClick={() => inputRef.current?.click()}
            disabled={recognition.isPending}
          >
            {recognition.isPending ? (
              <LoaderCircleIcon className="animate-spin" data-icon="inline-start" />
            ) : (
              <ImageUpIcon data-icon="inline-start" />
            )}
            {recognition.isPending
              ? `AI 正在识别 ${recognitionProgress.completed}/${recognitionProgress.total}`
              : "选择券商截图"}
          </Button>
          <Select value={mode} onValueChange={(value) => setMode(value as typeof mode)}>
            <SelectTrigger aria-label="截图类型"><SelectValue placeholder="自动判断截图类型" /></SelectTrigger>
            <SelectContent><SelectItem value="auto">自动判断截图类型</SelectItem><SelectItem value="trades">今日交易记录截图</SelectItem><SelectItem value="portfolio">持仓截图（建立校准检查点）</SelectItem></SelectContent>
          </Select>
          <Alert><AlertTriangleIcon /><AlertTitle>持仓截图写入校准检查点</AlertTitle><AlertDescription>截图只建立带来源、观察时间和账本版本的持仓检查点，不会生成买入/卖出流水或已实现盈亏。识别到的遗漏不会自动卖出。</AlertDescription></Alert>
          <details>
            <summary>旧记录迁移预览（只读）：{migrationPreview.pending.length} 条待核验，自动转换 0 条</summary>
            <p className="py-2 text-sm text-muted-foreground">{migrationPreview.warning} 迁移前请先下载完整备份。本次不删除或重算历史。</p>
            <Button size="sm" variant="outline" onClick={() => {
              const url = URL.createObjectURL(new Blob([JSON.stringify(migrationPreview, null, 2)], { type: "application/json" }));
              const link = document.createElement("a"); link.href = url; link.download = "旧账本迁移预览-只读.json"; link.click();
              setTimeout(() => URL.revokeObjectURL(url), 1000);
            }}>导出只读迁移预览</Button>
          </details>
          <p className="text-xs text-muted-foreground">
            PNG、JPEG 或 WebP。可按住 Mac 的 Command 或 Windows 的 Ctrl 多选；图片会逐张发送到已配置的 AI 接口识别，不在本地保存。
          </p>
          {previewItems.length ? (
            <p className="truncate text-sm text-muted-foreground">
              已选择 {previewItems.length} 张截图：{previewItems.map((item) => item.name).join("、")}
            </p>
          ) : null}
          {recognition.error ? (
            <Alert variant="destructive">
              <AlertTriangleIcon />
              <AlertTitle>识别未完成</AlertTitle>
              <AlertDescription>
                {recognition.error instanceof Error ? recognition.error.message : "识别失败。"}
              </AlertDescription>
            </Alert>
          ) : null}
          {resultMessage && !recognition.error ? (
            <p className="text-sm text-muted-foreground">{resultMessage}</p>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-6xl">
          <DialogHeader>
            <DialogTitle>{detectedMode === "trades" ? "确认识别到的交易记录" : "持仓截图核对（未写入）"}</DialogTitle>
            <DialogDescription>
              {detectedMode === "trades" ? "确认后只追加截图中的买入、卖出记录，不影响其他标的。" : "确认后建立持仓校准检查点；原流水保持不变。"}
            </DialogDescription>
          </DialogHeader>
          {previewItems.length ? (
            <ScreenshotPreview items={previewItems} />
          ) : null}
          {warnings.length ? (
            <Alert>
              <AlertTriangleIcon />
              <AlertTitle>识别提示</AlertTitle>
              <AlertDescription>{warnings.join("；")}</AlertDescription>
            </Alert>
          ) : null}
          {detectedMode === "trades" ? <div className="overflow-hidden rounded-md border"><Table containerRef={tableViewportRef} containerClassName="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden" containerId="screenshot-import-table" aria-label="识别到的交易记录"><TableHeader><TableRow><TableHead>日期</TableHead><TableHead>标的</TableHead><TableHead>动作</TableHead><TableHead>交易金额</TableHead><TableHead>单支成本</TableHead><TableHead>股数</TableHead><TableHead>备注 / 校验</TableHead><TableHead className="w-10"><span className="sr-only">操作</span></TableHead></TableRow></TableHeader><TableBody>{tradeRows.map((row) => <TableRow key={row.id} className={tradeConflicts.has(row.id) ? "bg-destructive/5" : undefined}>
            <TableCell className="min-w-36"><Input aria-label="交易日期" type="date" value={row.date} onChange={(event) => updateTradeRow(row.id, { date: event.target.value })} /></TableCell>
            <TableCell className="min-w-28"><Input aria-label="交易标的" value={row.ticker} onChange={(event) => updateTradeRow(row.id, { ticker: event.target.value.toUpperCase() })} /></TableCell>
            <TableCell className="min-w-24"><Select value={row.action} onValueChange={(value) => updateTradeRow(row.id, { action: value as "买入" | "卖出" })}><SelectTrigger aria-label="交易动作" className={row.action === "买入" ? "border-trade-buy/30 bg-trade-buy/10 text-trade-buy" : "border-trade-sell/30 bg-trade-sell/10 text-trade-sell"}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="买入">买入</SelectItem><SelectItem value="卖出">卖出</SelectItem></SelectContent></Select></TableCell>
            <TableCell className="min-w-32"><Input aria-label="交易金额" type="number" min="0" step="any" value={row.amount || ""} onChange={(event) => updateTradeRow(row.id, { amount: Number(event.target.value) })} /></TableCell>
            <TableCell className="min-w-32"><Input aria-label="单支成本" type="number" min="0" step="any" value={row.unitPrice || ""} onChange={(event) => updateTradeRow(row.id, { unitPrice: Number(event.target.value) })} /></TableCell>
            <TableCell className="min-w-32"><Input aria-label="股数" type="number" min="0" step="any" value={row.shares || ""} onChange={(event) => updateTradeRow(row.id, { shares: Number(event.target.value) })} /></TableCell>
            <TableCell className="min-w-56"><Input aria-label="备注" value={row.note} onChange={(event) => updateTradeRow(row.id, { note: event.target.value })} />{row.sourceText ? <p className="mt-1 text-xs text-muted-foreground">原文：{row.sourceText}</p> : null}{tradeConflicts.get(row.id) ? <p className="mt-1 text-xs text-destructive">{tradeConflicts.get(row.id)}</p> : <p className="mt-1 text-xs text-muted-foreground">与当前流水一致</p>}</TableCell>
            <TableCell><Button variant="ghost" size="icon-sm" onClick={() => setTradeRows((current) => current.filter((item) => item.id !== row.id))}><Trash2Icon /><span className="sr-only">删除 {row.ticker}</span></Button></TableCell>
          </TableRow>)}</TableBody></Table><PersistentHorizontalScrollbar viewportRef={tableViewportRef} label="交易记录横向滚动条" /></div> : <div className="overflow-hidden rounded-md border">
            <Table containerRef={tableViewportRef} containerClassName="[scrollbar-width:none] [&::-webkit-scrollbar]:hidden" containerId="screenshot-import-table" aria-label="识别到的持仓">
              <TableHeader>
                <TableRow>
                  <TableHead>代码</TableHead>
                  <TableHead>类型</TableHead>
                  <TableHead>持有数量</TableHead>
                  <TableHead>平均成本</TableHead>
                  <TableHead>置信度</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="w-10"><span className="sr-only">操作</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const alreadyHeld = heldTickers.has(normalizeTicker(row.ticker));
                  return (
                    <TableRow key={row.id}>
                      <TableCell className="min-w-28">
                        <Input
                          aria-label="证券代码"
                          value={row.ticker}
                          onChange={(event) => updateRow(row.id, { ticker: event.target.value.toUpperCase() })}
                        />
                      </TableCell>
                      <TableCell className="min-w-28">
                        <Select
                          value={row.assetType}
                          onValueChange={(value) => updateRow(row.id, { assetType: value as "ETF" | "STOCK" })}
                        >
                          <SelectTrigger aria-label="资产类型"><SelectValue /></SelectTrigger>
                          <SelectContent><SelectItem value="STOCK">股票</SelectItem><SelectItem value="ETF">ETF</SelectItem></SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="min-w-32">
                        <Input
                          aria-label="持有数量"
                          type="number"
                          min="0"
                          step="any"
                          value={row.shares || ""}
                          onChange={(event) => updateRow(row.id, { shares: Number(event.target.value) })}
                        />
                      </TableCell>
                      <TableCell className="min-w-32">
                        <Input
                          aria-label="平均成本"
                          type="number"
                          min="0"
                          step="any"
                          value={row.averageCost ?? ""}
                          onChange={(event) => updateRow(row.id, { averageCost: Number(event.target.value) || null })}
                        />
                      </TableCell>
                      <TableCell className="tabular-nums">{Math.round(row.confidence * 100)}%</TableCell>
                      <TableCell>
                          <Badge variant={alreadyHeld && detectedMode !== "portfolio" ? "destructive" : "secondary"}>
                          {alreadyHeld ? "已有持仓，仅核对" : "仅预览，未写入"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="icon-sm" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}>
                          <Trash2Icon /><span className="sr-only">删除 {row.ticker}</span>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <PersistentHorizontalScrollbar viewportRef={tableViewportRef} label="持仓横向滚动条" />
          </div>}
          {detectedMode === "trades" && tradeConflicts.size ? <Alert variant="destructive"><AlertTriangleIcon /><AlertTitle>交易与当前流水持仓存在矛盾</AlertTitle><AlertDescription>请修正标红交易后再写入，系统不会自动制造负持仓。</AlertDescription></Alert> : null}
          {detectedMode !== "trades" && <Alert><AlertTitle>整批候选待校准</AlertTitle><AlertDescription>
            候选 {rows.length} 条，可核对数量和成本 {validRows.length} 条；遗漏的现有持仓：{derivedPositions.filter(item => item.shares > 0 && !rows.some(row => normalizeTicker(row.ticker) === item.ticker)).map(item => item.ticker).join("、") || "无"}。遗漏不代表卖出，已有成交和持仓不变。
          </AlertDescription></Alert>}
          <Field>
            <FieldLabel htmlFor="snapshot-date">{detectedMode === "trades" ? "录入日期" : "核对日期（仅预览）"}</FieldLabel>
            <Input id="snapshot-date" type="date" defaultValue={todayIsoDate()} readOnly />
            <FieldDescription>截图不能证明历史成交日期。交易请逐条核实日期；持仓只记录观察时点，不初始化或覆盖账户。</FieldDescription>
          </Field>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button
              disabled={(detectedMode === "trades" && (!tradeRows.length || Boolean(tradeConflicts.size))) || (detectedMode !== "trades" && (!validRows.length || !checkpointRevision))}
              onClick={() => {
                if (detectedMode === "trades") {
                  applyRecognizedTrades(tradeRows, todayIsoDate());
                } else {
                  const now = new Date().toISOString();
                  const market = (ticker: string) => ticker.endsWith(".HK") ? "HKEX" : ticker.endsWith(".SS") || ticker.endsWith(".SZ") ? "CN" : "US";
                  const rowsForCheckpoint = validRows.map(row => {
                    const normalized = normalizeTicker(row.ticker);
                    const m = market(normalized) as "US" | "HKEX" | "CN";
                    const currency = ({ US: "USD", HKEX: "HKD", CN: "CNY" } as const)[m];
                    return { ticker: normalized, market: m, currency, assetType: row.assetType, shareClass: "ordinary", instrumentId: `${m}:${normalized}:${row.assetType}:${currency}:ordinary`, quantity: String(row.shares), totalCost: String(row.shares * (row.averageCost ?? 0)) };
                  });
                  const checkpoint: Checkpoint = { id: crypto.randomUUID(), kind: "position_checkpoint", observedAt: now, recordedAt: now, throughDate: todayIsoDate(), baseRevision: checkpointRevision!, scope: "complete", historyComplete: false, source: { kind: "screenshot", reference: previewItems.map(item => item.name).join(",") || "browser-screenshot" }, rows: rowsForCheckpoint, retainedTickers: derivedPositions.filter(item => item.shares > 0 && !rowsForCheckpoint.some(row => row.ticker === item.ticker)).map(item => item.ticker), baseline: state.trades.map(trade => ({ ...trade })) };
                  addCheckpoint(checkpoint);
                  setResultMessage(`已建立 ${rowsForCheckpoint.length} 条持仓校准检查点，未新增成交流水。`);
                }
                setOpen(false);
                setRows([]);
                setResultMessage(`已加入 ${tradeRows.length} 条交易草稿，数据库保存状态见页面顶部。`);
              }}
            >
              {detectedMode === "trades" ? `写入 ${tradeRows.length} 条交易` : `建立 ${validRows.length} 条校准检查点`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

async function resizeImage(file: File): Promise<string> {
  if (!file.type.match(/^image\/(png|jpeg|webp)$/)) {
    throw new Error("仅支持 PNG、JPEG 或 WebP 图片。");
  }
  if (file.size > 15 * 1024 * 1024) {
    throw new Error("原图不能超过 15 MB。");
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.88);
}
