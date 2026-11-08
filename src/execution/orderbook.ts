// src/execution/orderbook.ts
import type { BookLevel, FillLevel, FillResult } from "@/domain/types";

export function floorToIncrement(value: number, increment: number): number {
  if (!(increment > 0)) return value;
  const decimals = Math.max(0, Math.ceil(-Math.log10(increment)) + 2);
  const units = Math.floor(value / increment + 1e-9);
  return Number((units * increment).toFixed(decimals));
}

function bookTop(bids: readonly BookLevel[], asks: readonly BookLevel[]) {
  const bestBid = bids.length > 0 ? bids[0]!.price : 0;
  const bestAsk = asks.length > 0 ? asks[0]!.price : 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
  return { bestBid, bestAsk, mid };
}

function rejected(side: "BUY" | "SELL", reason: string, requestedQty: number, requestedNotional: number, top: { bestBid: number; bestAsk: number; mid: number }): FillResult {
  return {
    side,
    status: "REJECTED",
    rejectReason: reason,
    requestedQty,
    requestedNotional,
    filledQty: 0,
    avgPrice: 0,
    notional: 0,
    fee: 0,
    levels: [],
    ...top,
    spreadCost: 0,
    slippageCost: 0,
  };
}

export type BuyParams = {
  asks: readonly BookLevel[];
  bids: readonly BookLevel[];
  budgetIdr: number;
  feeRate: number;
  quantityIncrement: number;
  minNotional: number;
};

export function simulateBuy(p: BuyParams): FillResult {
  const top = bookTop(p.bids, p.asks);
  if (p.asks.length === 0) return rejected("BUY", "NO_ASKS", 0, p.budgetIdr, top);
  let remaining = p.budgetIdr;
  const levels: FillLevel[] = [];
  let qty = 0;
  let notional = 0;
  for (let i = 0; i < p.asks.length && remaining > 0; i++) {
    const lv = p.asks[i]!;
    const affordable = remaining / (lv.price * (1 + p.feeRate));
    const take = floorToIncrement(Math.min(lv.qty, affordable), p.quantityIncrement);
    if (take <= 0) break;
    const cost = take * lv.price;
    levels.push({ levelIndex: i, price: lv.price, levelQty: lv.qty, filledQty: take });
    qty += take;
    notional += cost;
    remaining -= cost * (1 + p.feeRate);
    if (take < lv.qty) break;
  }
  qty = floorToIncrement(qty, p.quantityIncrement);
  if (qty <= 0) return rejected("BUY", "ZERO_FILL", 0, p.budgetIdr, top);
  if (notional < p.minNotional) return rejected("BUY", "BELOW_MIN_NOTIONAL", qty, p.budgetIdr, top);
  const avg = notional / qty;
  const lastLevel = levels[levels.length - 1]!;
  const depthExhausted = levels.length === p.asks.length && lastLevel.filledQty >= lastLevel.levelQty && remaining >= p.minNotional;
  return {
    side: "BUY",
    status: depthExhausted ? "PARTIAL" : "FILLED",
    rejectReason: depthExhausted ? "DEPTH_EXHAUSTED_REMAINDER_CANCELLED" : null,
    requestedQty: qty,
    requestedNotional: p.budgetIdr,
    filledQty: qty,
    avgPrice: avg,
    notional,
    fee: notional * p.feeRate,
    levels,
    ...top,
    spreadCost: qty * (top.bestAsk - top.mid),
    slippageCost: qty * (avg - top.bestAsk),
  };
}

export type SellParams = {
  bids: readonly BookLevel[];
  asks: readonly BookLevel[];
  qty: number;
  feeRate: number;
  quantityIncrement: number;
  minNotional: number;
};

export function simulateSell(p: SellParams): FillResult {
  const top = bookTop(p.bids, p.asks);
  const want = floorToIncrement(p.qty, p.quantityIncrement);
  if (p.bids.length === 0) return rejected("SELL", "NO_BIDS", want, 0, top);
  if (want <= 0) return rejected("SELL", "ZERO_QTY", want, 0, top);
  let remaining = want;
  const levels: FillLevel[] = [];
  let qty = 0;
  let notional = 0;
  for (let i = 0; i < p.bids.length && remaining > 0; i++) {
    const lv = p.bids[i]!;
    const take = floorToIncrement(Math.min(lv.qty, remaining), p.quantityIncrement);
    if (take <= 0) break;
    levels.push({ levelIndex: i, price: lv.price, levelQty: lv.qty, filledQty: take });
    qty += take;
    notional += take * lv.price;
    remaining = floorToIncrement(remaining - take, p.quantityIncrement);
  }
  qty = floorToIncrement(qty, p.quantityIncrement);
  if (qty <= 0) return rejected("SELL", "ZERO_FILL", want, 0, top);
  if (notional < p.minNotional) return rejected("SELL", "BELOW_MIN_NOTIONAL", want, 0, top);
  const avg = notional / qty;
  return {
    side: "SELL",
    status: remaining > 0 ? "PARTIAL" : "FILLED",
    rejectReason: remaining > 0 ? "DEPTH_EXHAUSTED_REMAINDER_CANCELLED" : null,
    requestedQty: want,
    requestedNotional: 0,
    filledQty: qty,
    avgPrice: avg,
    notional,
    fee: notional * p.feeRate,
    levels,
    ...top,
    spreadCost: qty * (top.mid - top.bestBid),
    slippageCost: qty * (top.bestBid - avg),
  };
}
