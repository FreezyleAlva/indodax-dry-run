// tests/tick.test.ts
import { describe, expect, it } from "vitest";
import { bearerOk } from "@/lib/auth";
import { IndodaxPublicClient } from "@/market-data/indodax";
import { ensureSchema, openPglite, type Db } from "@/persistence/db";
import { FROZEN_CONFIG, warmupBars } from "@/strategy/config";
import { runTick } from "@/services/tick";

const TF = FROZEN_CONFIG.timeframeSeconds;

type World = {
  serverSec: number;
  closes: Record<string, number[]>;
  firstOpen: number;
  depthStatus: number;
  serverTimeBody: string | null;
  asks: [number, number][];
  bids: [number, number][];
};

function world(): World {
  const n = warmupBars() + 40;
  const firstOpen = 1_790_000_000 - (1_790_000_000 % TF);
  const closes: Record<string, number[]> = {};
  for (const p of FROZEN_CONFIG.universe) closes[p] = Array.from({ length: n }, (_, i) => 1000 + i);
  return { serverSec: firstOpen + n * TF + 60, closes, firstOpen, depthStatus: 200, serverTimeBody: null, asks: [[2000, 100], [2010, 100]], bids: [[1990, 100], [1980, 100]] };
}

function fakeFetch(w: World): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    const json = (body: unknown, status = 200) => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
    if (url.pathname === "/api/server_time") return json(w.serverTimeBody ?? { timezone: "UTC", server_time: w.serverSec * 1000 });
    if (url.pathname === "/api/pairs") return json(FROZEN_CONFIG.universe.map((p) => ({ id: p, symbol: p.toUpperCase(), ticker_id: p.replace("idr", "_idr"), trade_min_base_currency: 10000, trade_min_traded_currency: 0.0001, trade_fee_percent_taker: 0.2, quantity_increment: 1e-8, is_maintenance: 0, is_market_suspended: 0 })));
    if (url.pathname === "/api/price_increments") return json({ increments: {} });
    if (url.pathname.startsWith("/api/depth/")) {
      if (w.depthStatus !== 200) return json({ error: "x" }, w.depthStatus);
      return json({ buy: w.bids.map(([p, q]) => [String(p), String(q)]), sell: w.asks.map(([p, q]) => [String(p), String(q)]) });
    }
    if (url.pathname === "/tradingview/history_v2") {
      const pair = url.searchParams.get("symbol")!.toLowerCase();
      const cl = w.closes[pair] ?? [];
      const rows = cl.map((c, i) => ({ Time: w.firstOpen + i * TF, Open: c, High: c, Low: c, Close: c, Volume: "100000" }));
      rows.push({ Time: w.firstOpen + cl.length * TF, Open: 1, High: 1, Low: 1, Close: 1, Volume: "1" });
      return json(rows);
    }
    return json({ error: "not found" }, 404);
  }) as typeof fetch;
}

async function freshDb(): Promise<Db> {
  const db = await openPglite();
  await ensureSchema(db);
  return db;
}

function client(w: World) {
  return new IndodaxPublicClient({ fetchImpl: fakeFetch(w), sleep: async () => undefined, maxAttempts: 3 });
}

function tickOf(db: Db, w: World, source = "test") {
  return runTick({ db, client: client(w), now: () => w.serverSec * 1000 }, { source });
}

async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query(sql, params)).rows[0] as T;
}

describe("auth endpoint", () => {
  it("menolak tanpa header, header salah, secret pendek", () => {
    const secret = "s".repeat(32);
    expect(bearerOk(null, secret)).toBe(false);
    expect(bearerOk("Bearer salah", secret)).toBe(false);
    expect(bearerOk(`Bearer ${secret}`, secret)).toBe(true);
    expect(bearerOk("Bearer pendek", "pendek")).toBe(false);
    expect(bearerOk(`Bearer ${secret}`, undefined)).toBe(false);
  });
});

describe("TickService end-to-end (PGlite)", () => {
  it("breakout -> BUY terisi dari ask, duplikat tidak terisi lagi, ledger rekonsiliasi", async () => {
    const db = await freshDb();
    const w = world();
    for (const p of FROZEN_CONFIG.universe) w.closes[p]![w.closes[p]!.length - 1] = 1500;
    const s1 = await tickOf(db, w);
    expect(s1.status).toBe("OK");
    expect(s1.signals.filter((s) => s.side === "BUY").length).toBe(5);
    const filled = s1.orders.filter((o) => o.status === "FILLED" || o.status === "PARTIAL");
    expect(filled.length).toBeGreaterThan(0);
    expect(filled.every((o) => o.avg >= 2000)).toBe(true);
    const s2 = await tickOf(db, w);
    expect(s2.processed).toBe(0);
    expect(s2.alreadyProcessed).toBe(5);
    expect(s2.orders.length).toBe(0);
    const cash = await one<{ s: number }>(db, "SELECT SUM(amount)::float8 AS s FROM ledger_events WHERE currency='IDR'");
    expect(cash.s).toBeGreaterThanOrEqual(0);
    const pos = await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM positions WHERE status='OPEN'");
    expect(pos.n).toBe(filled.length);
    const qtyLedger = await one<{ s: number }>(db, "SELECT COALESCE(SUM(amount),0)::float8 AS s FROM ledger_events WHERE currency <> 'IDR'");
    const qtyPos = await one<{ s: number }>(db, "SELECT COALESCE(SUM(qty),0)::float8 AS s FROM positions WHERE status='OPEN'");
    expect(qtyLedger.s).toBeCloseTo(qtyPos.s, 8);
    const fills = await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM sim_fills");
    expect(fills.n).toBeGreaterThan(0);
    await db.close();
  });

  it("trailing stop -> SELL di bid, posisi tutup, PnL tercatat", async () => {
    const db = await freshDb();
    const w = world();
    for (const p of FROZEN_CONFIG.universe) w.closes[p]![w.closes[p]!.length - 1] = 1500;
    await tickOf(db, w);
    for (const p of FROZEN_CONFIG.universe) {
      w.closes[p]!.push(1600, 400);
    }
    w.serverSec += 2 * TF;
    const s = await tickOf(db, w);
    const sells = s.orders.filter((o) => o.side === "SELL" && o.status !== "REJECTED");
    expect(sells.length).toBeGreaterThan(0);
    expect(sells.every((o) => o.avg <= 1990)).toBe(true);
    const open = await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM positions WHERE status='OPEN'");
    expect(open.n).toBe(0);
    const pnl = await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM positions WHERE realized_pnl IS NOT NULL");
    expect(pnl.n).toBe(sells.length);
    await db.close();
  });

  it("kill switch memblok entry dan tercatat di risk_events", async () => {
    const db = await freshDb();
    const w = world();
    for (const p of FROZEN_CONFIG.universe) w.closes[p]![w.closes[p]!.length - 1] = 1500;
    await runTick({ db, client: client(w), now: () => w.serverSec * 1000 }, { source: "boot" }).catch(() => undefined);
    await db.query("UPDATE bot_state SET kill_switch = true");
    w.serverSec += TF;
    for (const p of FROZEN_CONFIG.universe) w.closes[p]!.push(1700);
    await db.query("DELETE FROM positions");
    await db.query("DELETE FROM ledger_events WHERE event_type <> 'INIT_CAPITAL'");
    const s = await tickOf(db, w);
    expect(s.orders.filter((o) => o.side === "BUY").every((o) => o.status === "REJECTED" && o.reason === "KILL_SWITCH")).toBe(true);
    const ev = await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM risk_events WHERE rule='KILL_SWITCH'");
    expect(ev.n).toBeGreaterThan(0);
    await db.close();
  });

  it("depth 5xx: retry terbatas, entry gagal tertutup, tick PARTIAL", async () => {
    const db = await freshDb();
    const w = world();
    w.depthStatus = 503;
    for (const p of FROZEN_CONFIG.universe) w.closes[p]![w.closes[p]!.length - 1] = 1500;
    const s = await tickOf(db, w);
    expect(s.status).toBe("PARTIAL");
    expect(s.orders.filter((o) => o.status === "FILLED").length).toBe(0);
    const raw = await one<{ n: number; a: number }>(db, "SELECT COUNT(*)::int AS n, MAX(attempts)::int AS a FROM raw_responses WHERE error_code='HTTP_5XX'");
    expect(raw.n).toBe(5);
    expect(raw.a).toBe(3);
    await db.close();
  });

  it("server_time rusak: tick FAILED, nol order, error tercatat tanpa secret", async () => {
    const db = await freshDb();
    const w = world();
    w.serverTimeBody = "<html>bukan json</html>";
    const s = await tickOf(db, w);
    expect(s.status).toBe("FAILED");
    expect(s.errors[0]).toBe("MALFORMED_JSON");
    const n = await one<{ n: number }>(db, "SELECT COUNT(*)::int AS n FROM sim_orders");
    expect(n.n).toBe(0);
    const run = await one<{ status: string }>(db, "SELECT status FROM tick_runs ORDER BY id DESC LIMIT 1");
    expect(run.status).toBe("FAILED");
    await db.close();
  });

  it("lease dipegang tick lain: SKIPPED_LOCKED tanpa efek", async () => {
    const db = await freshDb();
    const w = world();
    await tickOf(db, w);
    await db.query("UPDATE bot_lock SET holder='lain', expires_at = now() + interval '5 minutes'");
    const s = await tickOf(db, w);
    expect(s.status).toBe("SKIPPED_LOCKED");
    await db.close();
  });

  it("daily loss: ekuitas turun >= 5% dari awal hari WIB memblok entry", async () => {
    const db = await freshDb();
    const w = world();
    for (const p of FROZEN_CONFIG.universe) w.closes[p]![w.closes[p]!.length - 1] = 900;
    await tickOf(db, w);
    await db.query("INSERT INTO ledger_events (event_time, event_type, currency, amount, idempotency_key) VALUES (now(), 'TEST_LOSS', 'IDR', -6000000, 'test-loss')");
    w.serverSec += TF;
    for (const p of FROZEN_CONFIG.universe) w.closes[p]!.push(3000);
    const s = await tickOf(db, w);
    const buys = s.orders.filter((o) => o.side === "BUY");
    expect(buys.length).toBeGreaterThan(0);
    expect(buys.every((o) => o.status === "REJECTED" && o.reason === "DAILY_LOSS_LOCK")).toBe(true);
    await db.close();
  });
});
