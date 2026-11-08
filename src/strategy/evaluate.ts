// src/strategy/evaluate.ts
import type { Candle, PositionState, Signal } from "@/domain/types";
import { atrAt, firstGapIndex, highestPrevAt, smaAt, turnoverAvgAt } from "@/indicators";
import { FROZEN_CONFIG, warmupBars, type FrozenConfig } from "./config";

export type EvaluateInput = {
  pair: string;
  candles: readonly Candle[];
  regimeCandles: readonly Candle[];
  position: PositionState;
  config?: FrozenConfig;
  configHash: string;
};

export function evaluateSignal(input: EvaluateInput): Signal {
  const cfg = input.config ?? FROZEN_CONFIG;
  const p = cfg.params;
  const candles = input.candles;
  const i = candles.length - 1;
  const base = {
    pair: input.pair,
    candleOpenTime: i >= 0 ? candles[i]!.openTime : 0,
    strategyVersion: cfg.strategyVersion,
    configHash: input.configHash,
  };
  if (i < 0) return { ...base, side: "HOLD", reasonCode: "NO_DATA", features: {} };

  const need = warmupBars(cfg);
  const last = candles[i]!;
  const position = input.position;
  let highestClose: number | null = null;
  if (position.open) {
    highestClose = position.highestClose;
    for (let k = 0; k <= i; k++) {
      const c = candles[k]!;
      if (c.openTime > position.lastCandleOpenTime && c.close > highestClose) highestClose = c.close;
    }
  }

  if (i + 1 < need) {
    return { ...base, side: "HOLD", reasonCode: "WARMUP", features: { bars: i + 1, need, highestClose } };
  }

  const gapAt = firstGapIndex(candles, i - need + 1, i, cfg.timeframeSeconds);
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const hh = highestPrevAt(highs, i, p.breakout);
  const sma = smaAt(closes, i, p.trendMa);
  const atr = atrAt(candles, i, p.atrWindow);
  const turnover = turnoverAvgAt(candles, i, p.liquidityWindow);

  const r = input.regimeCandles;
  let ri = -1;
  for (let k = r.length - 1; k >= 0; k--) {
    if (r[k]!.openTime === last.openTime) { ri = k; break; }
    if (r[k]!.openTime < last.openTime) break;
  }
  const regimeCloses = r.map((c) => c.close);
  const regimeSma = ri >= 0 ? smaAt(regimeCloses, ri, p.regimeMa) : null;
  const regimeClose = ri >= 0 ? r[ri]!.close : null;
  const regimeGap = ri >= 0 && ri + 1 >= p.regimeMa ? firstGapIndex(r, ri - p.regimeMa + 1, ri, cfg.timeframeSeconds) : null;
  const regimeOn = regimeClose !== null && regimeSma !== null && regimeGap === null ? regimeClose > regimeSma : null;

  const trailStop = highestClose !== null && atr !== null ? highestClose - p.trailAtr * atr : null;
  const breakoutStrength = hh !== null && hh > 0 ? last.close / hh - 1 : null;

  const features = {
    close: last.close,
    hhPrev: hh,
    sma,
    atr,
    turnoverAvg: turnover,
    regimeClose,
    regimeSma,
    regimeOn,
    highestClose,
    trailStop,
    breakoutStrength,
    gap: gapAt !== null,
  };

  if (position.open) {
    if (trailStop !== null && last.close < trailStop) {
      return { ...base, side: "SELL", reasonCode: "TRAIL_STOP", features };
    }
    return { ...base, side: "HOLD", reasonCode: "IN_POSITION", features };
  }

  if (gapAt !== null) return { ...base, side: "HOLD", reasonCode: "DATA_GAP", features };
  if (regimeOn === null) return { ...base, side: "HOLD", reasonCode: "REGIME_DATA_MISSING", features };
  if (hh === null || sma === null || atr === null || turnover === null) {
    return { ...base, side: "HOLD", reasonCode: "INDICATOR_MISSING", features };
  }
  if (!regimeOn) return { ...base, side: "HOLD", reasonCode: "REGIME_OFF", features };
  if (!(last.close > hh)) return { ...base, side: "HOLD", reasonCode: "NO_BREAKOUT", features };
  if (!(last.close > sma)) return { ...base, side: "HOLD", reasonCode: "BELOW_TREND", features };
  return { ...base, side: "BUY", reasonCode: "BREAKOUT_ENTRY", features };
}

export function nextPositionMark(position: PositionState, signal: Signal): PositionState {
  if (!position.open) return position;
  const h = signal.features.highestClose;
  return {
    ...position,
    highestClose: typeof h === "number" ? h : position.highestClose,
    lastCandleOpenTime: Math.max(position.lastCandleOpenTime, signal.candleOpenTime),
  };
}
