// scripts/export-submission.ts
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildReport } from "@/analytics/report";
import { Dashboard, type BacktestSummary } from "@/dashboard/Dashboard";
import { DASHBOARD_CSS } from "@/dashboard/styles";
import { FREEZE_NOTE } from "@/lib/freeze";
import { getDb } from "@/persistence/db";
import { loadRawExport } from "@/persistence/export";
import { sha256, stableStringify } from "@/strategy/hash";

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "submission");

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const cols = Object.keys(rows[0]!);
  const cell = (v: unknown) => {
    const s = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(","), ...rows.map((r) => cols.map((c) => cell(r[c])).join(","))].join("\n");
}

function safeJson(v: unknown): string {
  return JSON.stringify(v).replace(/</g, "\\u003c");
}

async function main() {
  const db = await getDb();
  const raw = await loadRawExport(db);
  const fullBooks = (await db.query(`SELECT id, tick_id, pair, captured_at, bids_json, asks_json, best_bid, best_ask, spread_bps, levels_bid, levels_ask, raw_hash, valid, invalid_reason FROM orderbook_snapshots ORDER BY id`)).rows;
  const rawResponses = (await db.query(`SELECT * FROM raw_responses ORDER BY id`)).rows;
  const fills = (await db.query(`SELECT * FROM sim_fills ORDER BY id`)).rows;
  const botConfig = (await db.query(`SELECT * FROM bot_config ORDER BY id`)).rows;
  await db.close();

  const report = buildReport(raw);
  const backtest = JSON.parse(readFileSync(path.join(ROOT, "research", "output", "backtest-summary.json"), "utf8")) as BacktestSummary;
  const dataDir = path.join(OUT, "data");
  const logDir = path.join(OUT, "logs");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(logDir, { recursive: true });

  const files: Record<string, string> = {};
  const put = (file: string, text: string) => {
    writeFileSync(file, text);
    files[path.relative(OUT, file).split(path.sep).join("/")] = sha256(text);
  };
  put(path.join(dataDir, "raw-export.json"), JSON.stringify(raw, null, 1));
  put(path.join(dataDir, "report.json"), JSON.stringify(report, null, 1));
  put(path.join(logDir, "orderbook_snapshots_full.json"), JSON.stringify(fullBooks));
  put(path.join(logDir, "raw_responses.json"), JSON.stringify(rawResponses, null, 1));
  put(path.join(logDir, "sim_fills.json"), JSON.stringify(fills, null, 1));
  put(path.join(logDir, "bot_config.json"), JSON.stringify(botConfig, null, 1));
  const tables: Record<string, Record<string, unknown>[]> = {
    tick_runs: raw.tickRuns,
    signals: raw.signals,
    sim_orders: raw.orders,
    positions: raw.positions,
    equity_snapshots: raw.equity,
    ledger_events: raw.ledger,
    risk_events: raw.riskEvents,
    system_events: raw.systemEvents,
    market_candles: raw.candles,
  };
  for (const [name, rows] of Object.entries(tables)) put(path.join(logDir, `${name}.csv`), toCsv(rows));

  const verify = await build({ entryPoints: [path.join(ROOT, "src", "dashboard", "offline-verify.ts")], bundle: true, write: false, format: "iife", platform: "browser", target: "es2020", minify: true, alias: { "@": path.join(ROOT, "src") }, logLevel: "silent" });
  const verifyJs = verify.outputFiles[0]!.text.replace(/<\/script/gi, "<\\/script");
  const markup = renderToStaticMarkup(createElement(Dashboard, { report, backtest, meta: { mode: "offline", commitSha: process.env.FREEZE_COMMIT_SHA ?? null, generatedAt: raw.exportedAt, freezeNote: FREEZE_NOTE } }));
  const html = `<!doctype html><html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dashboard offline - Freezyle Trend Breakout Crypto</title><style>${DASHBOARD_CSS}</style></head><body>${markup}<script type="application/json" id="raw-export">${safeJson(raw)}</script><script type="application/json" id="report">${safeJson(report)}</script><script>${verifyJs}</script></body></html>`;
  put(path.join(OUT, "dashboard-offline.html"), html);
  mkdirSync(path.join(ROOT, "dashboard", "offline"), { recursive: true });
  writeFileSync(path.join(ROOT, "dashboard", "offline", "index.html"), html);
  writeFileSync(path.join(OUT, "MANIFEST.json"), JSON.stringify({ exportedAt: raw.exportedAt, configHash: raw.configHash, reportHash: sha256(stableStringify(report)), files }, null, 1));
  console.log(`ekspor: ${raw.tickRuns.length} tick, ${raw.signals.length} sinyal, ${raw.orders.length} order, paritas ${report.parity.matches}/${report.parity.compared}, html ${(html.length / 1024).toFixed(0)} KB`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
