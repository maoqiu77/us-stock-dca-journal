export type AiAdviceKeyboardEvent = {
  key: string;
  ctrlKey: boolean;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

export function isAiAdviceCompositionEnter(
  event: AiAdviceKeyboardEvent
): boolean {
  return (
    event.key === "Enter" &&
    (event.isComposing === true || event.keyCode === 229)
  );
}

export function isAiAdviceSubmitShortcut(
  event: AiAdviceKeyboardEvent
): boolean {
  return (
    event.key === "Enter" &&
    event.ctrlKey &&
    !isAiAdviceCompositionEnter(event)
  );
}
