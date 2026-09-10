import type { LegacyLedgerInput, LegacyDerivedPosition } from "./types.ts";
export type { AssetType, TradeAction, PositionPlan, TradeRecord } from "./types.ts";

export function deriveLegacyPositions(state: LegacyLedgerInput, defaultTargetWeight: number): LegacyDerivedPosition[] {
  const targetByTicker = new Map(
    state.positions.map((position) => [normalizeTicker(position.ticker), position])
  );

  return state.stockPool.map((ticker) => {
    let shares = 0;
    const lots: Array<{ shares: number; cost: number }> = [];
    let firstBuyDate = "";

    state.trades
      .filter((trade) => normalizeTicker(trade.ticker) === ticker)
      .sort((first, second) => first.date.localeCompare(second.date))
      .forEach((trade) => {
        const quantity = Math.max(cleanNumber(trade.shares), 0);
        const price = Math.max(cleanNumber(trade.unitPrice), 0);
        if (!quantity || !price) {
          return;
        }

        if (trade.action === "卖出") {
          const sellQuantity = Math.min(quantity, shares);
          shares -= sellQuantity;
          let remainingSell = sellQuantity;
          while (remainingSell > 1e-9 && lots.length) {
            const lot = lots[0];
            const consumed = Math.min(remainingSell, lot.shares);
            const unitCost = lot.shares > 0 ? lot.cost / lot.shares : 0;
            lot.shares -= consumed;
            lot.cost -= consumed * unitCost;
            remainingSell -= consumed;
            if (lot.shares <= 1e-9) {
              lots.shift();
            }
          }
        } else {
          const amount = cleanNumber(trade.amount);
          const tradeCost = amount > 0 ? amount : quantity * price;
          shares += quantity;
          lots.push({ shares: quantity, cost: tradeCost });
          if (!firstBuyDate) {
            firstBuyDate = trade.date;
          }
        }
      });

    const plan = targetByTicker.get(ticker);
    const costValue = lots.reduce((total, lot) => total + lot.cost, 0);
    return {
      ticker,
      targetWeight: plan?.targetWeight ?? defaultTargetWeight,
      assetType: plan?.assetType ?? "STOCK",
      takeProfitPct: plan?.takeProfitPct ?? 0,
      stopLossPct: plan?.stopLossPct ?? 0,
      purchaseDate: plan?.purchaseDate || firstBuyDate,
      shares: roundNumber(Math.max(shares, 0), 6),
      costBasis: shares > 0 ? roundNumber(costValue / shares, 4) : 0,
      holdingCost: roundNumber(Math.max(costValue, 0), 2),
    };
  });
}

function normalizeTicker(value: string) { return value.trim().toUpperCase(); }
function cleanNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}
function roundNumber(value: number, digits: number) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
