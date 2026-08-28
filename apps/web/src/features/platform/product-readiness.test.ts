import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf-8");
}

test("platform navigation exposes only the five focused work areas", () => {
  const source = readSource("./types.ts");

  assert.match(source, /title: "总览"/);
  assert.match(source, /title: "量化分析"/);
  assert.match(source, /title: "AI 日历"/);
  assert.match(source, /title: "数据管理"/);
  assert.match(source, /title: "AI 模型配置"/);
  assert.doesNotMatch(source, /K线工作台|策略研究|检查更新/);
  assert.ok(source.indexOf('id: "overview"') < source.indexOf('id: "quant"'));
  assert.ok(source.indexOf('id: "quant"') < source.indexOf('id: "ai"'));
  assert.ok(source.indexOf('id: "ai"') < source.indexOf('id: "data"'));
  assert.ok(source.indexOf('id: "data"') < source.indexOf('id: "ai-settings"'));
});

test("workspace includes first-run onboarding without CSV import copy", () => {
  const source = readSource("./platform-workspace.tsx");

  assert.match(source, /stock-platform-onboarding-v1/);
  assert.match(source, /首次使用/);
  assert.match(source, /storage\/local/);
  assert.doesNotMatch(source, /CSV|TSV|导入文件/);
});

test("screenshot import supports multi-file recognition", () => {
  const source = readSource("./views/position-screenshot-import.tsx");

  assert.match(source, /multiple/);
  assert.match(source, /Array\.from\(event\.currentTarget\.files/);
  assert.match(source, /for \(const \[index, file\] of files\.entries\(\)/);
  assert.match(source, /recognizePositionScreenshot\(await resizeImage\(file\), mode\)/);
});

test("data management is focused on screenshot import and transaction history", () => {
  const source = readSource("./views/data-management-view.tsx");

  assert.match(source, /PositionScreenshotImport/);
  assert.match(source, /手动录入交易/);
  assert.match(source, /交易流水/);
  assert.doesNotMatch(source, /账户与股票池|持仓目标列表|AI 连接设置/);
});

test("AI model settings keeps AI and research data configuration together", () => {
  const source = readSource("./views/ai-model-settings-view.tsx");

  assert.match(source, /AI 连接设置/);
  assert.match(source, /ResearchSettingsCard/);
  assert.match(source, /saveAiSettings/);
});

test("AI advice view confirms private context before sending to AI", () => {
  const source = readSource("./views/ai-advice-view.tsx");

  assert.match(source, /确认发送给 AI/);
  assert.match(source, /账户/);
  assert.match(source, /持仓/);
  assert.match(source, /交易流水/);
  assert.match(source, /行情与策略信号/);
});

test("AI advice follow-ups use an inline conversation without a confirmation dialog", () => {
  const source = readSource("./views/ai-advice-view.tsx");

  assert.match(source, /AI 对话/);
  assert.match(source, /record\.messages\.slice\(1\)/);
  assert.match(source, /AI 正在回复/);
  assert.match(source, /chatMutation\.mutate\(prompt\)/);
  assert.doesNotMatch(source, /确认发送追问/);
  assert.doesNotMatch(source, /setConfirmAction\("chat"\)/);
});

test("strategy view exposes the recent ETF funding pool and 52-week drawdown", () => {
  const source = readSource("./views/strategy-view.tsx");
  assert.match(source, /近期可新投入资金/);
  assert.match(source, /开始新一轮/);
  assert.match(source, /52 周回撤/);
});

test("AI advice view can clear today's follow-up conversation without removing the summary", () => {
  const source = readSource("./views/ai-advice-view.tsx");

  assert.match(source, /清空今日对话/);
  assert.match(source, /clearAiAdviceChat/);
  assert.match(source, /clearChatMutation/);
  assert.match(source, /record\.messages\.slice\(1\)/);
});

test("AI advice calendar is full width and generation lives beside the advice title", () => {
  const source = readSource("./views/ai-advice-view.tsx");

  assert.match(source, /AI 建议日历/);
  assert.match(source, /xl:col-span-2/);
  assert.match(source, /grid-cols-8/);
  assert.match(source, /text-base font-medium/);
  assert.match(source, />\s*AI 建议\s*</);
  assert.match(source, /AI 建议\s*<Button/);
  assert.match(source, /ml-4 sm:ml-12 xl:ml-56/);
  assert.match(source, /variant="secondary"\s*size="default"/);
  assert.doesNotMatch(source, />\s*每日 AI 建议\s*</);
  assert.doesNotMatch(source, /AI 日历记录/);
  assert.doesNotMatch(source, /AI建议日历/);
});

test("AI advice view shows summarized prompt context without duplicate chat history", () => {
  const source = readSource("./views/ai-advice-view.tsx");

  assert.match(source, /AI-prompt/);
  assert.match(source, /AI_PROMPT_CONTEXT_ITEMS/);
  assert.match(source, /账户摘要/);
  assert.match(source, /持仓计划/);
  assert.match(source, /行情信号/);
  assert.doesNotMatch(source, /新闻标题/);
  assert.doesNotMatch(source, /保存的新闻/);
  assert.doesNotMatch(source, /对话记录/);
  assert.doesNotMatch(source, /AI- prompt/);
});

test("AI advice generation avoids the Next rewrite proxy", () => {
  const source = readSource("./api.ts");

  assert.match(source, /AI_REQUEST_BASE_URL/);
  assert.match(source, /http:\/\/127\.0\.0\.1:8000/);
  assert.match(source, /generateAiAdvice[\s\S]*AI_REQUEST_BASE_URL/);
  assert.match(source, /testAiSettings[\s\S]*AI_REQUEST_BASE_URL/);
});

test("AI advice view recovers saved results after interrupted generation", () => {
  const source = readSource("./views/ai-advice-view.tsx");

  assert.match(source, /recoverSavedAiAdvice/);
  assert.match(source, /setQueryData\(\["ai-advice", "default"\], response\)/);
  assert.match(source, /setQueryData\(\["ai-advice", nextDate\], response\)/);
  assert.match(source, /API 5/);
  assert.match(source, /Failed to fetch/);
  assert.match(source, /Load failed/);
});
