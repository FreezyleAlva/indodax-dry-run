// research/downloader/universe.ts
import path from "node:path";
import { FROZEN_CONFIG } from "@/strategy/config";
import { MANIFEST_DIR, RAW_DIR, STABLE_OR_PEGGED, researchClient, writeJson, writeRaw } from "./common";

const LOOKBACK_DAYS = 30;
const TOP_N = 5;

async function main() {
  const client = researchClient();
  const startMs = Date.parse(FROZEN_CONFIG.backtest.start);
  const startSec = Math.floor(startMs / 1000);
  const pairs = await client.pairs();
  const accessedAt = new Date().toISOString();
  const candidates = pairs.data.filter((p) => p.pair.endsWith("idr")).filter((p) => !STABLE_OR_PEGGED.has(p.tickerId.replace(/_idr$/, "")));
  const rows: { pair: string; days: number; avgDailyTurnoverIdr: number; firstDay: string | null; rawHash: string }[] = [];
  let n = 0;
  for (const p of candidates) {
    n++;
    try {
      const r = await client.candles(p.symbol, "1D", startSec - 86400 * (LOOKBACK_DAYS + 15), startSec);
      const rawHash = writeRaw(path.join(RAW_DIR, "universe-1D", `${p.pair}.json`), r.raw);
      const window = r.data.filter((c) => c.openTime + 86400 <= startSec && c.openTime >= startSec - 86400 * LOOKBACK_DAYS);
      const turnover = window.reduce((s, c) => s + c.close * c.volume, 0) / LOOKBACK_DAYS;
      rows.push({ pair: p.pair, days: window.length, avgDailyTurnoverIdr: turnover, firstDay: window[0] ? new Date(window[0].openTime * 1000).toISOString().slice(0, 10) : null, rawHash });
    } catch (e) {
      rows.push({ pair: p.pair, days: 0, avgDailyTurnoverIdr: 0, firstDay: null, rawHash: `ERROR:${(e as Error).message}` });
    }
    if (n % 50 === 0) console.log(`${n}/${candidates.length}`);
  }
  const eligible = rows.filter((r) => r.days >= LOOKBACK_DAYS - 2).sort((a, b) => b.avgDailyTurnoverIdr - a.avgDailyTurnoverIdr || (a.pair < b.pair ? -1 : 1));
  const selected = eligible.slice(0, TOP_N).map((r) => r.pair);
  const out = {
    rule: `Top ${TOP_N} pasangan IDR menurut rata-rata nilai transaksi harian (close x volume, IDR) selama ${LOOKBACK_DAYS} hari sebelum awal backtest ${FROZEN_CONFIG.backtest.start}; minimal ${LOOKBACK_DAYS - 2} hari data; stablecoin dan aset yang dipatok (USD/emas) dikeluarkan.`,
    survivorshipNote: "Kandidat diambil dari /api/pairs saat akses. Pasangan yang sudah delisting sebelum tanggal akses tidak terlihat dari API publik; keterbatasan ini dicatat, bukan disembunyikan.",
    accessedAt,
    candidates: candidates.length,
    requests: client.requestCount,
    retries: client.retryCount,
    selected,
    top20: eligible.slice(0, 20),
    all: rows,
  };
  writeJson(path.join(MANIFEST_DIR, "universe.json"), out);
  console.log("SELECTED", selected.join(","));
  console.log(eligible.slice(0, 12).map((r) => `${r.pair}:${(r.avgDailyTurnoverIdr / 1e9).toFixed(2)}M`).join(" "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
