// src/services/tick.ts
import type { Candle, FillResult, OrderBook, PairMeta, PositionState, Signal } from "@/domain/types";
import { simulateBuy, simulateSell } from "@/execution/orderbook";
import { IndodaxPublicClient, MarketDataError, type FetchResult } from "@/market-data/indodax";
import { ensureSchema, type Db, type Queryable } from "@/persistence/db";
import { dailyLoss, entryBlockReason, wibDate } from "@/risk/risk";
import { FROZEN_CONFIG, warmupBars, type FrozenConfig } from "@/strategy/config";
import { evaluateSignal, nextPositionMark } from "@/strategy/evaluate";
import { configHash, sha256, stableStringify } from "@/strategy/hash";
import { planOrders, sizeEntry } from "@/strategy/portfolio";
import { closedCandles, latestClosedOpenTime, staleness, validateBook, validateCandles } from "@/validation/guards";

export type TickRequest = { source: string; scheduledAt?: string | null };

export type TickSummary = {
  tickId: number | null;
  status: "OK" | "PARTIAL" | "FAILED" | "SKIPPED_LOCKED";
  serverTime: string | null;
  durationMs: number;
  processed: number;
  alreadyProcessed: number;
  signals: { pair: string; candle: string; side: string; reason: string }[];
  orders: { pair: string; side: string; status: string; reason: string | null; qty: number; avg: number }[];
  equity: number | null;
  cash: number | null;
  errors: string[];
};

export type TickDeps = {
  db: Db;
  client?: IndodaxPublicClient;
  config?: FrozenConfig;
  now?: () => number;
  holder?: string;
};

type OpenPos = {
  id: number;
  pair: string;
  qty: number;
  costBasis: number;
  entryFee: number;
  entrySpread: number;
  entrySlip: number;
  highestClose: number;
  lastCandleOpenTime: number;
  openedAt: string;
};

const LEASE_SECONDS = 280;

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function sanitize(msg: string): string {
  return msg.replace(/postgres(ql)?:\/\/[^\s]+/gi, "[db-url]").replace(/Bearer\s+\S+/gi, "Bearer [redacted]").slice(0, 300);
}

export async function bootstrap(db: Db, cfg: FrozenConfig = FROZEN_CONFIG): Promise<void> {
  await ensureSchema(db);
  const hash = configHash(cfg);
  await db.query(
    `INSERT INTO bot_config (config_version, strategy_version, config_hash, timeframe, universe_json, risk_config_json, config_json, frozen_commit_sha)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (config_hash) DO NOTHING`,
    [hash, cfg.strategyVersion, hash, cfg.timeframe, JSON.stringify(cfg.universe), JSON.stringify(cfg.risk), JSON.stringify(cfg), process.env.VERCEL_GIT_COMMIT_SHA ?? null],
  );
  await db.query(`INSERT INTO bot_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
  await db.query(`INSERT INTO bot_lock (id, holder, expires_at) VALUES (1, NULL, to_timestamp(0)) ON CONFLICT (id) DO NOTHING`);
  await db.query(
    `INSERT INTO ledger_events (event_time, event_type, currency, amount, reference_type, idempotency_key)
     VALUES (now(), 'INIT_CAPITAL', 'IDR', $1, 'bot_config', 'INIT_CAPITAL') ON CONFLICT (idempotency_key) DO NOTHING`,
    [cfg.portfolio.initialCapital],
  );
}

async function acquireLease(db: Db, holder: string): Promise<boolean> {
  const r = await db.query(
    `UPDATE bot_lock SET holder = $1, expires_at = now() + ($2 || ' seconds')::interval WHERE id = 1 AND expires_at < now() RETURNING id`,
    [holder, String(LEASE_SECONDS)],
  );
  return r.rows.length === 1;
}

async function releaseLease(db: Db, holder: string): Promise<void> {
  await db.query(`UPDATE bot_lock SET expires_at = now() - interval '1 second' WHERE id = 1 AND holder = $1`, [holder]);
}

async function logSystem(q: Queryable, tickId: number | null, severity: string, component: string, code: string, payload: unknown) {
  await q.query(`INSERT INTO system_events (tick_id, occurred_at, severity, component, event_code, sanitized_payload) VALUES ($1, now(), $2, $3, $4, $5)`, [tickId, severity, component, code, JSON.stringify(payload ?? null)]);
}

async function logRaw(q: Queryable, tickId: number, endpoint: string, r: FetchResult<unknown> | null, err: MarketDataError | null, url: string) {
  await q.query(
    `INSERT INTO raw_responses (tick_id, endpoint, url, status, attempts, received_at, latency_ms, bytes, raw_hash, raw_text, error_code) VALUES ($1,$2,$3,$4,$5,now(),$6,$7,$8,$9,$10)`,
    [tickId, endpoint, url, r?.status ?? err?.status ?? null, r?.attempts ?? err?.attempts ?? null, r?.latencyMs ?? null, r ? r.raw.length : null, r ? sha256(r.raw) : null, err ? sanitize(err.message) : null, err?.code ?? null],
  );
}

async function cashOf(q: Queryable): Promise<number> {
  const r = await q.query<{ s: number | null }>(`SELECT COALESCE(SUM(amount),0)::float8 AS s FROM ledger_events WHERE currency = 'IDR'`);
  return Number(r.rows[0]?.s ?? 0);
}

async function realizedOf(q: Queryable): Promise<number> {
  const r = await q.query<{ s: number | null }>(`SELECT COALESCE(SUM(realized_pnl),0)::float8 AS s FROM positions WHERE realized_pnl IS NOT NULL`);
  return Number(r.rows[0]?.s ?? 0);
}

async function openPositions(q: Queryable): Promise<OpenPos[]> {
  const r = await q.query<Record<string, unknown>>(`SELECT * FROM positions WHERE status = 'OPEN' ORDER BY pair`);
  return r.rows.map((x) => ({
    id: Number(x.id),
    pair: String(x.pair),
    qty: Number(x.qty),
    costBasis: Number(x.cost_basis),
    entryFee: Number(x.entry_fee),
    entrySpread: Number(x.entry_spread_cost),
    entrySlip: Number(x.entry_slippage_cost),
    highestClose: Number(x.highest_close),
    lastCandleOpenTime: Number(x.last_candle_open_time),
    openedAt: new Date(String(x.opened_at)).toISOString(),
  }));
}

async function lastValidBid(q: Queryable, pair: string): Promise<number | null> {
  const r = await q.query<{ best_bid: number }>(`SELECT best_bid FROM orderbook_snapshots WHERE pair = $1 AND valid ORDER BY captured_at DESC LIMIT 1`, [pair]);
  return r.rows[0] ? Number(r.rows[0].best_bid) : null;
}

export async function runTick(deps: TickDeps, req: TickRequest): Promise<TickSummary> {
  const cfg = deps.config ?? FROZEN_CONFIG;
  const now = deps.now ?? Date.now;
  const db = deps.db;
  const client = deps.client ?? new IndodaxPublicClient({ baseUrl: process.env.INDODAX_BASE_URL });
  const holder = deps.holder ?? `tick-${now()}-${Math.random().toString(36).slice(2, 8)}`;
  const started = now();
  const hash = configHash(cfg);
  const tf = cfg.timeframeSeconds;
  const summary: TickSummary = { tickId: null, status: "OK", serverTime: null, durationMs: 0, processed: 0, alreadyProcessed: 0, signals: [], orders: [], equity: null, cash: null, errors: [] };

  await bootstrap(db, cfg);
  if (!(await acquireLease(db, holder))) {
    const r = await db.query<{ id: number }>(
      `INSERT INTO tick_runs (scheduled_at, started_at, finished_at, status, duration_ms, scheduler_source, error_code) VALUES ($1, $2, $2, 'SKIPPED_LOCKED', 0, $3, 'LEASE_HELD') RETURNING id`,
      [req.scheduledAt ?? null, iso(started), req.source],
    );
    summary.tickId = Number(r.rows[0]!.id);
    summary.status = "SKIPPED_LOCKED";
    return summary;
  }

  const run = await db.query<{ id: number }>(
    `INSERT INTO tick_runs (scheduled_at, started_at, status, scheduler_source) VALUES ($1, $2, 'RUNNING', $3) RETURNING id`,
    [req.scheduledAt ?? null, iso(started), req.source],
  );
  const tickId = Number(run.rows[0]!.id);
  summary.tickId = tickId;

  try {
    let serverMs: number;
    try {
      const st = await client.serverTime();
      await logRaw(db, tickId, "server_time", st, null, st.url);
      serverMs = st.data;
    } catch (e) {
      const err = e instanceof MarketDataError ? e : new MarketDataError("UNKNOWN", String(e), 0, null);
      await logRaw(db, tickId, "server_time", null, err, "/api/server_time");
      throw err;
    }
    summary.serverTime = iso(serverMs);
    const serverSec = Math.floor(serverMs / 1000);
    const targetOpen = latestClosedOpenTime(serverSec, tf);

    const pairsNeeded = Array.from(new Set<string>([...cfg.universe, cfg.regimePair]));
    const metas = new Map<string, PairMeta>();
    try {
      const pm = await client.pairs();
      await logRaw(db, tickId, "pairs+price_increments", pm, null, pm.url);
      for (const m of pm.data) if (pairsNeeded.includes(m.pair)) metas.set(m.pair, m);
      for (const m of metas.values()) {
        await db.query(`INSERT INTO pair_metadata (captured_at, pair, meta_json, meta_hash) VALUES (now(), $1, $2, $3) ON CONFLICT (pair, meta_hash) DO NOTHING`, [m.pair, JSON.stringify(m), sha256(stableStringify(m))]);
      }
    } catch (e) {
      const err = e instanceof MarketDataError ? e : new MarketDataError("UNKNOWN", String(e), 0, null);
      await logRaw(db, tickId, "pairs+price_increments", null, err, "/api/pairs");
      summary.errors.push(`pairs:${err.code}`);
    }

    const candlesByPair = new Map<string, Candle[]>();
    const need = warmupBars(cfg) + 20;
    for (const pair of pairsNeeded) {
      const symbol = metas.get(pair)?.symbol ?? pair.toUpperCase();
      try {
        const r = await client.candles(symbol, cfg.timeframe, targetOpen - need * tf, serverSec);
        await logRaw(db, tickId, `candles:${pair}`, r, null, r.url);
        const { valid, invalid } = validateCandles(r.data);
        if (invalid.length > 0) await logSystem(db, tickId, "WARN", "MarketDataGuard", "INVALID_CANDLES", { pair, invalid: invalid.slice(0, 20) });
        const closed = closedCandles(valid, serverSec, tf);
        candlesByPair.set(pair, closed);
        const rawHash = sha256(r.raw);
        for (const c of closed.slice(-need)) {
          await db.query(
            `INSERT INTO market_candles (pair, timeframe, open_time, open, high, low, close, volume, source, raw_hash, first_seen_tick) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'indodax:tradingview/history_v2',$9,$10) ON CONFLICT DO NOTHING`,
            [pair, cfg.timeframe, c.openTime, c.open, c.high, c.low, c.close, c.volume, rawHash, tickId],
          );
        }
      } catch (e) {
        const err = e instanceof MarketDataError ? e : new MarketDataError("UNKNOWN", String(e), 0, null);
        await logRaw(db, tickId, `candles:${pair}`, null, err, `/tradingview/history_v2?symbol=${symbol}`);
        summary.errors.push(`candles:${pair}:${err.code}`);
      }
    }

    const books = new Map<string, OrderBook>();
    const bookOk = new Map<string, ReturnType<typeof validateBook>>();
    for (const pair of cfg.universe) {
      try {
        const r = await client.depth(pair);
        await logRaw(db, tickId, `depth:${pair}`, r, null, r.url);
        const check = validateBook(r.data, cfg.risk.spreadMax);
        books.set(pair, r.data);
        bookOk.set(pair, check);
        const lim = cfg.execution.bookLevelsStored;
        await db.query(
          `INSERT INTO orderbook_snapshots (tick_id, pair, captured_at, bids_json, asks_json, best_bid, best_ask, spread_bps, levels_bid, levels_ask, raw_hash, valid, invalid_reason) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
          [tickId, pair, iso(r.receivedAt), JSON.stringify(r.data.bids.slice(0, lim)), JSON.stringify(r.data.asks.slice(0, lim)), check.bestBid || null, check.bestAsk || null, check.spread !== null ? check.spread * 10000 : null, r.data.bids.length, r.data.asks.length, sha256(r.raw), check.ok || check.reason === "SPREAD_TOO_WIDE", check.reason],
        );
        if (!check.ok) await logSystem(db, tickId, "WARN", "MarketDataGuard", "BOOK_REJECTED", { pair, reason: check.reason, spread: check.spread });
      } catch (e) {
        const err = e instanceof MarketDataError ? e : new MarketDataError("UNKNOWN", String(e), 0, null);
        await logRaw(db, tickId, `depth:${pair}`, null, err, `/api/depth/${pair}`);
        summary.errors.push(`depth:${pair}:${err.code}`);
      }
    }

    const state = await db.query<{ kill_switch: boolean }>(`SELECT kill_switch FROM bot_state WHERE id = 1`);
    const killSwitch = Boolean(state.rows[0]?.kill_switch);

    const result = await db.tx(async (q) => {
      const positions = await openPositions(q);
      const posByPair = new Map(positions.map((p) => [p.pair, p]));
      let cash = await cashOf(q);
      let staleMarks = 0;
      const markBid = async (pair: string) => {
        const c = bookOk.get(pair);
        if (c && c.bestBid > 0 && (c.ok || c.reason === "SPREAD_TOO_WIDE")) return c.bestBid;
        staleMarks++;
        return (await lastValidBid(q, pair)) ?? 0;
      };
      let inventory = 0;
      for (const p of positions) inventory += p.qty * (await markBid(p.pair));
      const equityPre = cash + inventory;
      const dayKey = wibDate(serverMs);
      const dayStart = await q.query<{ equity: number }>(`SELECT equity FROM equity_snapshots WHERE local_trading_date = $1 AND is_day_start ORDER BY id LIMIT 1`, [dayKey]);
      const isDayStart = dayStart.rows.length === 0;
      const dayStartEquity = isDayStart ? equityPre : Number(dayStart.rows[0]!.equity);
      const realizedBefore = await realizedOf(q);
      const unrealizedPre = inventory - positions.reduce((s, p) => s + p.costBasis, 0);
      await q.query(
        `INSERT INTO equity_snapshots (tick_id, captured_at, local_trading_date, phase, cash, inventory_value_at_bid, equity, realized_pnl, unrealized_pnl, is_day_start, stale_marks) VALUES ($1,$2,$3,'PRE_TRADE',$4,$5,$6,$7,$8,$9,$10)`,
        [tickId, iso(serverMs), dayKey, cash, inventory, equityPre, realizedBefore, unrealizedPre, isDayStart, staleMarks],
      );

      const loss = dailyLoss(dayStartEquity, equityPre, cfg.risk.dailyLossLimit);
      if (loss.locked) {
        await q.query(`INSERT INTO risk_events (tick_id, occurred_at, rule, state, threshold, observed_value, action, reason) VALUES ($1, now(), 'DAILY_LOSS', 'LOCKED', $2, $3, 'BLOCK_NEW_ENTRIES', $4)`, [tickId, -cfg.risk.dailyLossLimit, loss.change, `basis ekuitas awal hari WIB ${dayKey}`]);
      }
      if (killSwitch) {
        await q.query(`INSERT INTO risk_events (tick_id, occurred_at, rule, state, action, reason) VALUES ($1, now(), 'KILL_SWITCH', 'ACTIVE', 'BLOCK_NEW_ENTRIES', 'flag bot_state.kill_switch')`, [tickId]);
      }

      const fresh: Signal[] = [];
      const signalIds = new Map<string, number>();
      const pairBlock = new Map<string, string>();
      for (const pair of cfg.universe) {
        const candles = candlesByPair.get(pair);
        const regime = candlesByPair.get(cfg.regimePair) ?? [];
        if (!candles || candles.length === 0) { pairBlock.set(pair, "NO_CANDLES"); continue; }
        const last = candles[candles.length - 1]!;
        const st = staleness(last, serverSec, tf, cfg.risk.staleBars);
        if (st.stale) pairBlock.set(pair, "STALE_DATA");
        const meta = metas.get(pair);
        if (!meta) pairBlock.set(pair, "NO_PAIR_METADATA");
        else if (meta.maintenance || meta.suspended) pairBlock.set(pair, "PAIR_SUSPENDED");
        const exists = await q.query(`SELECT id FROM signals WHERE pair = $1 AND timeframe = $2 AND candle_open_time = $3 AND strategy_version = $4`, [pair, cfg.timeframe, last.openTime, cfg.strategyVersion]);
        if (exists.rows.length > 0) { summary.alreadyProcessed++; continue; }
        const prev = await q.query<{ m: number | null }>(`SELECT MAX(candle_open_time) AS m FROM signals WHERE pair = $1 AND strategy_version = $2`, [pair, cfg.strategyVersion]);
        const prevOpen = prev.rows[0]?.m != null ? Number(prev.rows[0].m) : null;
        if (prevOpen !== null && last.openTime - prevOpen > tf) {
          await logSystem(q, tickId, "WARN", "TickService", "MISSED_CANDLES", { pair, from: prevOpen + tf, to: last.openTime - tf, count: (last.openTime - prevOpen) / tf - 1 });
        }
        const p = posByPair.get(pair);
        const position: PositionState = p ? { open: true, qty: p.qty, avgEntryCost: p.costBasis / p.qty, entryTime: Date.parse(p.openedAt), highestClose: p.highestClose, lastCandleOpenTime: p.lastCandleOpenTime } : { open: false };
        const sig = evaluateSignal({ pair, candles: candles.slice(-(warmupBars(cfg) + 20)), regimeCandles: regime.slice(-(warmupBars(cfg) + 20)), position, config: cfg, configHash: hash });
        const ins = await q.query<{ id: number }>(
          `INSERT INTO signals (tick_id, pair, timeframe, candle_open_time, side, reason_code, feature_json, strategy_version, config_hash) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
          [tickId, pair, cfg.timeframe, sig.candleOpenTime, sig.side, sig.reasonCode, JSON.stringify(sig.features), sig.strategyVersion, sig.configHash],
        );
        if (ins.rows.length === 0) { summary.alreadyProcessed++; continue; }
        signalIds.set(pair, Number(ins.rows[0]!.id));
        fresh.push(sig);
        summary.processed++;
        summary.signals.push({ pair, candle: iso(sig.candleOpenTime * 1000), side: sig.side, reason: sig.reasonCode });
        if (p) {
          const marked = nextPositionMark(position, sig);
          if (marked.open) await q.query(`UPDATE positions SET highest_close = $1, last_candle_open_time = $2 WHERE id = $3`, [marked.highestClose, marked.lastCandleOpenTime, p.id]);
          p.highestClose = marked.open ? marked.highestClose : p.highestClose;
        }
      }

      const recordOrder = async (sig: Signal, fill: FillResult, feeRate: number, key: string) => {
        const o = await q.query<{ id: number }>(
          `INSERT INTO sim_orders (tick_id, signal_id, pair, side, status, reject_reason, requested_qty, requested_notional, filled_qty, avg_fill, notional, fee, fee_rate, bid_at_decision, ask_at_decision, mid_at_decision, signal_price, spread_cost, slippage_cost, idempotency_key)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
          [tickId, signalIds.get(sig.pair) ?? null, sig.pair, fill.side, fill.status, fill.rejectReason, fill.requestedQty, fill.requestedNotional, fill.filledQty, fill.avgPrice || null, fill.notional, fill.fee, feeRate, fill.bestBid || null, fill.bestAsk || null, fill.mid || null, typeof sig.features.close === "number" ? sig.features.close : null, fill.spreadCost, fill.slippageCost, key],
        );
        if (o.rows.length === 0) return null;
        const orderId = Number(o.rows[0]!.id);
        for (const lv of fill.levels) {
          await q.query(`INSERT INTO sim_fills (order_id, level_index, book_side, level_price, level_qty, filled_qty, fee_component) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [orderId, lv.levelIndex, fill.side === "BUY" ? "ask" : "bid", lv.price, lv.levelQty, lv.filledQty, lv.filledQty * lv.price * feeRate]);
        }
        summary.orders.push({ pair: sig.pair, side: fill.side, status: fill.status, reason: fill.rejectReason, qty: fill.filledQty, avg: fill.avgPrice });
        return orderId;
      };

      const rejectOrder = async (sig: Signal, reason: string, notional: number) => {
        const c = bookOk.get(sig.pair);
        const fill: FillResult = { side: sig.side === "SELL" ? "SELL" : "BUY", status: "REJECTED", rejectReason: reason, requestedQty: 0, requestedNotional: notional, filledQty: 0, avgPrice: 0, notional: 0, fee: 0, levels: [], bestBid: c?.bestBid ?? 0, bestAsk: c?.bestAsk ?? 0, mid: c?.mid ?? 0, spreadCost: 0, slippageCost: 0 };
        await recordOrder(sig, fill, metas.get(sig.pair)?.takerFee ?? cfg.execution.feeTaker, `${sig.pair}:${sig.candleOpenTime}:${sig.strategyVersion}:${sig.side}`);
        await q.query(`INSERT INTO risk_events (tick_id, occurred_at, rule, state, action, pair, reason, observed_value) VALUES ($1, now(), 'ENTRY_GATE', 'REJECTED', 'REJECT_ORDER', $2, $3, $4)`, [tickId, sig.pair, reason, notional]);
      };

      const feeOf = (pair: string) => Math.max(metas.get(pair)?.takerFee ?? 0, cfg.execution.feeTaker);

      for (const sig of fresh.filter((s) => s.side === "SELL")) {
        const p = posByPair.get(sig.pair);
        const book = books.get(sig.pair);
        const meta = metas.get(sig.pair);
        const check = bookOk.get(sig.pair);
        if (!p) continue;
        if (!book || !meta || !check || (!check.ok && check.reason !== "SPREAD_TOO_WIDE")) { await rejectOrder(sig, `EXIT_BLOCKED_${check?.reason ?? "NO_BOOK"}`, 0); continue; }
        const fee = feeOf(sig.pair);
        const fill = simulateSell({ bids: book.bids, asks: book.asks, qty: p.qty, feeRate: fee, quantityIncrement: meta.quantityIncrement, minNotional: meta.minBaseIdr });
        const key = `${sig.pair}:${sig.candleOpenTime}:${sig.strategyVersion}:SELL`;
        const orderId = await recordOrder(sig, fill, fee, key);
        if (orderId === null || fill.status === "REJECTED") continue;
        const fraction = fill.filledQty / p.qty;
        const costPart = p.costBasis * fraction;
        const pnl = fill.notional - fill.fee - costPart;
        await q.query(`INSERT INTO ledger_events (tick_id, event_time, event_type, currency, amount, reference_type, reference_id, idempotency_key) VALUES ($1, now(), 'SELL_NOTIONAL', 'IDR', $2, 'sim_orders', $3, $4)`, [tickId, fill.notional, orderId, `${key}:notional`]);
        await q.query(`INSERT INTO ledger_events (tick_id, event_time, event_type, currency, amount, reference_type, reference_id, idempotency_key) VALUES ($1, now(), 'SELL_FEE', 'IDR', $2, 'sim_orders', $3, $4)`, [tickId, -fill.fee, orderId, `${key}:fee`]);
        await q.query(`INSERT INTO ledger_events (tick_id, event_time, event_type, currency, amount, reference_type, reference_id, idempotency_key) VALUES ($1, now(), 'SELL_QTY', $2, $3, 'sim_orders', $4, $5)`, [tickId, sig.pair, -fill.filledQty, orderId, `${key}:qty`]);
        cash += fill.notional - fill.fee;
        if (fill.filledQty >= p.qty - 1e-12) {
          await q.query(`UPDATE positions SET status = 'CLOSED', qty = 0, closed_at = now(), exit_order_id = $1, exit_reason = $2, realized_pnl = COALESCE(realized_pnl,0) + $3 WHERE id = $4`, [orderId, sig.reasonCode, pnl, p.id]);
          posByPair.delete(sig.pair);
        } else {
          await q.query(`UPDATE positions SET qty = qty - $1, cost_basis = cost_basis - $2, realized_pnl = COALESCE(realized_pnl,0) + $3 WHERE id = $4`, [fill.filledQty, costPart, pnl, p.id]);
          p.qty -= fill.filledQty;
          p.costBasis -= costPart;
        }
      }

      const globalBlock = entryBlockReason({ killSwitch, dailyLocked: loss.locked, dataStale: false });
      const buyable: Signal[] = [];
      for (const sig of fresh.filter((s) => s.side === "BUY")) {
        const block = pairBlock.get(sig.pair) ?? (bookOk.get(sig.pair)?.ok ? null : `BOOK_${bookOk.get(sig.pair)?.reason ?? "MISSING"}`);
        if (block && !globalBlock) { await rejectOrder(sig, block, 0); continue; }
        buyable.push(sig);
      }
      const plan = planOrders({
        signals: buyable,
        openPairs: new Set(posByPair.keys()),
        equity: equityPre,
        cash,
        entriesBlocked: globalBlock,
        minNotional: (pair) => metas.get(pair)?.minBaseIdr ?? Infinity,
        config: cfg,
      });
      for (const r of plan.rejected) await rejectOrder(r.signal, r.reason, sizeEntry(r.signal, equityPre, cash, cfg).notional);
      for (const e of plan.entries) {
        const book = books.get(e.signal.pair)!;
        const meta = metas.get(e.signal.pair)!;
        const fee = feeOf(e.signal.pair);
        const budget = Math.min(e.notional, cash);
        const fill = simulateBuy({ asks: book.asks, bids: book.bids, budgetIdr: budget, feeRate: fee, quantityIncrement: meta.quantityIncrement, minNotional: meta.minBaseIdr });
        const key = `${e.signal.pair}:${e.signal.candleOpenTime}:${e.signal.strategyVersion}:BUY`;
        const orderId = await recordOrder(e.signal, fill, fee, key);
        if (orderId === null || fill.status === "REJECTED") continue;
        const cost = fill.notional + fill.fee;
        if (cost > cash + 1e-6) throw new Error("INVARIANT_CASH_NEGATIVE");
        await q.query(`INSERT INTO ledger_events (tick_id, event_time, event_type, currency, amount, reference_type, reference_id, idempotency_key) VALUES ($1, now(), 'BUY_NOTIONAL', 'IDR', $2, 'sim_orders', $3, $4)`, [tickId, -fill.notional, orderId, `${key}:notional`]);
        await q.query(`INSERT INTO ledger_events (tick_id, event_time, event_type, currency, amount, reference_type, reference_id, idempotency_key) VALUES ($1, now(), 'BUY_FEE', 'IDR', $2, 'sim_orders', $3, $4)`, [tickId, -fill.fee, orderId, `${key}:fee`]);
        await q.query(`INSERT INTO ledger_events (tick_id, event_time, event_type, currency, amount, reference_type, reference_id, idempotency_key) VALUES ($1, now(), 'BUY_QTY', $2, $3, 'sim_orders', $4, $5)`, [tickId, e.signal.pair, fill.filledQty, orderId, `${key}:qty`]);
        await q.query(
          `INSERT INTO positions (pair, qty, avg_entry_cost, cost_basis, entry_spread_cost, entry_slippage_cost, entry_fee, opened_at, entry_order_id, entry_candle_open_time, highest_close, last_candle_open_time, strategy_version, status) VALUES ($1,$2,$3,$4,$5,$6,$7,now(),$8,$9,0,$9,$10,'OPEN')`,
          [e.signal.pair, fill.filledQty, cost / fill.filledQty, cost, fill.spreadCost, fill.slippageCost, fill.fee, orderId, e.signal.candleOpenTime, cfg.strategyVersion],
        );
        cash -= cost;
        posByPair.set(e.signal.pair, { id: 0, pair: e.signal.pair, qty: fill.filledQty, costBasis: cost, entryFee: fill.fee, entrySpread: fill.spreadCost, entrySlip: fill.slippageCost, highestClose: 0, lastCandleOpenTime: e.signal.candleOpenTime, openedAt: iso(serverMs) });
      }

      const cashPost = await cashOf(q);
      if (cashPost < -1e-6) throw new Error("INVARIANT_CASH_NEGATIVE");
      const after = await openPositions(q);
      let invPost = 0;
      for (const p of after) {
        if (p.qty < 0) throw new Error("INVARIANT_QTY_NEGATIVE");
        invPost += p.qty * (await markBid(p.pair));
      }
      const realizedPost = await realizedOf(q);
      const unrealizedPost = invPost - after.reduce((s, p) => s + p.costBasis, 0);
      await q.query(
        `INSERT INTO equity_snapshots (tick_id, captured_at, local_trading_date, phase, cash, inventory_value_at_bid, equity, realized_pnl, unrealized_pnl, is_day_start, stale_marks) VALUES ($1,$2,$3,'POST_TRADE',$4,$5,$6,$7,$8,false,$9)`,
        [tickId, iso(serverMs), dayKey, cashPost, invPost, cashPost + invPost, realizedPost, unrealizedPost, staleMarks],
      );
      return { equity: cashPost + invPost, cash: cashPost };
    });

    summary.equity = result.equity;
    summary.cash = result.cash;
    summary.status = summary.errors.length > 0 ? "PARTIAL" : "OK";
  } catch (e) {
    const code = e instanceof MarketDataError ? e.code : e instanceof Error ? e.message.split(":")[0]!.slice(0, 60) : "UNKNOWN";
    summary.status = "FAILED";
    summary.errors.push(code);
    await logSystem(db, tickId, "ERROR", "TickService", "TICK_FAILED", { code, message: sanitize(String((e as Error)?.message ?? e)) }).catch(() => undefined);
  } finally {
    summary.durationMs = now() - started;
    await db.query(
      `UPDATE tick_runs SET finished_at = $1, status = $2, duration_ms = $3, error_code = $4, processed_count = $5, server_time = $6, request_count = $7, retry_count = $8, summary_json = $9 WHERE id = $10`,
      [iso(now()), summary.status, summary.durationMs, summary.errors[0] ?? null, summary.processed, summary.serverTime, client.requestCount, client.retryCount, JSON.stringify(summary), tickId],
    ).catch(() => undefined);
    await releaseLease(db, holder).catch(() => undefined);
  }
  return summary;
}
