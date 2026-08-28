type HoldingConclusionInput = {
  ticker: string;
  effectiveDate: string;
  rating?: string;
  position?: {
    shares: number;
    costBasis: number;
    holdingCost: number;
  };
  latestPrice?: number;
};

export type HoldingConclusion = {
  positionSummary: string;
  decisionSummary: string;
};

export function buildHoldingConclusion({
  ticker,
  effectiveDate,
  rating = "待定",
  position,
  latestPrice,
}: HoldingConclusionInput): HoldingConclusion {
  if (!position || position.shares <= 0) {
    return {
      positionSummary: `当前没有 ${ticker} 持仓。`,
      decisionSummary: `结合 ${effectiveDate} 的研究评级“${rating}”，简洁结论：${actionForRating(rating, false)}。`,
    };
  }

  const hasRealPrice =
    typeof latestPrice === "number" && Number.isFinite(latestPrice) && latestPrice > 0;
  if (!hasRealPrice) {
    return {
      positionSummary: `当前持有 ${formatShares(position.shares)} 股，单位成本 ${formatMoney(position.costBasis)}；最新真实行情暂不可用，无法可靠计算浮动盈亏。`,
      decisionSummary: `结合 ${effectiveDate} 的研究评级“${rating}”，简洁结论：${actionForRating(rating, true)}；不仅依据成本价做决定。`,
    };
  }

  const marketValue = position.shares * latestPrice;
  const pnl = marketValue - position.holdingCost;
  const returnFromCost = position.holdingCost > 0 ? pnl / position.holdingCost : 0;
  const pnlLabel = pnl >= 0 ? "浮盈" : "浮亏";
  return {
    positionSummary: `当前持有 ${formatShares(position.shares)} 股，单位成本 ${formatMoney(position.costBasis)}；按最新真实价格 ${formatMoney(latestPrice)} 计算，${pnlLabel} ${formatMoney(Math.abs(pnl))}（${formatRatio(Math.abs(returnFromCost))}）。`,
    decisionSummary: `结合 ${effectiveDate} 的研究评级“${rating}”和当前${pnlLabel}，简洁结论：${actionForRating(rating, true)}；${decisionGuard(rating, pnl)}。`,
  };
}

function actionForRating(rating: string, hasPosition: boolean) {
  if (rating === "买入") {
    return hasPosition ? "继续持有，并可考虑分批买入" : "可考虑分批买入";
  }
  if (rating === "增持") {
    return hasPosition ? "继续持有，可谨慎分批买入" : "可考虑小额分批买入";
  }
  if (rating === "持有") {
    return hasPosition ? "继续持有" : "暂不买入，继续观察";
  }
  if (rating === "减持") {
    return hasPosition ? "考虑卖出部分持仓" : "暂不买入";
  }
  if (rating === "卖出") {
    return hasPosition ? "考虑卖出持仓" : "暂不买入";
  }
  return "继续观察";
}

function decisionGuard(rating: string, pnl: number) {
  if (rating === "买入" || rating === "增持") {
    return pnl >= 0
      ? "继续遵守研究中的风险条件"
      : "不要只为摊低成本而追加买入";
  }
  if (rating === "减持" || rating === "卖出") {
    return pnl >= 0 ? "可优先保护已有收益" : "不要只因等待回本而继续持有";
  }
  return "当前盈亏不改变该中性研究判断";
}

function formatMoney(value: number) {
  return `$${new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(value)}`;
}

function formatRatio(value: number) {
  return `${(value * 100).toFixed(2)}%`;
}

function formatShares(value: number) {
  return new Intl.NumberFormat("zh-CN", {
    maximumFractionDigits: 6,
    minimumFractionDigits: value < 1 && value > 0 ? 4 : 0,
  }).format(value);
}
