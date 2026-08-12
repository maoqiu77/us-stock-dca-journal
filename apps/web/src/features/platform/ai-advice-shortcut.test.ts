import assert from "node:assert/strict";
import test from "node:test";

import { isAiAdviceSubmitShortcut } from "./ai-advice-shortcut.ts";

test("recognizes Control/Ctrl + Enter as the AI follow-up submit shortcut", () => {
  assert.equal(
    isAiAdviceSubmitShortcut({ key: "Enter", ctrlKey: true }),
    true
  );
});

test("keeps plain Enter available for a newline", () => {
  assert.equal(
    isAiAdviceSubmitShortcut({ key: "Enter", ctrlKey: false }),
    false
  );
});

test("keeps Shift + Enter available for a newline", () => {
  assert.equal(
    isAiAdviceSubmitShortcut({ key: "Enter", ctrlKey: false, shiftKey: true }),
    false
  );
});

test("does not submit other keys without Control/Ctrl", () => {
  assert.equal(
    isAiAdviceSubmitShortcut({ key: "Escape", ctrlKey: false }),
    false
  );
});
