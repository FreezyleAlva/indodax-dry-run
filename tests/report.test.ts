// tests/report.test.ts
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReport } from "@/analytics/report";
import { Dashboard, type BacktestSummary } from "@/dashboard/Dashboard";
import { IndodaxPublicClient } from "@/market-data/indodax";
import { ensureSchema, openPglite } from "@/persistence/db";
import { loadRawExport } from "@/persistence/export";
import { runTick } from "@/services/tick";
import { FROZEN_CONFIG, warmupBars } from "@/strategy/config";
import { stableStringify } from "@/strategy/hash";
import backtest from "../research/output/backtest-summary.json";

const TF = FROZEN_CONFIG.timeframeSeconds;

describe("laporan dari log mentah", () => {
  it("trade masuk-keluar, laporan deterministik, dashboard ter-render, paritas dihitung", async () => {
    const db = await openPglite();
    await ensureSchema(db);
    const n = warmupBars() + 40;
    const first = 1_790_000_000 - (1_790_000_000 % TF);
    const closes: Record<string, number[]> = {};
    for (const p of FROZEN_CONFIG.universe) closes[p] = Array.from({ length: n }, (_, i) => (i === n - 1 ? 1500 : 1000 + i));
    let serverSec = first + n * TF + 60;
    const fetchImpl = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
      if (url.pathname === "/api/server_time") return json({ server_time: serverSec * 1000 });
      if (url.pathname === "/api/pairs") return json(FROZEN_CONFIG.universe.map((p) => ({ id: p, symbol: p.toUpperCase(), ticker_id: p.replace("idr", "_idr"), trade_min_base_currency: 10000, trade_min_traded_currency: 0.0001, trade_fee_percent_taker: 0.2, quantity_increment: 1e-8 })));
      if (url.pathname === "/api/price_increments") return json({ increments: {} });
      if (url.pathname.startsWith("/api/depth/")) return json({ buy: [["1990", "50000"], ["1980", "50000"]], sell: [["2000", "50000"], ["2010", "50000"]] });
      const pair = url.searchParams.get("symbol")!.toLowerCase();
      return json(closes[pair]!.map((c, i) => ({ Time: first + i * TF, Open: c, High: c, Low: c, Close: c, Volume: "1000000" })));
    }) as typeof fetch;
    const client = () => new IndodaxPublicClient({ fetchImpl, sleep: async () => undefined });
    await runTick({ db, client: client(), now: () => serverSec * 1000 }, { source: "test" });
    for (const p of FROZEN_CONFIG.universe) closes[p]!.push(1600, 400);
    serverSec += 2 * TF;
    await runTick({ db, client: client(), now: () => serverSec * 1000 }, { source: "test" });

    const raw = await loadRawExport(db);
    const a = buildReport(raw);
    const b = buildReport(JSON.parse(JSON.stringify(raw)));
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(a.forwardTrades.length).toBe(5);
    expect(a.forwardTrades.every((t) => t.exitReason === "TRAIL_STOP")).toBe(true);
    expect(a.forward.trades).toBe(5);
    expect(a.costs.filledOrders).toBe(10);
    expect(a.costs.fees).toBeGreaterThan(0);
    expect(a.parity.compared).toBe(10);
    expect(a.parity.byReason).toEqual({ MATCH: 10 });
    expect(a.portfolio!.openPositions.length).toBe(0);
    const html = renderToStaticMarkup(createElement(Dashboard, { report: a, backtest: backtest as unknown as BacktestSummary, meta: { mode: "offline", commitSha: null, generatedAt: raw.exportedAt, freezeNote: "x" } }));
    expect(html).toContain("TRAIL_STOP");
    expect(html).toContain("Paritas sinyal");
    expect(html).not.toMatch(/NaN|undefined/);
    await db.close();
  });
});
