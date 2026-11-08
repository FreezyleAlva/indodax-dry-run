// src/persistence/export.ts
import type { RawExport } from "@/analytics/report";
import backtest from "../../research/output/backtest-summary.json";
import { FROZEN_CONFIG } from "@/strategy/config";
import { configHash } from "@/strategy/hash";
import type { Db } from "./db";

function plain<T>(rows: Record<string, unknown>[]): T[] {
  return rows.map((r) => {
    const o: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) o[k] = v instanceof Date ? v.toISOString() : typeof v === "bigint" ? Number(v) : v;
    return o as T;
  });
}

export async function loadRawExport(db: Db): Promise<RawExport> {
  const q = async <T>(sql: string) => plain<T>((await db.query(sql)).rows);
  const a = backtest.assumptions as unknown as RawExport["backtestAssumptions"];
  return {
    exportedAt: new Date().toISOString(),
    configHash: configHash(FROZEN_CONFIG),
    config: FROZEN_CONFIG,
    backtestAssumptions: { feeRate: a.feeRate, costs: a.costs, rules: a.rules },
    tickRuns: await q(`SELECT id, scheduled_at, started_at, finished_at, status, duration_ms, scheduler_source, error_code, processed_count, request_count, retry_count FROM tick_runs ORDER BY id`),
    signals: await q(`SELECT id, tick_id, pair, candle_open_time, side, reason_code, feature_json, strategy_version, config_hash, created_at FROM signals ORDER BY id`),
    orders: await q(`SELECT id, tick_id, signal_id, pair, side, status, reject_reason, requested_notional, filled_qty, avg_fill, notional, fee, bid_at_decision, ask_at_decision, mid_at_decision, signal_price, spread_cost, slippage_cost, created_at FROM sim_orders ORDER BY id`),
    positions: await q(`SELECT id, pair, qty, cost_basis, entry_fee, entry_spread_cost, entry_slippage_cost, opened_at, entry_order_id, status, closed_at, exit_order_id, exit_reason, realized_pnl FROM positions ORDER BY id`),
    equity: await q(`SELECT id, tick_id, captured_at, local_trading_date, phase, cash, inventory_value_at_bid, equity, realized_pnl, unrealized_pnl, is_day_start, stale_marks FROM equity_snapshots ORDER BY id`),
    ledger: await q(`SELECT id, event_time, event_type, currency, amount, idempotency_key FROM ledger_events ORDER BY id`),
    riskEvents: await q(`SELECT id, tick_id, occurred_at, rule, state, action, pair, reason, observed_value, threshold FROM risk_events ORDER BY id`),
    systemEvents: await q(`SELECT id, tick_id, occurred_at, severity, component, event_code, sanitized_payload FROM system_events ORDER BY id`),
    books: await q(`SELECT id, tick_id, pair, captured_at, best_bid, best_ask, spread_bps, valid, invalid_reason FROM orderbook_snapshots ORDER BY id`),
    rawResponses: await q(`SELECT id, tick_id, endpoint, status, attempts, latency_ms, error_code, received_at FROM raw_responses ORDER BY id`),
    candles: await q(`SELECT pair, open_time, open, high, low, close, volume FROM market_candles WHERE timeframe = '${FROZEN_CONFIG.timeframe}' ORDER BY pair, open_time`),
  };
}
