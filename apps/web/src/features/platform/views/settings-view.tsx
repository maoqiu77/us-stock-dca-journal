"use client";

import {
  DatabaseIcon,
  ShieldIcon,
} from "lucide-react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { useTradingData } from "@/features/platform/trading-data-context";

export function SettingsView() {
  const { validationIssues, storageStatus } = useTradingData();

  return (
    <div className="flex flex-col gap-3">
      {validationIssues.length ? (
        <Alert variant="destructive">
          <ShieldIcon />
          <AlertTitle>设置需要修正</AlertTitle>
          <AlertDescription>
            {validationIssues.slice(0, 3).join(" ")}
            {validationIssues.length > 3 ? " ..." : ""}
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_360px]">
        <DataBoundaryCard
          storageStatus={storageStatus}
          validationIssueCount={validationIssues.length}
        />
      </div>
    </div>
  );
}

function DataBoundaryCard({
  storageStatus,
  validationIssueCount,
}: {
  storageStatus: string;
  validationIssueCount: number;
}) {
  return (
    <Card>
      <CardHeader className="border-b">
        <CardTitle className="flex items-center gap-2">
          <DatabaseIcon />
          数据边界
        </CardTitle>
        <CardDescription>本地私有状态保存在 SQLite，提交时排除</CardDescription>
        <Badge variant={storageStatus === "error" ? "outline" : "secondary"}>
          {storageStatusLabel(storageStatus)}
        </Badge>
      </CardHeader>
      <CardContent>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell>私有状态</TableCell>
              <TableCell className="text-right font-mono text-xs">
                storage/local/app.db
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>可提交模板</TableCell>
              <TableCell className="text-right font-mono text-xs">
                storage/templates
              </TableCell>
            </TableRow>
            <TableRow>
              <TableCell>当前问题</TableCell>
              <TableCell className="text-right">
                {validationIssueCount}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

function storageStatusLabel(status: string) {
  if (status === "api") {
    return "已写入本地数据库";
  }
  if (status === "saving") {
    return "保存中";
  }
  if (status === "loading") {
    return "正在读取";
  }
  if (status === "error") {
    return "保存被拒绝，草稿保留";
  }
  if (status === "conflict") return "保存冲突";
  if (status === "unknown") return "结果待核验";
  return "仅浏览器草稿";
}
