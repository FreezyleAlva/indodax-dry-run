// src/backtest/engine.ts
import type { Candle, ClosedTrade, EquityPoint, PositionState, Signal } from "@/domain/types";
import { floorToIncrement } from "@/execution/orderbook";
import { dailyLoss, wibDate } from "@/risk/risk";
import { FROZEN_CONFIG, warmupBars, type FrozenConfig } from "@/strategy/config";
import { evaluateSignal, nextPositionMark } from "@/strategy/evaluate";
import { planOrders } from "@/strategy/portfolio";

export type PairCost = { buyCost: number; sellCost: number };
export type PairRules = { quantityIncrement: number; minBaseIdr: number };

export type BacktestInput = {
  candles: Record<string, Candle[]>;
  startTime: number;
  endTime: number;
  costs: Record<string, PairCost>;
  rules: Record<string, PairRules>;
  feeRate: number;
  configHash: string;
  config?: FrozenConfig;
};

export type BtPosition = {
  pair: string;
  qty: number;
  costBasis: number;
  entryTime: number;
  entryNotional: number;
  entryFee: number;
  entrySpreadSlip: number;
  highestClose: number;
  lastCandleOpenTime: number;
};

export type BtOrder = {
  time: number;
  pair: string;
  side: "BUY" | "SELL";
  signalCandleOpenTime: number;
  refPrice: number;
  fillPrice: number;
  qty: number;
  notional: number;
  fee: number;
  costVsRef: number;
};

export type BacktestResult = {
  equity: EquityPoint[];
  trades: ClosedTrade[];
  orders: BtOrder[];
  signals: Signal[];
  rejected: { time: number; pair: string; reason: string }[];
  open: BtPosition[];
  finalCash: number;
};

function alignIndex(candles: Candle[]): Map<number, number> {
  const m = new Map<number, number>();
  candles.forEach((c, i) => m.set(c.openTime, i));
  return m;
}

export function runBacktest(input: BacktestInput): BacktestResult {
  const cfg = input.config ?? FROZEN_CONFIG;
  const tf = cfg.timeframeSeconds;
  const lookback = warmupBars(cfg) + 20;
  const pairs = [...cfg.universe];
  const regime = input.candles[cfg.regimePair] ?? [];
  const regimeIdx = alignIndex(regime);
  const idx: Record<string, Map<number, number>> = {};
  for (const p of pairs) idx[p] = alignIndex(input.candles[p] ?? []);
  const times = regime.map((c) => c.openTime).filter((t) => t >= input.startTime && t + tf <= input.endTime);

  let cash = cfg.portfolio.initialCapital;
  const positions = new Map<string, BtPosition>();
  const equity: EquityPoint[] = [];
  const trades: ClosedTrade[] = [];
  const orders: BtOrder[] = [];
  const signals: Signal[] = [];
  const rejected: { time: number; pair: string; reason: string }[] = [];
  let pending: Signal[] = [];
  const dayStart = new Map<string, number>();

  const markAt = (t: number, field: "open" | "close") => {
    let inv = 0;
    for (const p of positions.values()) {
      const i = idx[p.pair]!.get(t);
      const c = i !== undefined ? input.candles[p.pair]![i]! : null;
      if (c) inv += p.qty * c[field] * (1 - input.costs[p.pair]!.sellCost);
    }
    return cash + inv;
  };

  for (const t of times) {
    if (pending.length > 0) {
      const eqOpen = markAt(t, "open");
      for (const sig of pending.filter((s) => s.side === "SELL")) {
        const p = positions.get(sig.pair);
        const i = idx[sig.pair]!.get(t);
        if (!p || i === undefined) continue;
        const ref = input.candles[sig.pair]![i]!.open;
        const price = ref * (1 - input.costs[sig.pair]!.sellCost);
        const notional = p.qty * price;
        const fee = notional * input.feeRate;
        if (notional < input.rules[sig.pair]!.minBaseIdr) { rejected.push({ time: t, pair: sig.pair, reason: "BELOW_MIN_NOTIONAL" }); continue; }
        cash += notional - fee;
        const exitSpreadSlip = p.qty * (ref - price);
        orders.push({ time: t, pair: sig.pair, side: "SELL", signalCandleOpenTime: sig.candleOpenTime, refPrice: ref, fillPrice: price, qty: p.qty, notional, fee, costVsRef: exitSpreadSlip });
        trades.push({
          pair: sig.pair,
          entryTime: p.entryTime * 1000,
          exitTime: t * 1000,
          qty: p.qty,
          entryNotional: p.entryNotional,
          exitNotional: notional,
          fees: p.entryFee + fee,
          spreadCost: p.entrySpreadSlip + exitSpreadSlip,
          slippageCost: 0,
          pnl: notional - fee - p.costBasis,
          exitReason: sig.reasonCode,
        });
        positions.delete(sig.pair);
      }
      const day = wibDate(t * 1000);
      if (!dayStart.has(day)) dayStart.set(day, eqOpen);
      const loss = dailyLoss(dayStart.get(day) ?? null, eqOpen, cfg.risk.dailyLossLimit);
      const plan = planOrders({
        signals: pending.filter((s) => s.side === "BUY"),
        openPairs: new Set(positions.keys()),
        equity: eqOpen,
        cash,
        entriesBlocked: loss.locked ? "DAILY_LOSS_LOCK" : null,
        minNotional: (pair) => input.rules[pair]!.minBaseIdr,
        config: cfg,
      });
      for (const r of plan.rejected) rejected.push({ time: t, pair: r.signal.pair, reason: r.reason });
      for (const e of plan.entries) {
        const i = idx[e.signal.pair]!.get(t);
        if (i === undefined) continue;
        const ref = input.candles[e.signal.pair]![i]!.open;
        const price = ref * (1 + input.costs[e.signal.pair]!.buyCost);
        const budget = Math.min(e.notional, cash);
        const qty = floorToIncrement(budget / (price * (1 + input.feeRate)), input.rules[e.signal.pair]!.quantityIncrement);
        const notional = qty * price;
        if (qty <= 0 || notional < input.rules[e.signal.pair]!.minBaseIdr) { rejected.push({ time: t, pair: e.signal.pair, reason: "BELOW_MIN_NOTIONAL" }); continue; }
        const fee = notional * input.feeRate;
        cash -= notional + fee;
        orders.push({ time: t, pair: e.signal.pair, side: "BUY", signalCandleOpenTime: e.signal.candleOpenTime, refPrice: ref, fillPrice: price, qty, notional, fee, costVsRef: qty * (price - ref) });
        positions.set(e.signal.pair, { pair: e.signal.pair, qty, costBasis: notional + fee, entryTime: t, entryNotional: notional, entryFee: fee, entrySpreadSlip: qty * (price - ref), highestClose: 0, lastCandleOpenTime: e.signal.candleOpenTime });
      }
      pending = [];
    }

    const ri = regimeIdx.get(t);
    const regimeWindow = ri !== undefined ? regime.slice(Math.max(0, ri - lookback + 1), ri + 1) : [];
    for (const pair of pairs) {
      const i = idx[pair]!.get(t);
      if (i === undefined) continue;
      const window = input.candles[pair]!.slice(Math.max(0, i - lookback + 1), i + 1);
      const p = positions.get(pair);
      const state: PositionState = p ? { open: true, qty: p.qty, avgEntryCost: p.costBasis / p.qty, entryTime: p.entryTime, highestClose: p.highestClose, lastCandleOpenTime: p.lastCandleOpenTime } : { open: false };
      const sig = evaluateSignal({ pair, candles: window, regimeCandles: regimeWindow, position: state, config: cfg, configHash: input.configHash });
      signals.push(sig);
      if (p) {
        const m = nextPositionMark(state, sig);
        if (m.open) { p.highestClose = m.highestClose; p.lastCandleOpenTime = m.lastCandleOpenTime; }
      }
      if (sig.side !== "HOLD") pending.push(sig);
    }
    equity.push({ time: (t + tf) * 1000, equity: markAt(t, "close") });
  }

  return { equity, trades, orders, signals, rejected, open: [...positions.values()], finalCash: cash };
}

export function buyAndHold(candles: Candle[], startTime: number, endTime: number, tf: number, capital: number, cost: PairCost, feeRate: number, qtyInc: number): EquityPoint[] {
  const bars = candles.filter((c) => c.openTime >= startTime && c.openTime + tf <= endTime);
  if (bars.length === 0) return [];
  const price = bars[0]!.open * (1 + cost.buyCost);
  const qty = floorToIncrement(capital / (price * (1 + feeRate)), qtyInc);
  const cash = capital - qty * price * (1 + feeRate);
  return bars.map((c) => ({ time: (c.openTime + tf) * 1000, equity: cash + qty * c.close * (1 - cost.sellCost) }));
}
