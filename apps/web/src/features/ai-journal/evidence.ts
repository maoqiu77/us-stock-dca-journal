export function indicatorObservationTime(payload: Record<string, unknown>): string | null {
  const value = payload.as_of;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : null;
}
