// research/backtest/run.ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { computeMetrics } from "@/analytics/metrics";
import { buyAndHold, runBacktest, type PairCost, type PairRules } from "@/backtest/engine";
import type { Candle } from "@/domain/types";
import { FROZEN_CONFIG } from "@/strategy/config";
import { configHash, sha256 } from "@/strategy/hash";
import { DATA_DIR, MANIFEST_DIR, ROOT, researchClient, writeJson } from "../downloader/common";

function loadCandles(pair: string): Candle[] {
  return JSON.parse(readFileSync(path.join(DATA_DIR, `${pair}_${FROZEN_CONFIG.timeframe}.json`), "utf8")) as Candle[];
}

async function main() {
  const cfg = FROZEN_CONFIG;
  const hash = configHash(cfg);
  const pairs = Array.from(new Set([...cfg.universe, cfg.regimePair]));
  const candles: Record<string, Candle[]> = {};
  const inputHashes: Record<string, string> = {};
  for (const p of pairs) {
    candles[p] = loadCandles(p);
    inputHashes[p] = sha256(readFileSync(path.join(DATA_DIR, `${p}_${cfg.timeframe}.json`), "utf8"));
  }
  const costModel = JSON.parse(readFileSync(path.join(MANIFEST_DIR, "cost-model.json"), "utf8")) as { perPair: Record<string, PairCost & { samples: number }> };
  const client = researchClient();
  const metas = await client.pairs();
  const rules: Record<string, PairRules> = {};
  let apiFee = 0;
  for (const m of metas.data) if ((pairs as string[]).includes(m.pair)) { rules[m.pair] = { quantityIncrement: m.quantityIncrement, minBaseIdr: m.minBaseIdr }; apiFee = Math.max(apiFee, m.takerFee); }
  const feeRate = Math.max(apiFee, cfg.execution.feeTaker);
  const costs: Record<string, PairCost> = {};
  for (const p of cfg.universe) costs[p] = { buyCost: costModel.perPair[p]!.buyCost, sellCost: costModel.perPair[p]!.sellCost };

  const start = Math.floor(Date.parse(cfg.backtest.start) / 1000);
  const end = Math.floor(Date.parse(cfg.backtest.end) / 1000);
  const main = runBacktest({ candles, startTime: start, endTime: end, costs, rules, feeRate, configHash: hash });
  const metrics = computeMetrics([{ time: start * 1000, equity: cfg.portfolio.initialCapital }, ...main.equity], main.trades, { annualize: true });
  const bh = buyAndHold(candles[cfg.regimePair]!, start, end, cfg.timeframeSeconds, cfg.portfolio.initialCapital, costs[cfg.regimePair]!, feeRate, rules[cfg.regimePair]!.quantityIncrement);
  const bhMetrics = computeMetrics([{ time: start * 1000, equity: cfg.portfolio.initialCapital }, ...bh], [], { annualize: true });

  const fStart = Math.floor(Date.parse(cfg.backtest.forwardStart) / 1000);
  const fEnd = Math.min(Math.floor(Date.parse(cfg.backtest.forwardEnd) / 1000), Math.floor(Date.now() / 1000));
  const fwd = runBacktest({ candles, startTime: fStart, endTime: fEnd, costs, rules, feeRate, configHash: hash });
  const fwdMetrics = computeMetrics([{ time: fStart * 1000, equity: cfg.portfolio.initialCapital }, ...fwd.equity], fwd.trades, { annualize: false });
  const fwdBh = buyAndHold(candles[cfg.regimePair]!, fStart, fEnd, cfg.timeframeSeconds, cfg.portfolio.initialCapital, costs[cfg.regimePair]!, feeRate, rules[cfg.regimePair]!.quantityIncrement);

  const reasonCounts: Record<string, number> = {};
  for (const s of main.signals) reasonCounts[`${s.side}:${s.reasonCode}`] = (reasonCounts[`${s.side}:${s.reasonCode}`] ?? 0) + 1;
  const out = {
    generatedAt: new Date().toISOString(),
    strategy: { name: cfg.strategyName, version: cfg.strategyVersion, configHash: hash, basedOn: cfg.basedOn },
    window: { start: cfg.backtest.start, end: cfg.backtest.end },
    assumptions: {
      feeRate,
      feeSource: `max(/api/pairs trade_fee_percent_taker ${apiFee}, config ${cfg.execution.feeTaker})`,
      costs,
      costModel: "research/manifests/cost-model.json",
      rules,
      execution: "Sinyal di close bar t, eksekusi di open bar t+1 dengan biaya spread+slippage terukur dari snapshot order book (BUY di atas open, SELL di bawah open), fee taker kedua sisi. Ekuitas di-mark ke close x (1 - biaya jual) = proksi best bid.",
      dailyLoss: "Ekuitas awal hari WIB = ekuitas pada open bar pertama hari itu (proksi tick pertama sesudah 00.00 WIB).",
    },
    inputHashes,
    metrics,
    benchmark: { name: "BTC/IDR buy and hold", metrics: bhMetrics, equity: bh.filter((_, i) => i % 6 === 0 || i === bh.length - 1) },
    equity: main.equity.filter((_, i) => i % 6 === 0 || i === main.equity.length - 1),
    equityFull: main.equity,
    trades: main.trades,
    orders: main.orders,
    rejected: main.rejected,
    openAtEnd: main.open,
    reasonCounts,
    forwardWindowReplay: {
      start: cfg.backtest.forwardStart,
      end: new Date(fEnd * 1000).toISOString(),
      note: "Backtest diulang pada jendela forward, mulai flat di awal jendela (warm-up indikator dari histori). Dipakai untuk paritas sinyal per candle.",
      metrics: fwdMetrics,
      benchmark: computeMetrics([{ time: fStart * 1000, equity: cfg.portfolio.initialCapital }, ...fwdBh], [], { annualize: false }),
      equity: fwd.equity,
      trades: fwd.trades,
      orders: fwd.orders,
      signals: fwd.signals,
    },
  };
  writeJson(path.join(ROOT, "research", "output", "backtest.json"), out);
  writeJson(path.join(ROOT, "research", "output", "backtest-summary.json"), {
    generatedAt: out.generatedAt,
    strategy: out.strategy,
    window: out.window,
    assumptions: out.assumptions,
    inputHashes: out.inputHashes,
    metrics: out.metrics,
    benchmark: out.benchmark,
    equity: out.equity,
    trades: out.trades,
    reasonCounts: out.reasonCounts,
    rejectedCount: out.rejected.length,
    forwardWindowReplay: { start: out.forwardWindowReplay.start, end: out.forwardWindowReplay.end, note: out.forwardWindowReplay.note, metrics: out.forwardWindowReplay.metrics, benchmark: out.forwardWindowReplay.benchmark, trades: out.forwardWindowReplay.trades },
  });
  const pct = (v: number | null) => (v === null ? "-" : `${(v * 100).toFixed(2)}%`);
  console.log(`trades ${metrics.trades} ret ${pct(metrics.totalReturn)} cagr ${pct(metrics.cagr)} mdd ${pct(metrics.maxDrawdown)} pf ${metrics.profitFactor?.toFixed(2)} win ${pct(metrics.winRate)} costRatio ${metrics.costRatio?.toFixed(3)}`);
  console.log(`BTC B&H ret ${pct(bhMetrics.totalReturn)} cagr ${pct(bhMetrics.cagr)} mdd ${pct(bhMetrics.maxDrawdown)}`);
  console.log(`forward replay trades ${fwdMetrics.trades} ret ${pct(fwdMetrics.totalReturn)} signals ${fwd.signals.length}`);
  console.log(JSON.stringify(reasonCounts));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
