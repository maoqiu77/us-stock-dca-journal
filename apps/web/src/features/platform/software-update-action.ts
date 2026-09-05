import type { UpdateCheckResponse } from "@/features/platform/api";

export type UpdateCheckAction = {
  kind: "confirm" | "latest" | "unavailable";
  message: string;
};

type UpdateStatusMessages = {
  updateStatusMessage: string;
  updateCheckMessage: string;
  checkErrorMessage: string;
};

export function resolveUpdateCheckAction(
  updateCheck: UpdateCheckResponse
): UpdateCheckAction {
  if (!updateCheck.updateAvailable) {
    return { kind: "latest", message: updateCheck.message };
  }
  if (updateCheck.canInstall) {
    return { kind: "confirm", message: updateCheck.message };
  }
  return { kind: "unavailable", message: updateCheck.message };
}

export function resolveUpdateStatusMessage({
  updateStatusMessage,
  updateCheckMessage,
  checkErrorMessage,
}: UpdateStatusMessages): string {
  return (
    updateStatusMessage ||
    checkErrorMessage ||
    updateCheckMessage ||
    "正在检查更新。"
  );
}
