// scripts/compare-signals.ts
import { writeFileSync } from "node:fs";
import path from "node:path";
import { buildReport } from "@/analytics/report";
import { getDb } from "@/persistence/db";
import { loadRawExport } from "@/persistence/export";

async function main() {
  const db = await getDb();
  const raw = await loadRawExport(db);
  await db.close();
  const r = buildReport(raw);
  const lines = ["candle_open_utc,pair,forward,backtest,match,reason", ...r.parity.rows.map((p) => `${new Date(p.candleOpenTime * 1000).toISOString()},${p.pair},${p.forward},${p.backtest ?? ""},${p.match},${p.reason}`)];
  const file = path.resolve(__dirname, "..", "submission", "parity.csv");
  writeFileSync(file, lines.join("\n"));
  console.log(`paritas: ${r.parity.matches}/${r.parity.compared} cocok, alasan ${JSON.stringify(r.parity.byReason)} -> ${file}`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
