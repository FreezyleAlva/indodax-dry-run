// src/strategy/config.ts

export const FROZEN_CONFIG = {
  strategyName: "Freezyle Trend Breakout Crypto",
  strategyVersion: "uas-1.0.0",
  basedOn: "UTS Freezyle Trend Breakout K100 (breakout 150 / SMA100 / trail 5 x ATR20 / rezim SMA200)",
  timeframe: "240",
  timeframeSeconds: 14400,
  regimePair: "btcidr",
  universe: ["btcidr", "ethidr", "xrpidr", "dogeidr", "solidr"],
  params: {
    breakout: 150,
    trendMa: 100,
    atrWindow: 20,
    trailAtr: 5,
    regimeMa: 200,
    liquidityWindow: 20,
    liquidityCap: 0.05,
  },
  portfolio: {
    initialCapital: 100_000_000,
    maxPositions: 5,
    positionFraction: 0.18,
    cashReserveFraction: 0.1,
  },
  risk: {
    dailyLossLimit: 0.05,
    dailyLossBasis: "equity_first_snapshot_wib_day",
    spreadMax: 0.02,
    staleBars: 2,
  },
  execution: {
    feeTaker: 0.002,
    feeSource: "max(api/pairs trade_fee_percent_taker, halaman fee resmi)",
    insufficientDepth: "partial_fill_cancel_remainder",
    bookLevelsStored: 50,
  },
  backtest: {
    start: "2023-11-04T05:00:00Z",
    end: "2026-11-04T05:00:00Z",
    forwardStart: "2026-11-04T05:00:00Z",
    forwardEnd: "2026-11-14T05:00:00Z",
  },
} as const;

export type FrozenConfig = typeof FROZEN_CONFIG;

export function warmupBars(cfg: FrozenConfig = FROZEN_CONFIG): number {
  const p = cfg.params;
  return Math.max(p.breakout + 1, p.trendMa, p.atrWindow + 1, p.regimeMa, p.liquidityWindow);
}
