# AI 追问发送快捷键设计

## 目标

调整 AI 建议页面的追问输入框交互：单独按 `Enter` 换行，使用 `Control/Ctrl + Enter` 发送追问。

## 范围

- 仅修改 `apps/web/src/features/platform/views/ai-advice-view.tsx` 的追问输入框。
- 保留底部“发送追问”按钮的现有行为。
- 不改变日报生成、追问 API、历史记录或其他输入框的交互。

## 交互规则

1. `Control/Ctrl + Enter`：阻止 textarea 默认换行，并调用现有追问提交函数。
2. 单独 `Enter`：不拦截，保留 textarea 换行行为。
3. `Shift + Enter`：不拦截，保留 textarea 换行行为。
4. 输入为空、AI 未配置或请求进行中时，快捷键仍由现有提交函数负责忽略发送。
5. 输入框占位提示更新为“Control + Enter 发送，Enter 换行”。

## 实现方案

抽取一个纯快捷键判断函数，接收键盘事件并返回是否为发送组合键。组件的 `onKeyDown` 仅在该函数返回 true 时调用 `preventDefault()` 和现有 `submitChat()`。这样快捷键边界可以通过 Node 测试直接验证，不需要为此引入新的浏览器测试依赖。

## 测试与验收

- 新增测试覆盖：Control/Ctrl + Enter 识别为发送；普通 Enter、Shift + Enter 和不带 Control 的组合不识别为发送。
- 先运行新测试确认在实现前失败，再实现最小改动并运行测试确认通过。
- 运行前端完整测试、lint 和 build，确认没有破坏现有功能。
