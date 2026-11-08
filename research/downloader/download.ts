// research/downloader/download.ts
import path from "node:path";
import { FROZEN_CONFIG, warmupBars } from "@/strategy/config";
import type { Candle } from "@/domain/types";
import { validateCandles } from "@/validation/guards";
import { DATA_DIR, MANIFEST_DIR, RAW_DIR, researchClient, writeJson, writeRaw } from "./common";

const PAGE_BARS = 3000;

async function downloadPair(pair: string, startSec: number, endSec: number) {
  const client = researchClient();
  const tf = FROZEN_CONFIG.timeframeSeconds;
  const pages: { page: number; from: number; to: number; bars: number; first: number | null; last: number | null; sha256: string; file: string }[] = [];
  const all = new Map<number, Candle>();
  let to = endSec;
  let page = 0;
  while (to > startSec) {
    const from = Math.max(startSec, to - PAGE_BARS * tf);
    const r = await client.candles(pair.toUpperCase(), FROZEN_CONFIG.timeframe, from, to);
    const file = path.join(RAW_DIR, `${pair}_${FROZEN_CONFIG.timeframe}`, `page_${String(page).padStart(3, "0")}.json`);
    const hash = writeRaw(file, r.raw);
    pages.push({ page, from, to, bars: r.data.length, first: r.data[0]?.openTime ?? null, last: r.data[r.data.length - 1]?.openTime ?? null, sha256: hash, file: path.relative(DATA_DIR, file).split(path.sep).join("/") });
    for (const c of r.data) all.set(c.openTime, c);
    page++;
    if (r.data.length === 0) break;
    const earliest = r.data[0]!.openTime;
    if (earliest <= startSec) break;
    to = earliest - 1;
  }
  const merged = [...all.values()].sort((a, b) => a.openTime - b.openTime);
  const closed = merged.filter((c) => c.openTime + tf <= endSec);
  const { valid, invalid } = validateCandles(closed);
  let gaps = 0;
  const gapList: { after: number; missingBars: number }[] = [];
  for (let i = 1; i < valid.length; i++) {
    const d = valid[i]!.openTime - valid[i - 1]!.openTime;
    if (d !== tf) { gaps++; if (gapList.length < 50) gapList.push({ after: valid[i - 1]!.openTime, missingBars: d / tf - 1 }); }
  }
  const out = path.join(DATA_DIR, `${pair}_${FROZEN_CONFIG.timeframe}.json`);
  const hash = writeJson(out, valid);
  return {
    pair,
    timeframe: FROZEN_CONFIG.timeframe,
    requests: client.requestCount,
    retries: client.retryCount,
    pages,
    bars: valid.length,
    first: valid[0] ? new Date(valid[0].openTime * 1000).toISOString() : null,
    last: valid[valid.length - 1] ? new Date(valid[valid.length - 1]!.openTime * 1000).toISOString() : null,
    invalid,
    gaps,
    gapList,
    mergedFile: path.relative(DATA_DIR, out).split(path.sep).join("/"),
    mergedSha256: hash,
  };
}

async function main() {
  const tf = FROZEN_CONFIG.timeframeSeconds;
  const btStart = Math.floor(Date.parse(FROZEN_CONFIG.backtest.start) / 1000);
  const startSec = btStart - (warmupBars() + 60) * tf;
  const endSec = Math.floor(Date.now() / 1000);
  const pairs = Array.from(new Set([...FROZEN_CONFIG.universe, FROZEN_CONFIG.regimePair]));
  const results = [];
  for (const pair of pairs) {
    const r = await downloadPair(pair, startSec, endSec);
    console.log(pair, r.bars, r.first, r.last, "gaps", r.gaps, "invalid", r.invalid.length);
    results.push(r);
  }
  writeJson(path.join(MANIFEST_DIR, "extraction.json"), {
    source: "https://indodax.com/tradingview/history_v2 (API publik, tanpa API key)",
    protocol: "Per pasangan: minta halaman terbaru, simpan mentah + SHA256, set `to` ke bar paling awal - 1 detik, mundur sampai awal warm-up. Sekuensial, jeda minimal 350 ms (< 3 request/detik). Dedup per open_time. Hanya bar yang sudah tutup pada waktu ekstraksi.",
    extractedAt: new Date().toISOString(),
    warmupStart: new Date(startSec * 1000).toISOString(),
    backtestStart: FROZEN_CONFIG.backtest.start,
    results,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
