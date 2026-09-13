export type BudgetReservation = { requests: 1; inputUnits: number; outputUnits: number; uncertain: boolean };
export function reservation(inputBytes: number, maxOutputTokens: number): BudgetReservation { return { requests: 1, inputUnits: Math.ceil(inputBytes / 2), outputUnits: maxOutputTokens, uncertain: false }; }
export function uncertain(value: BudgetReservation): BudgetReservation { return { ...value, uncertain: true }; }
