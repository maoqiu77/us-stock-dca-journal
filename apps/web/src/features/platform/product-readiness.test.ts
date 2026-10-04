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
  assert.match(source, /description: "每日分析与连续对话"/);
  assert.match(source, /title: "交易记录"/);
  assert.match(source, /title: "AI 模型配置"/);
  assert.doesNotMatch(source, /K线工作台|策略研究|检查更新/);
  assert.ok(source.indexOf('id: "overview"') < source.indexOf('id: "ai"'));
  assert.ok(source.indexOf('id: "ai"') < source.indexOf('id: "quant"'));
  assert.ok(source.indexOf('id: "quant"') < source.indexOf('id: "data"'));
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
  assert.match(source, /仅观察/);
  assert.match(source, /加入总览/);
  assert.doesNotMatch(source, /账户与股票池|持仓目标列表|AI 连接设置/);
});

test("AI model settings keeps AI and research data configuration together", () => {
  const source = readSource("./views/ai-model-settings-view.tsx");

  assert.match(source, /AI 连接设置/);
  assert.match(source, /ResearchSettingsCard/);
  assert.match(source, /SoftwareUpdateCard/);
  assert.match(source, /saveAiSettings/);
});

test("AI analysis embeds a unified conversation with server snapshots", () => {
  const source = readSource("../ai-journal/embedded-composer.tsx");
  const view = readSource("./views/ai-advice-view.tsx");

  assert.match(view, /EmbeddedJournalComposer/);
  assert.match(source, /conversationRequest/);
  assert.match(source, /previewJournal/);
  assert.match(source, /confirmJournal/);
  assert.match(source, /发送问题/);
  assert.match(source, /recoverJournalSession/);
  assert.match(source, /投资手记/);
  assert.doesNotMatch(source, /持仓分析|标的快研|确认范围并分析|标的与资料|搜索标的|纳入本轮原文/);
});

test("AI advice uses one conversation engine and retains legacy records", () => {
  const source = readSource("./views/ai-advice-view.tsx");

  assert.match(source, /AI 投资助手/);
  assert.match(source, /record\.messages\.slice\(1\)/);
  assert.match(source, /EmbeddedJournalComposer/);
  assert.doesNotMatch(source, /sendAiAdviceChat|chatMutation/);
  assert.doesNotMatch(source, /确认发送追问/);
  assert.doesNotMatch(source, /setConfirmAction\("chat"\)/);
});

test("AI advice calendar uses a standard week beside the conversation", () => {
  const source = readSource("./views/ai-advice-view.tsx");

  assert.match(source, /AI 分析日历/);
  assert.match(source, /grid-cols-7/);
  assert.match(source, /calendarCells/);
  assert.match(source, /EmbeddedJournalComposer/);
  assert.doesNotMatch(source, /生成每日 AI 分析/);
  assert.doesNotMatch(source, /setConfirmGenerate/);
  assert.doesNotMatch(source, />\s*每日 AI 建议\s*</);
  assert.doesNotMatch(source, /AI 日历记录/);
  assert.doesNotMatch(source, /AI建议日历/);
});

test("AI journal sessions appear in the calendar and can be opened", () => {
  const source = readSource("./views/ai-advice-view.tsx");

  assert.match(source, /fetchJournalCalendar/);
  assert.match(source, /fetchJournalSession/);
  assert.match(source, /openEntry/);
  assert.match(source, /invalidateQueries\(\{ queryKey: \["ai-journal-calendar"\] \}\)/);
  assert.match(source, /window\.sessionStorage\.setItem\("ai-journal-session"/);
});

test("AI advice generation avoids the Next rewrite proxy", () => {
  const source = readSource("./api.ts");

  assert.match(source, /AI_REQUEST_BASE_URL/);
  assert.match(source, /http:\/\/127\.0\.0\.1:8000/);
  assert.match(source, /generateAiAdvice[\s\S]*AI_REQUEST_BASE_URL/);
  assert.match(source, /testAiSettings[\s\S]*AI_REQUEST_BASE_URL/);
});

test("AI advice view recovers saved results after interrupted generation", () => {
  const source = readSource("../ai-journal/embedded-composer.tsx");

  assert.match(source, /recoverJournalSession/);
  assert.match(source, /ai-journal-pending-snapshot/);
  assert.match(source, /setQueryData\(\["ai-journal-session", value.id\], value\)/);
});
