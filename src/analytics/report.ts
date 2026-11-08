// src/analytics/report.ts
import type { Candle, ClosedTrade, EquityPoint, Signal } from "@/domain/types";
import { runBacktest, type PairCost, type PairRules } from "@/backtest/engine";
import { FROZEN_CONFIG, type FrozenConfig } from "@/strategy/config";
import { computeMetrics, type Metrics } from "./metrics";

export type RawExport = {
  exportedAt: string;
  configHash: string;
  config: FrozenConfig;
  backtestAssumptions: { feeRate: number; costs: Record<string, PairCost>; rules: Record<string, PairRules> };
  tickRuns: { id: number; scheduled_at: string | null; started_at: string; finished_at: string | null; status: string; duration_ms: number | null; scheduler_source: string | null; error_code: string | null; processed_count: number; request_count: number | null; retry_count: number | null }[];
  signals: { id: number; tick_id: number; pair: string; candle_open_time: number; side: string; reason_code: string; feature_json: Record<string, unknown>; strategy_version: string; config_hash: string; created_at: string }[];
  orders: { id: number; tick_id: number; signal_id: number | null; pair: string; side: string; status: string; reject_reason: string | null; requested_notional: number | null; filled_qty: number; avg_fill: number | null; notional: number; fee: number; bid_at_decision: number | null; ask_at_decision: number | null; mid_at_decision: number | null; signal_price: number | null; spread_cost: number; slippage_cost: number; created_at: string }[];
  positions: { id: number; pair: string; qty: number; cost_basis: number; entry_fee: number; entry_spread_cost: number; entry_slippage_cost: number; opened_at: string; entry_order_id: number | null; status: string; closed_at: string | null; exit_order_id: number | null; exit_reason: string | null; realized_pnl: number | null }[];
  equity: { id: number; tick_id: number; captured_at: string; local_trading_date: string; phase: string; cash: number; inventory_value_at_bid: number; equity: number; realized_pnl: number; unrealized_pnl: number; is_day_start: boolean; stale_marks: number }[];
  ledger: { id: number; event_time: string; event_type: string; currency: string; amount: number; idempotency_key: string }[];
  riskEvents: { id: number; tick_id: number | null; occurred_at: string; rule: string; state: string; action: string; pair: string | null; reason: string | null; observed_value: number | null; threshold: number | null }[];
  systemEvents: { id: number; tick_id: number | null; occurred_at: string; severity: string; component: string; event_code: string; sanitized_payload: unknown }[];
  books: { id: number; tick_id: number; pair: string; captured_at: string; best_bid: number | null; best_ask: number | null; spread_bps: number | null; valid: boolean; invalid_reason: string | null }[];
  rawResponses: { id: number; tick_id: number; endpoint: string; status: number | null; attempts: number | null; latency_ms: number | null; error_code: string | null; received_at: string }[];
  candles: { pair: string; open_time: number; open: number; high: number; low: number; close: number; volume: number }[];
};

export type ParityRow = { pair: string; candleOpenTime: number; forward: string | null; backtest: string | null; match: boolean; reason: string };

export type Report = {
  generatedFrom: string;
  configHash: string;
  strategyVersion: string;
  botStart: string | null;
  lastTick: string | null;
  portfolio: { cash: number; inventoryAtBid: number; equity: number; realizedPnl: number; unrealizedPnl: number; openPositions: { pair: string; qty: number; costBasis: number; openedAt: string }[] } | null;
  forward: Metrics;
  forwardEquity: EquityPoint[];
  forwardTrades: ClosedTrade[];
  sameWindowBacktest: { start: string | null; end: string | null; metrics: Metrics; equity: EquityPoint[]; trades: ClosedTrade[] };
  benchmark: { name: string; metrics: Metrics; equity: EquityPoint[] } | null;
  costs: { fees: number; spread: number; slippage: number; costRatio: number | null; filledOrders: number; spreadBpsByPair: Record<string, { n: number; p50: number | null; p90: number | null; max: number | null }> };
  parity: { compared: number; matches: number; mismatches: number; rate: number | null; byReason: Record<string, number>; rows: ParityRow[] };
  operations: { ticks: number; byStatus: Record<string, number>; scheduledCandles: number; onTimeCandles: number; uptime: number | null; officialWindowCandles: number; officialWindowOnTime: number; officialUptime: number | null; latencyP50: number | null; latencyP95: number | null; apiErrors: number; retries: number; schedulerDriftP50Sec: number | null; bySource: Record<string, number> };
  safety: { killSwitchEvents: number; dailyLossEvents: number; rejectedByReason: Record<string, number> };
  dataHealth: { lastClosedAgeSecByPair: Record<string, number | null>; missedCandleEvents: number; invalidBooks: number; spreadRejects: number; invalidCandleEvents: number };
};

function pct(xs: number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const i = Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1));
  return s[i]!;
}

function count<T>(xs: readonly T[], key: (x: T) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const x of xs) out[key(x)] = (out[key(x)] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

function ms(s: string | null): number {
  return s ? Date.parse(s) : NaN;
}

export function forwardTrades(raw: RawExport): ClosedTrade[] {
  const byId = new Map(raw.orders.map((o) => [o.id, o]));
  return raw.positions
    .filter((p) => p.status === "CLOSED" && p.entry_order_id !== null && p.exit_order_id !== null)
    .map((p) => {
      const en = byId.get(p.entry_order_id!)!;
      const ex = byId.get(p.exit_order_id!)!;
      return {
        pair: p.pair,
        entryTime: ms(en.created_at),
        exitTime: ms(ex.created_at),
        qty: ex.filled_qty,
        entryNotional: en.notional,
        exitNotional: ex.notional,
        fees: en.fee + ex.fee,
        spreadCost: en.spread_cost + ex.spread_cost,
        slippageCost: en.slippage_cost + ex.slippage_cost,
        pnl: Number(p.realized_pnl ?? 0),
        exitReason: p.exit_reason ?? "",
      };
    })
    .sort((a, b) => a.exitTime - b.exitTime);
}

export function buildReport(raw: RawExport): Report {
  const cfg = raw.config ?? FROZEN_CONFIG;
  const tf = cfg.timeframeSeconds;
  const okTicks = raw.tickRuns.filter((t) => t.status !== "SKIPPED_LOCKED");
  const botStartMs = okTicks.length > 0 ? Math.min(...okTicks.map((t) => ms(t.started_at))) : NaN;
  const lastTickMs = okTicks.length > 0 ? Math.max(...okTicks.map((t) => ms(t.started_at))) : NaN;
  const post = raw.equity.filter((e) => e.phase === "POST_TRADE").sort((a, b) => a.id - b.id);
  const forwardEquity: EquityPoint[] = [{ time: Number.isFinite(botStartMs) ? botStartMs : 0, equity: cfg.portfolio.initialCapital }, ...post.map((e) => ({ time: ms(e.captured_at), equity: e.equity }))];
  const trades = forwardTrades(raw);
  const forward = computeMetrics(post.length > 0 ? forwardEquity : [], trades, { annualize: false });
  const last = post[post.length - 1];
  const openPos = raw.positions.filter((p) => p.status === "OPEN");

  const candlesByPair: Record<string, Candle[]> = {};
  for (const c of raw.candles) (candlesByPair[c.pair] ??= []).push({ openTime: c.open_time, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
  for (const k of Object.keys(candlesByPair)) candlesByPair[k]!.sort((a, b) => a.openTime - b.openTime);

  const fwdSignals = raw.signals.filter((s) => s.strategy_version === cfg.strategyVersion);
  const firstSignalCandle = fwdSignals.length > 0 ? Math.min(...fwdSignals.map((s) => s.candle_open_time)) : null;
  const lastSignalCandle = fwdSignals.length > 0 ? Math.max(...fwdSignals.map((s) => s.candle_open_time)) : null;
  let replay = { equity: [] as EquityPoint[], trades: [] as ClosedTrade[], signals: [] as Signal[] };
  if (firstSignalCandle !== null && lastSignalCandle !== null && candlesByPair[cfg.regimePair]) {
    const r = runBacktest({ candles: candlesByPair, startTime: firstSignalCandle, endTime: lastSignalCandle + tf, costs: raw.backtestAssumptions.costs, rules: raw.backtestAssumptions.rules, feeRate: raw.backtestAssumptions.feeRate, configHash: raw.configHash, config: cfg });
    replay = { equity: r.equity, trades: r.trades, signals: r.signals };
  }
  const sameWindowMetrics = computeMetrics(replay.equity.length > 0 ? [{ time: (firstSignalCandle! + tf) * 1000 - 1, equity: cfg.portfolio.initialCapital }, ...replay.equity] : [], replay.trades, { annualize: false });

  const btMap = new Map(replay.signals.map((s) => [`${s.pair}|${s.candleOpenTime}`, s]));
  const rows: ParityRow[] = [];
  for (const s of fwdSignals.slice().sort((a, b) => a.candle_open_time - b.candle_open_time || (a.pair < b.pair ? -1 : 1))) {
    const b = btMap.get(`${s.pair}|${s.candle_open_time}`);
    const fwdT = `${s.side}:${s.reason_code}`;
    const btT = b ? `${b.side}:${b.reasonCode}` : null;
    let reason = "MATCH";
    if (!b) reason = "NO_BACKTEST_SIGNAL";
    else if (b.side !== s.side) reason = "SIDE_DIFFERS";
    else if (b.reasonCode !== s.reason_code) reason = "REASON_DIFFERS";
    rows.push({ pair: s.pair, candleOpenTime: s.candle_open_time, forward: fwdT, backtest: btT, match: reason === "MATCH", reason });
  }
  const matches = rows.filter((r) => r.match).length;

  let benchmark: Report["benchmark"] = null;
  const btcBooks = raw.books.filter((b) => b.pair === cfg.regimePair && b.valid && b.best_ask && b.best_bid).sort((a, b) => a.id - b.id);
  if (btcBooks.length > 0) {
    const fee = raw.backtestAssumptions.feeRate;
    const inc = raw.backtestAssumptions.rules[cfg.regimePair]?.quantityIncrement ?? 1e-8;
    const qty = Math.floor(cfg.portfolio.initialCapital / (btcBooks[0]!.best_ask! * (1 + fee)) / inc) * inc;
    const cash = cfg.portfolio.initialCapital - qty * btcBooks[0]!.best_ask! * (1 + fee);
    const eq = btcBooks.map((b) => ({ time: ms(b.captured_at), equity: cash + qty * b.best_bid! }));
    benchmark = { name: "BTC/IDR buy and hold (beli di best ask snapshot pertama, mark di best bid)", metrics: computeMetrics([{ time: eq[0]!.time, equity: cfg.portfolio.initialCapital }, ...eq], [], { annualize: false }), equity: eq };
  }

  const filled = raw.orders.filter((o) => o.status === "FILLED" || o.status === "PARTIAL");
  const spreadBpsByPair: Report["costs"]["spreadBpsByPair"] = {};
  for (const pair of cfg.universe) {
    const xs = raw.books.filter((b) => b.pair === pair && b.spread_bps !== null).map((b) => b.spread_bps!);
    spreadBpsByPair[pair] = { n: xs.length, p50: pct(xs, 0.5), p90: pct(xs, 0.9), max: xs.length ? Math.max(...xs) : null };
  }

  const firstByCandle = new Map<string, number>();
  for (const s of fwdSignals) firstByCandle.set(`${s.pair}|${s.candle_open_time}`, ms(s.created_at));
  const coverage = (fromMs: number, toMs: number) => {
    let scheduled = 0;
    let onTime = 0;
    if (!(toMs > fromMs)) return { scheduled, onTime };
    const firstOpen = Math.ceil(fromMs / 1000 / tf) * tf - tf;
    for (let open = firstOpen; (open + tf) * 1000 <= toMs; open += tf) {
      if ((open + tf) * 1000 < fromMs) continue;
      for (const pair of cfg.universe) {
        scheduled++;
        const at = firstByCandle.get(`${pair}|${open}`);
        if (at !== undefined && at < (open + 2 * tf) * 1000) onTime++;
      }
    }
    return { scheduled, onTime };
  };
  const nowMs = Number.isFinite(lastTickMs) ? lastTickMs : 0;
  const since = coverage(botStartMs, nowMs);
  const officialEnd = Math.min(Date.parse(cfg.backtest.forwardEnd), nowMs);
  const official = coverage(Date.parse(cfg.backtest.forwardStart), officialEnd);
  const lat = okTicks.map((t) => t.duration_ms ?? 0).filter((x) => x > 0);
  const drift = okTicks.filter((t) => t.scheduled_at).map((t) => (ms(t.started_at) - ms(t.scheduled_at)) / 1000);

  const lastClosedAgeSecByPair: Record<string, number | null> = {};
  for (const pair of cfg.universe) {
    const xs = candlesByPair[pair];
    lastClosedAgeSecByPair[pair] = xs && xs.length && Number.isFinite(lastTickMs) ? Math.round(lastTickMs / 1000 - (xs[xs.length - 1]!.openTime + tf)) : null;
  }

  const rejected = raw.orders.filter((o) => o.status === "REJECTED");
  return {
    generatedFrom: raw.exportedAt,
    configHash: raw.configHash,
    strategyVersion: cfg.strategyVersion,
    botStart: Number.isFinite(botStartMs) ? new Date(botStartMs).toISOString() : null,
    lastTick: Number.isFinite(lastTickMs) ? new Date(lastTickMs).toISOString() : null,
    portfolio: last ? { cash: last.cash, inventoryAtBid: last.inventory_value_at_bid, equity: last.equity, realizedPnl: last.realized_pnl, unrealizedPnl: last.unrealized_pnl, openPositions: openPos.map((p) => ({ pair: p.pair, qty: p.qty, costBasis: p.cost_basis, openedAt: p.opened_at })) } : null,
    forward,
    forwardEquity: post.length > 0 ? forwardEquity : [],
    forwardTrades: trades,
    sameWindowBacktest: { start: firstSignalCandle !== null ? new Date(firstSignalCandle * 1000).toISOString() : null, end: lastSignalCandle !== null ? new Date((lastSignalCandle + tf) * 1000).toISOString() : null, metrics: sameWindowMetrics, equity: replay.equity, trades: replay.trades },
    benchmark,
    costs: {
      fees: filled.reduce((s, o) => s + o.fee, 0),
      spread: filled.reduce((s, o) => s + o.spread_cost, 0),
      slippage: filled.reduce((s, o) => s + o.slippage_cost, 0),
      costRatio: forward.costRatio,
      filledOrders: filled.length,
      spreadBpsByPair,
    },
    parity: { compared: rows.length, matches, mismatches: rows.length - matches, rate: rows.length ? matches / rows.length : null, byReason: count(rows, (r) => r.reason), rows },
    operations: {
      ticks: raw.tickRuns.length,
      byStatus: count(raw.tickRuns, (t) => t.status),
      scheduledCandles: since.scheduled,
      onTimeCandles: since.onTime,
      uptime: since.scheduled ? since.onTime / since.scheduled : null,
      officialWindowCandles: official.scheduled,
      officialWindowOnTime: official.onTime,
      officialUptime: official.scheduled ? official.onTime / official.scheduled : null,
      latencyP50: pct(lat, 0.5),
      latencyP95: pct(lat, 0.95),
      apiErrors: raw.rawResponses.filter((r) => r.error_code).length,
      retries: raw.rawResponses.reduce((s, r) => s + Math.max(0, (r.attempts ?? 1) - 1), 0),
      schedulerDriftP50Sec: pct(drift, 0.5),
      bySource: count(raw.tickRuns, (t) => t.scheduler_source ?? "?"),
    },
    safety: {
      killSwitchEvents: raw.riskEvents.filter((r) => r.rule === "KILL_SWITCH").length,
      dailyLossEvents: raw.riskEvents.filter((r) => r.rule === "DAILY_LOSS").length,
      rejectedByReason: count(rejected, (o) => o.reject_reason ?? "?"),
    },
    dataHealth: {
      lastClosedAgeSecByPair,
      missedCandleEvents: raw.systemEvents.filter((e) => e.event_code === "MISSED_CANDLES").length,
      invalidBooks: raw.books.filter((b) => !b.valid).length,
      spreadRejects: raw.books.filter((b) => b.invalid_reason === "SPREAD_TOO_WIDE").length,
      invalidCandleEvents: raw.systemEvents.filter((e) => e.event_code === "INVALID_CANDLES").length,
    },
  };
}
