import assert from "node:assert/strict";
import test from "node:test";

import {
  isAiAdviceCompositionEnter,
  isAiAdviceSubmitShortcut,
} from "./ai-advice-shortcut.ts";

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

test("does not submit while an input method is composing Enter", () => {
  assert.equal(
    isAiAdviceSubmitShortcut({
      key: "Enter",
      ctrlKey: true,
      isComposing: true,
    }),
    false
  );
});

test("identifies a composing Enter so it can be prevented without a newline", () => {
  assert.equal(
    isAiAdviceCompositionEnter({
      key: "Enter",
      ctrlKey: false,
      isComposing: true,
    }),
    true
  );
});

test("supports the legacy IME composing key code", () => {
  assert.equal(
    isAiAdviceCompositionEnter({
      key: "Enter",
      ctrlKey: false,
      keyCode: 229,
    }),
    true
  );
});

test("does not treat a normal Enter as an IME composition commit", () => {
  assert.equal(
    isAiAdviceCompositionEnter({
      key: "Enter",
      ctrlKey: false,
      isComposing: false,
      keyCode: 13,
    }),
    false
  );
});
