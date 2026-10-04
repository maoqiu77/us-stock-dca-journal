export function beijingDay(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function calendarCells(month: string): Array<string | null> {
  const [year, number] = month.split("-").map(Number);
  const offset = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return [...Array<null>(offset).fill(null), ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)];
}

export function shiftMonth(month: string, offset: number): string {
  const [year, number] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number - 1 + offset, 1)).toISOString().slice(0, 7);
}
