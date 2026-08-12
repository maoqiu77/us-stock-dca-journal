export type AiAdviceKeyboardEvent = Pick<
  KeyboardEvent,
  "key" | "ctrlKey" | "shiftKey"
>;

export function isAiAdviceSubmitShortcut(
  event: AiAdviceKeyboardEvent
): boolean {
  return event.key === "Enter" && event.ctrlKey;
}
