// src/risk/risk.ts

const WIB_OFFSET_MS = 7 * 3600 * 1000;

export function wibDate(tsMs: number): string {
  return new Date(tsMs + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export function wibDayStartUtcMs(tsMs: number): number {
  const d = wibDate(tsMs);
  return Date.parse(`${d}T00:00:00Z`) - WIB_OFFSET_MS;
}

export type DailyLossState = { locked: boolean; change: number | null; dayStartEquity: number | null };

export function dailyLoss(dayStartEquity: number | null, equity: number, limit: number): DailyLossState {
  if (dayStartEquity === null || !(dayStartEquity > 0)) return { locked: false, change: null, dayStartEquity };
  const change = equity / dayStartEquity - 1;
  return { locked: change <= -limit, change, dayStartEquity };
}

export type EntryGate = {
  killSwitch: boolean;
  dailyLocked: boolean;
  dataStale: boolean;
};

export function entryBlockReason(g: EntryGate): string | null {
  if (g.killSwitch) return "KILL_SWITCH";
  if (g.dailyLocked) return "DAILY_LOSS_LOCK";
  if (g.dataStale) return "STALE_DATA";
  return null;
}
