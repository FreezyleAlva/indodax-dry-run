// scripts/collect-snapshots.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { simulateBuy, simulateSell } from "@/execution/orderbook";
import { FROZEN_CONFIG } from "@/strategy/config";
import { validateBook } from "@/validation/guards";
import { MANIFEST_DIR, researchClient, writeJson, writeRaw } from "../research/downloader/common";

const SNAP_DIR = path.join(MANIFEST_DIR, "snapshots");
const SIZE_IDR = FROZEN_CONFIG.portfolio.initialCapital * FROZEN_CONFIG.portfolio.positionFraction;

type Sample = { pair: string; capturedAt: string; spreadBps: number; buyCostBps: number; sellCostBps: number; buyFillRatio: number; levelsUsedBuy: number; valid: boolean; reason: string | null };

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = xs.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

async function collectOnce(): Promise<Sample[]> {
  const client = researchClient();
  const pairs = await client.pairs();
  const metas = new Map(pairs.data.map((m) => [m.pair, m]));
  const out: Sample[] = [];
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  for (const pair of FROZEN_CONFIG.universe) {
    const meta = metas.get(pair)!;
    const r = await client.depth(pair);
    writeRaw(path.join(SNAP_DIR, "raw", stamp, `${pair}.json`), r.raw);
    const check = validateBook(r.data, FROZEN_CONFIG.risk.spreadMax);
    const buy = simulateBuy({ asks: r.data.asks, bids: r.data.bids, budgetIdr: SIZE_IDR, feeRate: 0, quantityIncrement: meta.quantityIncrement, minNotional: meta.minBaseIdr });
    const qty = buy.filledQty > 0 ? buy.filledQty : SIZE_IDR / (check.mid || 1);
    const sell = simulateSell({ bids: r.data.bids, asks: r.data.asks, qty, feeRate: 0, quantityIncrement: meta.quantityIncrement, minNotional: meta.minBaseIdr });
    out.push({
      pair,
      capturedAt: new Date(r.receivedAt).toISOString(),
      spreadBps: (check.spread ?? NaN) * 10000,
      buyCostBps: buy.filledQty > 0 ? (buy.avgPrice / check.mid - 1) * 10000 : NaN,
      sellCostBps: sell.filledQty > 0 ? (1 - sell.avgPrice / check.mid) * 10000 : NaN,
      buyFillRatio: buy.notional / SIZE_IDR,
      levelsUsedBuy: buy.levels.length,
      valid: check.ok,
      reason: check.reason,
    });
  }
  writeJson(path.join(SNAP_DIR, `${stamp}.json`), { sizeIdr: SIZE_IDR, samples: out });
  return out;
}

async function main() {
  const rounds = Number(process.argv[2] ?? 1);
  for (let i = 0; i < rounds; i++) {
    const s = await collectOnce();
    console.log(s.map((x) => `${x.pair} spread ${x.spreadBps.toFixed(1)}bps buy ${x.buyCostBps.toFixed(1)} sell ${x.sellCostBps.toFixed(1)}`).join(" | "));
    if (i < rounds - 1) await new Promise((r) => setTimeout(r, 60000));
  }
  const files = existsSync(SNAP_DIR) ? readdirSync(SNAP_DIR).filter((f) => f.endsWith(".json")) : [];
  const all: Sample[] = files.flatMap((f) => (JSON.parse(readFileSync(path.join(SNAP_DIR, f), "utf8")) as { samples: Sample[] }).samples);
  const perPair: Record<string, { samples: number; medianSpreadBps: number | null; buyCost: number; sellCost: number; medianBuyCostBps: number | null; medianSellCostBps: number | null }> = {};
  for (const pair of FROZEN_CONFIG.universe) {
    const xs = all.filter((s) => s.pair === pair && s.valid);
    const mb = median(xs.map((s) => s.buyCostBps).filter(Number.isFinite));
    const ms = median(xs.map((s) => s.sellCostBps).filter(Number.isFinite));
    perPair[pair] = { samples: xs.length, medianSpreadBps: median(xs.map((s) => s.spreadBps).filter(Number.isFinite)), medianBuyCostBps: mb, medianSellCostBps: ms, buyCost: (mb ?? 0) / 10000, sellCost: (ms ?? 0) / 10000 };
  }
  writeJson(path.join(MANIFEST_DIR, "cost-model.json"), {
    method: `Biaya eksekusi relatif terhadap mid saat snapshot: buy = VWAP ask untuk order Rp${SIZE_IDR.toLocaleString("id-ID")} / mid - 1; sell = 1 - VWAP bid / mid untuk kuantitas yang sama. Median per pasangan dari semua snapshot valid. Fee taker dihitung terpisah.`,
    sizeIdr: SIZE_IDR,
    snapshots: files.length,
    updatedAt: new Date().toISOString(),
    perPair,
  });
  console.log(JSON.stringify(perPair));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
