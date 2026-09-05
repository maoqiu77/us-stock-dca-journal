import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

import type { UpdateCheckResponse } from "@/features/platform/api";

const moduleUrl = new URL("./software-update-action.ts", import.meta.url);

function updateCheck(
  patch: Partial<UpdateCheckResponse> = {}
): UpdateCheckResponse {
  return {
    currentVersion: "v1.3.1",
    latestVersion: "v1.3.1",
    updateAvailable: false,
    canInstall: false,
    platform: "windows-x64",
    repo: "owner/repo",
    releaseUrl: "https://example.test/release",
    asset: null,
    message: "当前已经是最新版。",
    ...patch,
  };
}

test("update checks prompt before installing an available release", async () => {
  assert.ok(existsSync(moduleUrl), "software update action helper is missing");
  const { resolveUpdateCheckAction } = await import(moduleUrl.href);

  assert.deepEqual(
    resolveUpdateCheckAction(
      updateCheck({
        latestVersion: "v1.4.0",
        updateAvailable: true,
        canInstall: true,
        message: "发现新版本，可以一键更新。",
      })
    ),
    { kind: "confirm", message: "发现新版本，可以一键更新。" }
  );
});

test("update checks report when the installed release is current", async () => {
  assert.ok(existsSync(moduleUrl), "software update action helper is missing");
  const { resolveUpdateCheckAction } = await import(moduleUrl.href);

  assert.deepEqual(resolveUpdateCheckAction(updateCheck()), {
    kind: "latest",
    message: "当前已经是最新版。",
  });
});

test("update checks explain why an available release cannot be installed", async () => {
  assert.ok(existsSync(moduleUrl), "software update action helper is missing");
  const { resolveUpdateCheckAction } = await import(moduleUrl.href);

  assert.deepEqual(
    resolveUpdateCheckAction(
      updateCheck({
        latestVersion: "v1.4.0",
        updateAvailable: true,
        message: "发现新版本，但安装包缺少 sha256 校验值。",
      })
    ),
    {
      kind: "unavailable",
      message: "发现新版本，但安装包缺少 sha256 校验值。",
    }
  );
});

test("a failed check takes priority over a cached successful result", async () => {
  assert.ok(existsSync(moduleUrl), "software update action helper is missing");
  const updateAction = await import(moduleUrl.href);

  assert.equal(
    typeof updateAction.resolveUpdateStatusMessage,
    "function",
    "update status message resolver is missing"
  );
  assert.equal(
    updateAction.resolveUpdateStatusMessage({
      updateStatusMessage: "",
      updateCheckMessage: "当前已经是最新版。",
      checkErrorMessage: "无法连接 GitHub Release。",
    }),
    "无法连接 GitHub Release。"
  );
});
