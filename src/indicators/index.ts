// src/indicators/index.ts
import type { Candle } from "@/domain/types";

export function smaAt(values: readonly number[], i: number, n: number): number | null {
  if (n <= 0 || i < n - 1 || i >= values.length) return null;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) sum += values[k]!;
  return sum / n;
}

export function highestPrevAt(values: readonly number[], i: number, n: number): number | null {
  if (n <= 0 || i < n || i >= values.length) return null;
  let max = -Infinity;
  for (let k = i - n; k <= i - 1; k++) if (values[k]! > max) max = values[k]!;
  return max;
}

export function trueRangeAt(candles: readonly Candle[], i: number): number | null {
  if (i < 1 || i >= candles.length) return null;
  const c = candles[i]!;
  const pc = candles[i - 1]!.close;
  return Math.max(c.high - c.low, Math.abs(c.high - pc), Math.abs(c.low - pc));
}

export function atrAt(candles: readonly Candle[], i: number, n: number): number | null {
  if (n <= 0 || i < n || i >= candles.length) return null;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) sum += trueRangeAt(candles, k)!;
  return sum / n;
}

export function turnoverAvgAt(candles: readonly Candle[], i: number, n: number): number | null {
  if (n <= 0 || i < n - 1 || i >= candles.length) return null;
  let sum = 0;
  for (let k = i - n + 1; k <= i; k++) sum += candles[k]!.close * candles[k]!.volume;
  return sum / n;
}

export function firstGapIndex(candles: readonly Candle[], from: number, to: number, step: number): number | null {
  for (let k = Math.max(from, 1); k <= to; k++) {
    if (candles[k]!.openTime - candles[k - 1]!.openTime !== step) return k;
  }
  return null;
}
