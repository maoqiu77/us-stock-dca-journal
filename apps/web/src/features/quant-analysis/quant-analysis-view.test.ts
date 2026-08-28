import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf-8");
}

test("quant analysis remains lazy loaded in the simplified navigation", () => {
  const workspace = readSource("../platform/platform-workspace.tsx");
  const navigation = readSource("../platform/types.ts");

  assert.match(workspace, /features\/quant-analysis\/quant-analysis-view/);
  assert.match(workspace, /activeView === "quant"/);
  assert.ok(navigation.indexOf('id: "overview"') < navigation.indexOf('id: "quant"'));
  assert.ok(navigation.indexOf('id: "quant"') < navigation.indexOf('id: "ai"'));
  assert.match(navigation, /title: "数据管理"/);
  assert.match(navigation, /title: "AI 模型配置"/);
});

test("quant view exposes full run lifecycle and historical safeguards", () => {
  const source = readSource("./quant-analysis-view.tsx");

  assert.match(source, /useState<QuantAnalyst\[\]>\(\["technical"\]\)/);
  assert.match(source, /2_000/);
  assert.match(source, /forceRegenerate: true/);
  assert.match(source, /cancelQuantAnalysisRun/);
  assert.match(source, /resumeQuantAnalysisRun/);
  assert.match(source, /createQuantAnalysisReflection/);
  assert.match(source, /历史日期不使用当前社交情绪/);
  assert.match(source, /当前 Polymarket 已排除/);
  assert.match(source, /预计 AI 调用/);
  assert.match(source, /nativeButton=\{false\}/);
});

test("research settings card never asks the API to return a plaintext key", () => {
  const source = readSource("./research-settings-card.tsx");

  assert.match(source, /hasFredApiKey/);
  assert.match(source, /fredApiKeyMasked/);
  assert.match(source, /clearFredApiKey/);
  assert.doesNotMatch(source, /settings\.fredApiKey[^M]/);
});
