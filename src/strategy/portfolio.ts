// src/strategy/portfolio.ts
import type { Signal } from "@/domain/types";
import { FROZEN_CONFIG, type FrozenConfig } from "./config";

export type EntryPlan = { signal: Signal; notional: number };
export type Rejection = { signal: Signal; reason: string };

export type PlanInput = {
  signals: readonly Signal[];
  openPairs: ReadonlySet<string>;
  equity: number;
  cash: number;
  entriesBlocked: string | null;
  minNotional: (pair: string) => number;
  config?: FrozenConfig;
};

export type Plan = {
  exits: Signal[];
  entries: EntryPlan[];
  rejected: Rejection[];
};

export function rankEntries(signals: readonly Signal[]): Signal[] {
  return signals
    .filter((s) => s.side === "BUY")
    .slice()
    .sort((a, b) => {
      const sa = typeof a.features.breakoutStrength === "number" ? a.features.breakoutStrength : -Infinity;
      const sb = typeof b.features.breakoutStrength === "number" ? b.features.breakoutStrength : -Infinity;
      if (sb !== sa) return sb - sa;
      return a.pair < b.pair ? -1 : a.pair > b.pair ? 1 : 0;
    });
}

export function sizeEntry(signal: Signal, equity: number, cash: number, cfg: FrozenConfig): { notional: number; capReason: string } {
  const pf = cfg.portfolio;
  const byFraction = equity * pf.positionFraction;
  const byCash = cash - equity * pf.cashReserveFraction;
  const turnover = typeof signal.features.turnoverAvg === "number" ? signal.features.turnoverAvg : 0;
  const byLiquidity = turnover * cfg.params.liquidityCap;
  const notional = Math.max(0, Math.min(byFraction, byCash, byLiquidity));
  const capReason = notional === byFraction ? "FRACTION" : notional === byCash ? "CASH_RESERVE" : "LIQUIDITY";
  return { notional, capReason };
}

export function planOrders(input: PlanInput): Plan {
  const cfg = input.config ?? FROZEN_CONFIG;
  const exits = input.signals.filter((s) => s.side === "SELL" && input.openPairs.has(s.pair));
  const rejected: Rejection[] = [];
  const entries: EntryPlan[] = [];
  const ranked = rankEntries(input.signals).filter((s) => !input.openPairs.has(s.pair));
  let slots = cfg.portfolio.maxPositions - (input.openPairs.size - exits.length);
  let cash = input.cash;
  for (const s of ranked) {
    if (input.entriesBlocked) { rejected.push({ signal: s, reason: input.entriesBlocked }); continue; }
    if (slots <= 0) { rejected.push({ signal: s, reason: "MAX_POSITIONS" }); continue; }
    const { notional } = sizeEntry(s, input.equity, cash, cfg);
    if (notional < input.minNotional(s.pair)) { rejected.push({ signal: s, reason: "BELOW_MIN_NOTIONAL" }); continue; }
    entries.push({ signal: s, notional });
    cash -= notional;
    slots -= 1;
  }
  return { exits, entries, rejected };
}
