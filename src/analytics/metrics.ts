// src/analytics/metrics.ts
import type { ClosedTrade, EquityPoint } from "@/domain/types";

export type Metrics = {
  startEquity: number | null;
  endEquity: number | null;
  totalReturn: number | null;
  cagr: number | null;
  maxDrawdown: number | null;
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  profitFactor: number | null;
  profitFactorInfinite: boolean;
  avgWin: number | null;
  avgLoss: number | null;
  grossProfitPreCost: number;
  totalFees: number;
  totalSpreadCost: number;
  totalSlippageCost: number;
  costRatio: number | null;
  durationDays: number | null;
};

const YEAR_MS = 365.25 * 24 * 3600 * 1000;

export function maxDrawdown(points: readonly EquityPoint[]): number | null {
  if (points.length === 0) return null;
  let peak = -Infinity;
  let mdd = 0;
  for (const p of points) {
    if (p.equity > peak) peak = p.equity;
    if (peak > 0) mdd = Math.min(mdd, p.equity / peak - 1);
  }
  return mdd;
}

export function computeMetrics(points: readonly EquityPoint[], trades: readonly ClosedTrade[], opts: { annualize: boolean }): Metrics {
  const first = points[0];
  const last = points[points.length - 1];
  const startEquity = first ? first.equity : null;
  const endEquity = last ? last.equity : null;
  const totalReturn = startEquity && endEquity !== null ? endEquity / startEquity - 1 : null;
  const durationMs = first && last ? last.time - first.time : null;
  const cagr = opts.annualize && totalReturn !== null && durationMs && durationMs > 0 ? (1 + totalReturn) ** (YEAR_MS / durationMs) - 1 : null;
  const winners = trades.filter((t) => t.pnl > 0);
  const losers = trades.filter((t) => t.pnl <= 0);
  const grossWin = winners.reduce((s, t) => s + t.pnl, 0);
  const grossLoss = losers.reduce((s, t) => s + t.pnl, 0);
  const totalFees = trades.reduce((s, t) => s + t.fees, 0);
  const totalSpreadCost = trades.reduce((s, t) => s + t.spreadCost, 0);
  const totalSlippageCost = trades.reduce((s, t) => s + t.slippageCost, 0);
  const grossProfitPreCost = trades.reduce((s, t) => s + Math.max(0, t.pnl + t.fees + t.spreadCost + t.slippageCost), 0);
  const totalCost = totalFees + totalSpreadCost + totalSlippageCost;
  return {
    startEquity,
    endEquity,
    totalReturn,
    cagr,
    maxDrawdown: maxDrawdown(points),
    trades: trades.length,
    wins: winners.length,
    losses: losers.length,
    winRate: trades.length > 0 ? winners.length / trades.length : null,
    profitFactor: grossLoss < 0 ? grossWin / Math.abs(grossLoss) : null,
    profitFactorInfinite: grossLoss === 0 && grossWin > 0,
    avgWin: winners.length > 0 ? grossWin / winners.length : null,
    avgLoss: losers.length > 0 ? grossLoss / losers.length : null,
    grossProfitPreCost,
    totalFees,
    totalSpreadCost,
    totalSlippageCost,
    costRatio: grossProfitPreCost > 0 ? totalCost / grossProfitPreCost : null,
    durationDays: durationMs !== null ? durationMs / 86400000 : null,
  };
}
