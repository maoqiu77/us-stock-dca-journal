"use client";

import * as React from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DownloadIcon,
  Loader2Icon,
  RefreshCwIcon,
  RocketIcon,
  ShieldIcon,
} from "lucide-react";
import { toast } from "sonner";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
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
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import {
  startSoftwareUpdate,
  type UpdateCheckResponse,
  type UpdateStatusResponse,
} from "@/features/platform/api";
import {
  useUpdateCheckQuery,
  useUpdateStatusQuery,
} from "@/features/platform/queries";
import {
  resolveUpdateCheckAction,
  resolveUpdateStatusMessage,
} from "@/features/platform/software-update-action";
import { TRADING_DATA_STORAGE_KEY } from "@/features/platform/trading-data";

const ONBOARDING_STORAGE_KEY = "stock-platform-onboarding-v1";
const UPDATE_LOCAL_STORAGE_KEYS = [
  TRADING_DATA_STORAGE_KEY,
  ONBOARDING_STORAGE_KEY,
];

export function SoftwareUpdateCard() {
  const queryClient = useQueryClient();
  const [confirmOpen, setConfirmOpen] = React.useState(false);
  const [pollStatus, setPollStatus] = React.useState(false);
  const updateCheckQuery = useUpdateCheckQuery(false);
  const updateStatusQuery = useUpdateStatusQuery(pollStatus);
  const updateCheck = updateCheckQuery.data;
  const updateStatus = updateStatusQuery.data;
  const visibleStatus =
    updateStatus && updateStatus.phase !== "idle" ? updateStatus : null;
  const updateMutation = useMutation({
    mutationFn: () =>
      startSoftwareUpdate({
        localStorageSnapshot: collectLocalStorageSnapshot(),
      }),
    onSuccess: () => {
      setConfirmOpen(false);
      setPollStatus(true);
      queryClient.invalidateQueries({ queryKey: ["update-status"] });
      toast.success("更新器已启动，应用会自动重启。");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "启动更新失败。");
    },
  });

  const statusMessage = resolveUpdateStatusMessage({
    updateStatusMessage: visibleStatus?.message ?? "",
    updateCheckMessage: updateCheck?.message ?? "",
    checkErrorMessage: updateCheckQuery.isError
      ? updateCheckQuery.error instanceof Error
        ? updateCheckQuery.error.message
        : "检查更新失败。"
      : "",
  });
  const canStart = Boolean(updateCheck?.updateAvailable && updateCheck.canInstall);
  const isBusy =
    updateMutation.isPending ||
    visibleStatus?.phase === "downloading" ||
    visibleStatus?.phase === "verifying" ||
    visibleStatus?.phase === "backing-up" ||
    visibleStatus?.phase === "restarting";

  async function handleCheckForUpdate() {
    const result = await updateCheckQuery.refetch();
    if (result.error || !result.data) {
      return;
    }
    const action = resolveUpdateCheckAction(result.data);
    if (action.kind === "confirm") {
      setConfirmOpen(true);
      return;
    }
    if (action.kind === "latest") {
      toast.success(action.message || "当前已经是最新版。");
      return;
    }
    toast.warning(action.message);
  }

  return (
    <>
      <Card>
        <CardHeader className="border-b">
          <CardTitle className="flex items-center gap-2">
            <RocketIcon />
            软件更新
          </CardTitle>
          <CardDescription>发现 GitHub 新版本后自动备份并更新</CardDescription>
          <CardAction>
            <UpdateBadge
              updateCheck={updateCheck}
              updateStatus={visibleStatus}
              isError={updateCheckQuery.isError}
            />
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Table>
            <TableBody>
              <UpdateRow
                label="当前版本"
                value={updateCheck?.currentVersion ?? "未检查"}
              />
              <UpdateRow
                label="最新版本"
                value={updateCheck?.latestVersion || "未检查"}
              />
              <UpdateRow label="当前系统" value={updateCheck?.platform ?? "未检查"} />
              <UpdateRow
                label="安装包"
                value={
                  updateCheck?.asset?.name ?? (updateCheck ? "未匹配" : "未检查")
                }
                mono
              />
            </TableBody>
          </Table>
          <UpdateNotice
            updateCheck={updateCheck}
            updateStatus={visibleStatus}
            isCheckError={updateCheckQuery.isError}
            message={statusMessage}
          />
        </CardContent>
        <CardFooter className="justify-between gap-2">
          <Button
            variant="outline"
            onClick={() => void handleCheckForUpdate()}
            disabled={updateCheckQuery.isFetching || isBusy}
          >
            {updateCheckQuery.isFetching ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <RefreshCwIcon data-icon="inline-start" />
            )}
            检查更新
          </Button>
          <Button
            onClick={() => setConfirmOpen(true)}
            disabled={!canStart || isBusy}
          >
            {updateMutation.isPending ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            一键更新
          </Button>
        </CardFooter>
      </Card>
      <UpdateConfirmDialog
        open={confirmOpen}
        updateCheck={updateCheck}
        isPending={updateMutation.isPending}
        onOpenChange={setConfirmOpen}
        onConfirm={() => updateMutation.mutate()}
      />
    </>
  );
}

function UpdateRow({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="text-muted-foreground">{label}</TableCell>
      <TableCell className={mono ? "text-right font-mono text-xs" : "text-right"}>
        {value}
      </TableCell>
    </TableRow>
  );
}

function UpdateBadge({
  updateCheck,
  updateStatus,
  isError,
}: {
  updateCheck?: UpdateCheckResponse;
  updateStatus: UpdateStatusResponse | null;
  isError: boolean;
}) {
  if (updateStatus?.phase === "error" || isError) {
    return <Badge variant="outline">检查失败</Badge>;
  }
  if (updateStatus?.phase === "restarting") {
    return <Badge variant="secondary">正在重启</Badge>;
  }
  if (updateStatus && updateStatus.phase !== "idle") {
    return <Badge variant="secondary">更新中</Badge>;
  }
  if (updateCheck?.updateAvailable) {
    return (
      <Badge variant={updateCheck.canInstall ? "secondary" : "outline"}>
        有新版本
      </Badge>
    );
  }
  if (!updateCheck) {
    return <Badge variant="outline">未检查</Badge>;
  }
  return <Badge variant="secondary">最新版</Badge>;
}

function UpdateNotice({
  updateCheck,
  updateStatus,
  isCheckError,
  message,
}: {
  updateCheck?: UpdateCheckResponse;
  updateStatus: UpdateStatusResponse | null;
  isCheckError: boolean;
  message: string;
}) {
  const isError = isCheckError || updateStatus?.phase === "error";
  const showAlert = isError || updateCheck || updateStatus;

  if (!showAlert) {
    return null;
  }

  return (
    <Alert variant={isError ? "destructive" : "default"}>
      <ShieldIcon />
      <AlertTitle>{isError ? "更新暂不可用" : "检查结果"}</AlertTitle>
      <AlertDescription>
        {message}
        {updateStatus?.backupPath ? ` 备份：${updateStatus.backupPath}` : ""}
      </AlertDescription>
    </Alert>
  );
}

function UpdateConfirmDialog({
  open,
  updateCheck,
  isPending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  updateCheck?: UpdateCheckResponse;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>确认更新到 {updateCheck?.latestVersion ?? "新版"}</DialogTitle>
          <DialogDescription>
            更新前会自动备份 storage/local 和浏览器本地状态；如果校验或安装失败，旧版本和个人数据会保留。
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2 text-sm">
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="font-medium">保留个人数据</div>
            <div className="mt-1 text-muted-foreground">
              交易记录、AI 设置、账户资料和本地兜底数据会先写入备份包。
            </div>
          </div>
          <div className="rounded-lg bg-muted/50 p-3">
            <div className="font-medium">更新期间会重启</div>
            <div className="mt-1 text-muted-foreground">
              页面会短暂断开，更新器完成后会重新打开股票交易平台。
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            暂不更新
          </Button>
          <Button onClick={onConfirm} disabled={isPending}>
            {isPending ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <DownloadIcon data-icon="inline-start" />
            )}
            立即更新
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function collectLocalStorageSnapshot() {
  if (typeof window === "undefined") {
    return {};
  }
  const snapshot: Record<string, string> = {};
  for (const key of UPDATE_LOCAL_STORAGE_KEYS) {
    const value = window.localStorage.getItem(key);
    if (value !== null) {
      snapshot[key] = value;
    }
  }
  return snapshot;
}
