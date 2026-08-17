import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./platform-workspace.tsx", import.meta.url),
  "utf-8"
);

test("platform workspace lazy-loads non-overview views", () => {
  assert.match(source, /from "next\/dynamic"/);
  assert.doesNotMatch(
    source,
    /import \{ ChartWorkspace \} from "@\/features\/charts\/chart-workspace"/
  );
  assert.doesNotMatch(
    source,
    /import \{ StrategyView \} from "@\/features\/platform\/views\/strategy-view"/
  );
  assert.doesNotMatch(
    source,
    /import \{ AiAdviceView \} from "@\/features\/platform\/views\/ai-advice-view"/
  );
  assert.doesNotMatch(
    source,
    /import \{ DataManagementView \} from "@\/features\/platform\/views\/data-management-view"/
  );
  assert.doesNotMatch(
    source,
    /import \{ SettingsView \} from "@\/features\/platform\/views\/settings-view"/
  );
});

test("platform workspace restores and persists the active view", () => {
  assert.match(source, /stock-platform-active-view-v1/);
  assert.match(source, /localStorage\.getItem\(ACTIVE_VIEW_STORAGE_KEY\)/);
  assert.match(source, /localStorage\.setItem\(ACTIVE_VIEW_STORAGE_KEY, view\)/);
  assert.match(source, /isPlatformView\(storedView\)/);
  assert.match(source, /onViewChange=\{changeActiveView\}/);
  assert.match(source, /onNavigate=\{changeActiveView\}/);
});
