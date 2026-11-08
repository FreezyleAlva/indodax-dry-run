// tests/core.test.ts
import { describe, expect, it } from "vitest";
import type { Candle, Signal } from "@/domain/types";
import { atrAt, highestPrevAt, smaAt } from "@/indicators";
import { floorToIncrement, simulateBuy, simulateSell } from "@/execution/orderbook";
import { closedCandles, latestClosedOpenTime, staleness, validateBook, validateCandles } from "@/validation/guards";
import { dailyLoss, entryBlockReason, wibDate, wibDayStartUtcMs } from "@/risk/risk";
import { FROZEN_CONFIG, warmupBars } from "@/strategy/config";
import { evaluateSignal } from "@/strategy/evaluate";
import { planOrders, rankEntries } from "@/strategy/portfolio";
import { computeMetrics, maxDrawdown } from "@/analytics/metrics";
import { configHash } from "@/strategy/hash";

const TF = FROZEN_CONFIG.timeframeSeconds;

function series(n: number, f: (i: number) => number, start = 1_700_000_000 - (1_700_000_000 % TF)): Candle[] {
  return Array.from({ length: n }, (_, i) => {
    const c = f(i);
    return { openTime: start + i * TF, open: c, high: c * 1.01, low: c * 0.99, close: c, volume: 10 };
  });
}

describe("indikator", () => {
  it("SMA, highest sebelumnya, ATR", () => {
    expect(smaAt([1, 2, 3, 4], 3, 2)).toBe(3.5);
    expect(smaAt([1, 2, 3], 1, 3)).toBeNull();
    expect(highestPrevAt([5, 9, 1, 2], 3, 2)).toBe(9);
    expect(highestPrevAt([5, 9, 1, 20], 3, 3)).toBe(9);
    const c: Candle[] = [
      { openTime: 0, open: 10, high: 11, low: 9, close: 10, volume: 1 },
      { openTime: 1, open: 10, high: 12, low: 10, close: 11, volume: 1 },
      { openTime: 2, open: 11, high: 11, low: 8, close: 9, volume: 1 },
    ];
    expect(atrAt(c, 2, 2)).toBe((2 + 3) / 2);
  });

  it("hasil indikator di bar terakhir sama untuk jendela pendek dan histori penuh", () => {
    const full = series(600, (i) => 100 + Math.sin(i / 7) * 10 + i * 0.05);
    const win = full.slice(-(warmupBars() + 20));
    const a = smaAt(full.map((x) => x.close), full.length - 1, 100);
    const b = smaAt(win.map((x) => x.close), win.length - 1, 100);
    expect(a).toBe(b);
    expect(atrAt(full, full.length - 1, 20)).toBe(atrAt(win, win.length - 1, 20));
  });
});

describe("candle tertutup dan staleness", () => {
  it("bar yang belum tutup dibuang", () => {
    const c = series(3, () => 100, 0);
    expect(closedCandles(c, 2 * TF + 10, TF).length).toBe(2);
    expect(closedCandles(c, 3 * TF, TF).length).toBe(3);
    expect(latestClosedOpenTime(3 * TF + 5, TF)).toBe(2 * TF);
  });
  it("stale kalau umur > 2 x timeframe", () => {
    const c = series(1, () => 100, 0)[0]!;
    expect(staleness(c, TF + 2 * TF, TF, 2).stale).toBe(false);
    expect(staleness(c, TF + 2 * TF + 1, TF, 2).stale).toBe(true);
    expect(staleness(undefined, 0, TF, 2).stale).toBe(true);
  });
  it("OHLC tidak konsisten ditolak", () => {
    const r = validateCandles([{ openTime: 1, open: 10, high: 9, low: 8, close: 9, volume: 1 }, { openTime: 2, open: 10, high: 11, low: 9, close: 10, volume: 1 }]);
    expect(r.valid.length).toBe(1);
    expect(r.invalid[0]!.reason).toBe("OHLC_INCONSISTENT");
  });
});

describe("validasi order book", () => {
  const book = (bids: [number, number][], asks: [number, number][]) => ({ pair: "x", capturedAt: 0, bids: bids.map(([price, qty]) => ({ price, qty })), asks: asks.map(([price, qty]) => ({ price, qty })) });
  it("kosong, crossed, spread > 2% ditolak", () => {
    expect(validateBook(book([], [[10, 1]]), 0.02).reason).toBe("EMPTY_BIDS");
    expect(validateBook(book([[11, 1]], [[10, 1]]), 0.02).reason).toBe("CROSSED_BOOK");
    expect(validateBook(book([[97, 1]], [[100, 1]]), 0.02).reason).toBe("SPREAD_TOO_WIDE");
    expect(validateBook(book([[99, 1]], [[100, 1]]), 0.02).ok).toBe(true);
    expect(validateBook(book([[99, 0]], [[100, 1]]), 0.02).reason).toBe("MALFORMED_LEVEL");
  });
});

describe("simulator order book", () => {
  const asks = [{ price: 100, qty: 1 }, { price: 101, qty: 2 }, { price: 105, qty: 5 }];
  const bids = [{ price: 99, qty: 1 }, { price: 98, qty: 2 }, { price: 90, qty: 5 }];
  it("BUY satu level", () => {
    const f = simulateBuy({ asks, bids, budgetIdr: 50 * 1.002, feeRate: 0.002, quantityIncrement: 1e-8, minNotional: 10 });
    expect(f.status).toBe("FILLED");
    expect(f.levels.length).toBe(1);
    expect(f.avgPrice).toBe(100);
    expect(f.notional + f.fee).toBeLessThanOrEqual(50 * 1.002 + 1e-9);
  });
  it("BUY multi level, VWAP berbobot kuantitas", () => {
    const f = simulateBuy({ asks, bids, budgetIdr: 302 * 1.002, feeRate: 0.002, quantityIncrement: 1e-8, minNotional: 10 });
    expect(f.levels.length).toBe(2);
    expect(f.filledQty).toBeCloseTo(3, 6);
    expect(f.avgPrice).toBeCloseTo(302 / 3, 6);
    expect(f.slippageCost).toBeCloseTo(3 * (302 / 3 - 100), 4);
    expect(f.spreadCost).toBeCloseTo(3 * (100 - 99.5), 6);
  });
  it("kedalaman habis = partial, sisa dibatalkan", () => {
    const f = simulateBuy({ asks, bids, budgetIdr: 10_000, feeRate: 0.002, quantityIncrement: 1e-8, minNotional: 10 });
    expect(f.status).toBe("PARTIAL");
    expect(f.filledQty).toBeCloseTo(8, 6);
    expect(f.rejectReason).toBe("DEPTH_EXHAUSTED_REMAINDER_CANCELLED");
  });
  it("tanpa likuiditas ditolak, di bawah minimum ditolak", () => {
    expect(simulateBuy({ asks: [], bids, budgetIdr: 100, feeRate: 0.002, quantityIncrement: 1e-8, minNotional: 10 }).status).toBe("REJECTED");
    expect(simulateBuy({ asks, bids, budgetIdr: 5, feeRate: 0.002, quantityIncrement: 1e-8, minNotional: 10 }).rejectReason).toBe("BELOW_MIN_NOTIONAL");
  });
  it("SELL makan bid dari atas, tidak melebihi kuantitas", () => {
    const f = simulateSell({ bids, asks, qty: 2.5, feeRate: 0.002, quantityIncrement: 1e-8, minNotional: 10 });
    expect(f.filledQty).toBeCloseTo(2.5, 8);
    expect(f.avgPrice).toBeCloseTo((99 + 98 * 1.5) / 2.5, 6);
    expect(f.fee).toBeCloseTo(f.notional * 0.002, 8);
  });
  it("pembulatan kuantitas ke increment", () => {
    expect(floorToIncrement(1.234567891, 1e-8)).toBe(1.23456789);
    expect(floorToIncrement(0.3, 0.1)).toBe(0.3);
    expect(floorToIncrement(7.9, 1)).toBe(7);
  });
});

describe("risk", () => {
  it("batas hari WIB dan daily loss", () => {
    expect(wibDate(Date.parse("2026-11-04T16:59:59Z"))).toBe("2026-11-04");
    expect(wibDate(Date.parse("2026-11-04T17:00:00Z"))).toBe("2026-11-05");
    expect(new Date(wibDayStartUtcMs(Date.parse("2026-11-05T03:00:00Z"))).toISOString()).toBe("2026-11-04T17:00:00.000Z");
    expect(dailyLoss(100, 95, 0.05).locked).toBe(true);
    expect(dailyLoss(100, 95.01, 0.05).locked).toBe(false);
    expect(entryBlockReason({ killSwitch: true, dailyLocked: true, dataStale: true })).toBe("KILL_SWITCH");
    expect(entryBlockReason({ killSwitch: false, dailyLocked: false, dataStale: false })).toBeNull();
  });
});

function sig(pair: string, side: "BUY" | "SELL" | "HOLD", strength: number, turnover = 1e12): Signal {
  return { pair, candleOpenTime: 0, side, reasonCode: "X", features: { breakoutStrength: strength, turnoverAvg: turnover }, strategyVersion: "v", configHash: "h" };
}

describe("rencana order portofolio", () => {
  it("ranking breakout terkuat lalu nama pasangan", () => {
    const r = rankEntries([sig("b", "BUY", 0.01), sig("a", "BUY", 0.01), sig("c", "BUY", 0.05), sig("d", "HOLD", 1)]);
    expect(r.map((s) => s.pair)).toEqual(["c", "a", "b"]);
  });
  it("batas posisi, kill switch, minimum notional, batas likuiditas", () => {
    const base = { equity: 100_000_000, cash: 100_000_000, minNotional: () => 10_000 };
    const many = ["a", "b", "c", "d", "e", "f"].map((p, i) => sig(p, "BUY", 1 - i * 0.1));
    const plan = planOrders({ ...base, signals: many, openPairs: new Set(), entriesBlocked: null });
    expect(plan.entries.length).toBe(FROZEN_CONFIG.portfolio.maxPositions);
    expect(plan.rejected.map((r) => r.reason)).toContain("MAX_POSITIONS");
    expect(plan.entries[0]!.notional).toBeCloseTo(18_000_000, 2);
    const blocked = planOrders({ ...base, signals: many, openPairs: new Set(), entriesBlocked: "KILL_SWITCH" });
    expect(blocked.entries.length).toBe(0);
    expect(blocked.rejected.every((r) => r.reason === "KILL_SWITCH")).toBe(true);
    const thin = planOrders({ ...base, signals: [sig("a", "BUY", 1, 100_000)], openPairs: new Set(), entriesBlocked: null });
    expect(thin.rejected[0]!.reason).toBe("BELOW_MIN_NOTIONAL");
    const reserve = planOrders({ ...base, cash: 15_000_000, signals: [sig("a", "BUY", 1)], openPairs: new Set(), entriesBlocked: null });
    expect(reserve.entries[0]!.notional).toBeCloseTo(5_000_000, 2);
  });
});

describe("evaluateSignal", () => {
  const n = warmupBars() + 20;
  const hash = configHash();
  it("warm-up ditahan", () => {
    const c = series(50, () => 100);
    expect(evaluateSignal({ pair: "x", candles: c, regimeCandles: c, position: { open: false }, configHash: hash }).reasonCode).toBe("WARMUP");
  });
  it("breakout di atas tren dengan rezim aktif = BUY", () => {
    const c = series(n, (i) => (i === n - 1 ? 200 : 100 + i * 0.1));
    const s = evaluateSignal({ pair: "x", candles: c, regimeCandles: c, position: { open: false }, configHash: hash });
    expect(s.side).toBe("BUY");
    expect(s.reasonCode).toBe("BREAKOUT_ENTRY");
  });
  it("rezim mati = HOLD REGIME_OFF", () => {
    const c = series(n, (i) => (i === n - 1 ? 200 : 100 + i * 0.1));
    const down = series(n, (i) => 300 - i);
    expect(evaluateSignal({ pair: "x", candles: c, regimeCandles: down, position: { open: false }, configHash: hash }).reasonCode).toBe("REGIME_OFF");
  });
  it("gap di lookback = DATA_GAP, tanpa entry", () => {
    const c = series(n, (i) => (i === n - 1 ? 200 : 100 + i * 0.1));
    const gapped = c.map((x, i) => (i > 100 ? { ...x, openTime: x.openTime + TF } : x));
    expect(evaluateSignal({ pair: "x", candles: gapped, regimeCandles: gapped, position: { open: false }, configHash: hash }).reasonCode).toBe("DATA_GAP");
  });
  it("trailing stop: close < highest close sejak masuk - 5 x ATR = SELL", () => {
    const c = series(n, (i) => (i === n - 1 ? 50 : 100));
    const s = evaluateSignal({ pair: "x", candles: c, regimeCandles: c, position: { open: true, qty: 1, avgEntryCost: 100, entryTime: 0, highestClose: 100, lastCandleOpenTime: c[n - 2]!.openTime }, configHash: hash });
    expect(s.side).toBe("SELL");
    expect(s.reasonCode).toBe("TRAIL_STOP");
  });
  it("deterministik: input sama = output sama", () => {
    const c = series(n, (i) => 100 + Math.sin(i) * 5);
    const a = evaluateSignal({ pair: "x", candles: c, regimeCandles: c, position: { open: false }, configHash: hash });
    const b = evaluateSignal({ pair: "x", candles: c.slice(), regimeCandles: c.slice(), position: { open: false }, configHash: hash });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("metrik", () => {
  it("MDD, PF, win rate, kasus tanpa rugi", () => {
    expect(maxDrawdown([{ time: 0, equity: 100 }, { time: 1, equity: 120 }, { time: 2, equity: 90 }, { time: 3, equity: 130 }])).toBeCloseTo(-0.25, 10);
    const t = (pnl: number) => ({ pair: "x", entryTime: 0, exitTime: 1, qty: 1, entryNotional: 1, exitNotional: 1, fees: 1, spreadCost: 0, slippageCost: 0, pnl, exitReason: "x" });
    const m = computeMetrics([{ time: 0, equity: 100 }, { time: 86400000, equity: 110 }], [t(10), t(-5), t(0)], { annualize: false });
    expect(m.profitFactor).toBeCloseTo(2, 10);
    expect(m.winRate).toBeCloseTo(1 / 3, 10);
    expect(m.cagr).toBeNull();
    const z = computeMetrics([{ time: 0, equity: 100 }], [t(10)], { annualize: false });
    expect(z.profitFactor).toBeNull();
    expect(z.profitFactorInfinite).toBe(true);
  });
});
