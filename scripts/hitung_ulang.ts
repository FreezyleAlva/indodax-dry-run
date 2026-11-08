// scripts/hitung_ulang.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildReport, type RawExport, type Report } from "@/analytics/report";
import { stableStringify } from "@/strategy/hash";

const ROOT = path.resolve(__dirname, "..");

function main() {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, "submission", "data");
  const raw = JSON.parse(readFileSync(path.join(dir, "raw-export.json"), "utf8")) as RawExport;
  const shown = JSON.parse(readFileSync(path.join(dir, "report.json"), "utf8")) as Report;
  const again = buildReport(raw);
  const checks: [string, boolean, string][] = [];
  checks.push(["laporan dihitung ulang identik dengan report.json", stableStringify(again) === stableStringify(shown), ""]);

  const cash = raw.ledger.filter((l) => l.currency === "IDR").reduce((s, l) => s + l.amount, 0);
  const lastPost = raw.equity.filter((e) => e.phase === "POST_TRADE").sort((a, b) => a.id - b.id).pop();
  checks.push(["kas dari ledger = kas snapshot terakhir", lastPost ? Math.abs(lastPost.cash - cash) < 1e-4 : raw.ledger.length <= 1, `ledger ${cash.toFixed(4)} snapshot ${lastPost?.cash.toFixed(4) ?? "-"}`]);
  checks.push(["kas tidak pernah negatif", raw.equity.every((e) => e.cash >= -1e-6), ""]);
  const qtyLedger = new Map<string, number>();
  for (const l of raw.ledger.filter((x) => x.currency !== "IDR")) qtyLedger.set(l.currency, (qtyLedger.get(l.currency) ?? 0) + l.amount);
  const qtyPos = new Map<string, number>();
  for (const p of raw.positions.filter((x) => x.status === "OPEN")) qtyPos.set(p.pair, (qtyPos.get(p.pair) ?? 0) + p.qty);
  const pairs = new Set([...qtyLedger.keys(), ...qtyPos.keys()]);
  checks.push(["inventori ledger = posisi terbuka", [...pairs].every((p) => Math.abs((qtyLedger.get(p) ?? 0) - (qtyPos.get(p) ?? 0)) < 1e-8), ""]);
  checks.push(["inventori tidak negatif", [...qtyLedger.values()].every((v) => v >= -1e-8), ""]);
  const keys = raw.signals.map((s) => `${s.pair}|${s.candle_open_time}|${s.strategy_version}`);
  checks.push(["tidak ada candle diproses dua kali", new Set(keys).size === keys.length, ""]);
  checks.push(["fill <= permintaan", raw.orders.every((o) => o.side !== "BUY" || o.notional + o.fee <= (o.requested_notional ?? Infinity) + 1e-6), ""]);
  const realized = raw.positions.reduce((s, p) => s + Number(p.realized_pnl ?? 0), 0);
  checks.push(["PnL terealisasi snapshot = jumlah PnL posisi", lastPost ? Math.abs(lastPost.realized_pnl - realized) < 1e-4 : true, ""]);

  for (const [name, ok, info] of checks) console.log(`${ok ? "OK   " : "GAGAL"} ${name}${info ? ` (${info})` : ""}`);
  const f = again.forward;
  console.log(`forward: return ${f.totalReturn === null ? "-" : (f.totalReturn * 100).toFixed(4) + "%"}, MDD ${f.maxDrawdown === null ? "-" : (f.maxDrawdown * 100).toFixed(4) + "%"}, trade ${f.trades}, paritas ${again.parity.matches}/${again.parity.compared}, uptime ${again.operations.uptime === null ? "-" : (again.operations.uptime * 100).toFixed(2) + "%"}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
}

main();
