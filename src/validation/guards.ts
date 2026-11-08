// src/validation/guards.ts
import type { Candle, OrderBook } from "@/domain/types";

export type CandleCheck = { valid: Candle[]; invalid: { openTime: number; reason: string }[] };

export function validateCandles(candles: readonly Candle[]): CandleCheck {
  const valid: Candle[] = [];
  const invalid: { openTime: number; reason: string }[] = [];
  for (const c of candles) {
    const nums = [c.openTime, c.open, c.high, c.low, c.close, c.volume];
    if (nums.some((v) => !Number.isFinite(v))) { invalid.push({ openTime: c.openTime, reason: "NON_FINITE" }); continue; }
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) { invalid.push({ openTime: c.openTime, reason: "NON_POSITIVE_PRICE" }); continue; }
    if (c.volume < 0) { invalid.push({ openTime: c.openTime, reason: "NEGATIVE_VOLUME" }); continue; }
    if (c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) || c.low > c.high) { invalid.push({ openTime: c.openTime, reason: "OHLC_INCONSISTENT" }); continue; }
    valid.push(c);
  }
  return { valid, invalid };
}

export function closedCandles(candles: readonly Candle[], serverTimeSec: number, tfSec: number): Candle[] {
  return candles.filter((c) => c.openTime + tfSec <= serverTimeSec);
}

export function latestClosedOpenTime(serverTimeSec: number, tfSec: number): number {
  return Math.floor(serverTimeSec / tfSec) * tfSec - tfSec;
}

export function staleness(lastClosed: Candle | undefined, serverTimeSec: number, tfSec: number, staleBars: number): { stale: boolean; ageSec: number | null } {
  if (!lastClosed) return { stale: true, ageSec: null };
  const ageSec = serverTimeSec - (lastClosed.openTime + tfSec);
  return { stale: ageSec > staleBars * tfSec, ageSec };
}

export type BookCheck = { ok: boolean; reason: string | null; bestBid: number; bestAsk: number; mid: number; spread: number | null };

export function validateBook(book: OrderBook, spreadMax: number): BookCheck {
  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[0]?.price ?? 0;
  const mid = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
  const spread = mid > 0 ? (bestAsk - bestBid) / mid : null;
  const base = { bestBid, bestAsk, mid, spread };
  if (book.bids.length === 0) return { ok: false, reason: "EMPTY_BIDS", ...base };
  if (book.asks.length === 0) return { ok: false, reason: "EMPTY_ASKS", ...base };
  for (const lv of [...book.bids, ...book.asks]) {
    if (!Number.isFinite(lv.price) || !Number.isFinite(lv.qty) || lv.price <= 0 || lv.qty <= 0) return { ok: false, reason: "MALFORMED_LEVEL", ...base };
  }
  for (let i = 1; i < book.bids.length; i++) if (book.bids[i]!.price > book.bids[i - 1]!.price) return { ok: false, reason: "BIDS_UNSORTED", ...base };
  for (let i = 1; i < book.asks.length; i++) if (book.asks[i]!.price < book.asks[i - 1]!.price) return { ok: false, reason: "ASKS_UNSORTED", ...base };
  if (bestBid >= bestAsk) return { ok: false, reason: "CROSSED_BOOK", ...base };
  if (spread !== null && spread > spreadMax) return { ok: false, reason: "SPREAD_TOO_WIDE", ...base };
  return { ok: true, reason: null, ...base };
}
