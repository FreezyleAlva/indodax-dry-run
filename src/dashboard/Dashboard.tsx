// src/dashboard/Dashboard.tsx
import type { Report } from "@/analytics/report";
import type { Metrics } from "@/analytics/metrics";
import type { ClosedTrade, EquityPoint } from "@/domain/types";
import { FROZEN_CONFIG } from "@/strategy/config";
import { LineChart } from "./Chart";
import { idr, num, pct, qty, signClass, wib } from "./format";

export type BacktestSummary = {
  generatedAt: string;
  strategy: { name: string; version: string; configHash: string; basedOn: string };
  window: { start: string; end: string };
  assumptions: { feeRate: number; feeSource: string; costs: Record<string, { buyCost: number; sellCost: number }>; execution: string; dailyLoss: string };
  inputHashes: Record<string, string>;
  metrics: Metrics;
  benchmark: { name: string; metrics: Metrics; equity: EquityPoint[] };
  equity: EquityPoint[];
  trades: ClosedTrade[];
  reasonCounts: Record<string, number>;
  rejectedCount: number;
  forwardWindowReplay: { start: string; end: string; note: string; metrics: Metrics; benchmark: Metrics; trades: ClosedTrade[] };
};

export type DashboardMeta = { mode: "online" | "offline"; commitSha: string | null; generatedAt: string; freezeNote: string };

function Kpi({ l, v, s, cls }: { l: string; v: string; s?: string; cls?: string }) {
  return (
    <div className="kpi">
      <div className="l">{l}</div>
      <div className={`v ${cls ?? ""}`}>{v}</div>
      {s ? <div className="s">{s}</div> : null}
    </div>
  );
}

function pf(m: Metrics) {
  return m.profitFactorInfinite ? "tak terhingga (nol trade rugi)" : num(m.profitFactor);
}

function MetricRow({ name, m, cagr }: { name: string; m: Metrics; cagr: boolean }) {
  return (
    <tr>
      <td>{name}</td>
      <td className={`r ${signClass(m.totalReturn)}`}>{pct(m.totalReturn)}</td>
      <td className="r">{cagr ? pct(m.cagr) : "tidak ditampilkan"}</td>
      <td className="r neg">{pct(m.maxDrawdown)}</td>
      <td className="r">{pf(m)}</td>
      <td className="r">{pct(m.winRate)}</td>
      <td className="r">{idr(m.avgWin)}</td>
      <td className="r">{idr(m.avgLoss)}</td>
      <td className="r">{m.trades}</td>
      <td className="r">{m.costRatio === null ? "-" : num(m.costRatio, 3)}</td>
    </tr>
  );
}

function Kv({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data);
  if (entries.length === 0) return <p className="muted">Kosong.</p>;
  return (
    <table>
      <tbody>
        {entries.map(([k, v]) => (
          <tr key={k}>
            <td className="mono">{k}</td>
            <td className="r">{v}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function Dashboard({ report, backtest, meta }: { report: Report; backtest: BacktestSummary; meta: DashboardMeta }) {
  const cfg = FROZEN_CONFIG;
  const r = report;
  const op = r.operations;
  return (
    <div className="wrap">
      <div className="head">
        <div>
          <h1>{cfg.strategyName}</h1>
          <p className="muted">Bot dry run Indodax. Order simulasi, data publik asli, tanpa API key, tanpa uang sungguhan. Semua angka dihitung dari log mentah.</p>
        </div>
        <div className="tags">
          <span className="tag">versi {r.strategyVersion}</span>
          <span className="tag mono">config {r.configHash}</span>
          <span className="tag mono">commit {meta.commitSha ? meta.commitSha.slice(0, 10) : "lokal"}</span>
          <span className="tag">{meta.mode === "online" ? "online (DB langsung)" : "offline (ekspor)"}</span>
          <span className="tag">dibuat {wib(meta.generatedAt)}</span>
        </div>
      </div>

      <div className="notice">
        <b>Catatan jujur.</b> {meta.freezeNote} Bot mulai jalan {wib(r.botStart)}; tick terakhir {wib(r.lastTick)}. Jendela forward resmi {wib(cfg.backtest.forwardStart)} sampai {wib(cfg.backtest.forwardEnd)}.
      </div>

      {meta.mode === "offline" ? <div className="verify" id="verify">Verifikasi hitung ulang di browser belum jalan (JavaScript mati).</div> : null}

      <section className="panel">
        <h2>Portofolio</h2>
        {r.portfolio ? (
          <div className="grid">
            <Kpi l="Ekuitas (inventori di best bid)" v={idr(r.portfolio.equity)} cls={signClass(r.portfolio.equity - cfg.portfolio.initialCapital)} s={`modal awal ${idr(cfg.portfolio.initialCapital)}`} />
            <Kpi l="Kas virtual" v={idr(r.portfolio.cash)} />
            <Kpi l="Nilai inventori di bid" v={idr(r.portfolio.inventoryAtBid)} />
            <Kpi l="PnL terealisasi" v={idr(r.portfolio.realizedPnl)} cls={signClass(r.portfolio.realizedPnl)} />
            <Kpi l="PnL belum terealisasi" v={idr(r.portfolio.unrealizedPnl)} cls={signClass(r.portfolio.unrealizedPnl)} />
            <Kpi l="Posisi terbuka" v={String(r.portfolio.openPositions.length)} s={`maks ${cfg.portfolio.maxPositions}`} />
          </div>
        ) : (
          <p className="muted">Belum ada snapshot ekuitas.</p>
        )}
        {r.portfolio && r.portfolio.openPositions.length > 0 ? (
          <div className="scroll" style={{ marginTop: 12 }}>
            <table>
              <thead><tr><th>Pasangan</th><th className="r">Kuantitas</th><th className="r">Basis biaya</th><th>Dibuka</th></tr></thead>
              <tbody>
                {r.portfolio.openPositions.map((p) => (
                  <tr key={p.pair}><td>{p.pair}</td><td className="r">{qty(p.qty)}</td><td className="r">{idr(p.costBasis)}</td><td>{wib(p.openedAt)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <h2>Kinerja: backtest vs forward</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Seri</th><th className="r">Return</th><th className="r">CAGR</th><th className="r">MDD</th><th className="r">PF</th><th className="r">Win rate</th><th className="r">Rata menang</th><th className="r">Rata rugi</th><th className="r">Trade</th><th className="r">Cost ratio</th></tr></thead>
            <tbody>
              <MetricRow name={`Backtest 3 tahun (${backtest.window.start.slice(0, 10)} s.d. ${backtest.window.end.slice(0, 10)})`} m={backtest.metrics} cagr />
              <MetricRow name="BTC/IDR buy and hold, jendela sama" m={backtest.benchmark.metrics} cagr />
              <MetricRow name={`Backtest jendela forward resmi (replay, sampai ${backtest.forwardWindowReplay.end.slice(0, 16)})`} m={backtest.forwardWindowReplay.metrics} cagr={false} />
              <MetricRow name="Forward test bot (dari log)" m={r.forward} cagr={false} />
              <MetricRow name={`Backtest jendela bot jalan (replay candle yang sama)`} m={r.sameWindowBacktest.metrics} cagr={false} />
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>Return sudah dikurangi fee taker {pct(backtest.assumptions.feeRate)} dan biaya spread/slippage. Win rate: PnL bersih &gt; 0 = menang; impas dihitung kalah. CAGR tidak ditampilkan untuk forward 10 hari.</p>
        <div className="two" style={{ marginTop: 12 }}>
          <LineChart title="Backtest 3 tahun vs BTC buy and hold" series={[{ name: "Strategi", color: "#4AA3B3", points: backtest.equity }, { name: "BTC/IDR buy and hold", color: "#4A7BC0", points: backtest.benchmark.equity, dashed: true }]} />
          <LineChart title="Forward: bot vs replay backtest vs BTC" series={[{ name: "Bot forward (best bid)", color: "#4AA3B3", points: r.forwardEquity }, { name: "Replay backtest", color: "#7F8DA3", points: r.sameWindowBacktest.equity, dashed: true }, ...(r.benchmark ? [{ name: "BTC/IDR buy and hold", color: "#4A7BC0", points: r.benchmark.equity }] : [])]} />
        </div>
      </section>

      <section className="panel">
        <h2>Paritas sinyal backtest vs forward</h2>
        <div className="grid">
          <Kpi l="Candle dibandingkan" v={String(r.parity.compared)} />
          <Kpi l="Cocok" v={String(r.parity.matches)} cls="pos" />
          <Kpi l="Tidak cocok" v={String(r.parity.mismatches)} cls={r.parity.mismatches > 0 ? "neg" : ""} />
          <Kpi l="Tingkat cocok" v={pct(r.parity.rate)} />
        </div>
        <div className="two" style={{ marginTop: 12 }}>
          <div><h3>Alasan</h3><Kv data={r.parity.byReason} /></div>
          <div className="scroll">
            <table>
              <thead><tr><th>Candle (open)</th><th>Pasangan</th><th>Forward</th><th>Backtest</th><th>Hasil</th></tr></thead>
              <tbody>
                {r.parity.rows.slice(-150).reverse().map((p) => (
                  <tr key={`${p.pair}${p.candleOpenTime}`}><td>{wib(p.candleOpenTime * 1000)}</td><td>{p.pair}</td><td className="mono">{p.forward}</td><td className="mono">{p.backtest ?? "-"}</td><td className={p.match ? "ok" : "bad"}>{p.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Analisis biaya</h2>
        <div className="grid">
          <Kpi l="Fee taker" v={idr(r.costs.fees)} s={backtest.assumptions.feeSource} />
          <Kpi l="Spread (best vs mid)" v={idr(r.costs.spread)} />
          <Kpi l="Slippage (VWAP vs best)" v={idr(r.costs.slippage)} />
          <Kpi l="Cost ratio" v={r.costs.costRatio === null ? "-" : num(r.costs.costRatio, 3)} s="(fee + spread + slippage) / laba kotor sebelum biaya" />
          <Kpi l="Order terisi" v={String(r.costs.filledOrders)} />
        </div>
        <h3 style={{ marginTop: 12 }}>Distribusi spread snapshot order book (bps)</h3>
        <table>
          <thead><tr><th>Pasangan</th><th className="r">Snapshot</th><th className="r">Median</th><th className="r">P90</th><th className="r">Maks</th><th className="r">Biaya beli model</th><th className="r">Biaya jual model</th></tr></thead>
          <tbody>
            {cfg.universe.map((p) => {
              const s = r.costs.spreadBpsByPair[p];
              const c = backtest.assumptions.costs[p];
              return (
                <tr key={p}><td>{p}</td><td className="r">{s?.n ?? 0}</td><td className="r">{num(s?.p50 ?? null, 1)}</td><td className="r">{num(s?.p90 ?? null, 1)}</td><td className="r">{num(s?.max ?? null, 1)}</td><td className="r">{c ? `${num(c.buyCost * 10000, 1)} bps` : "-"}</td><td className="r">{c ? `${num(c.sellCost * 10000, 1)} bps` : "-"}</td></tr>
              );
            })}
          </tbody>
        </table>
        <p className="muted" style={{ marginTop: 8 }}>Dekomposisi terhadap mid saat keputusan: spread = kuantitas x (best ask - mid) untuk beli, (mid - best bid) untuk jual; slippage = kuantitas x selisih VWAP terhadap best. Jumlah keduanya = kuantitas x |VWAP - mid|, tidak dihitung dua kali.</p>
      </section>

      <section className="panel">
        <h2>Operasional</h2>
        <div className="grid">
          <Kpi l="Total tick" v={String(op.ticks)} />
          <Kpi l="Uptime sejak deploy" v={pct(op.uptime)} s={`${op.onTimeCandles}/${op.scheduledCandles} candle-pasangan tepat waktu`} />
          <Kpi l="Uptime jendela resmi" v={pct(op.officialUptime)} s={`${op.officialWindowOnTime}/${op.officialWindowCandles} (termasuk sebelum deploy)`} cls={op.officialUptime !== null && op.officialUptime < 0.9 ? "warn" : ""} />
          <Kpi l="Latensi tick p50 / p95" v={`${num(op.latencyP50, 0)} / ${num(op.latencyP95, 0)} ms`} />
          <Kpi l="Error API" v={String(op.apiErrors)} />
          <Kpi l="Retry" v={String(op.retries)} />
          <Kpi l="Drift scheduler p50" v={op.schedulerDriftP50Sec === null ? "-" : `${num(op.schedulerDriftP50Sec, 0)} dtk`} />
        </div>
        <div className="two" style={{ marginTop: 12 }}>
          <div><h3>Status tick</h3><Kv data={op.byStatus} /></div>
          <div><h3>Sumber pemanggil</h3><Kv data={op.bySource} /></div>
        </div>
        <p className="muted" style={{ marginTop: 8 }}>Tepat waktu = candle diproses sebelum candle berikutnya tutup (definisi soal). Candle sebelum bot ter-deploy dihitung terlewat di uptime jendela resmi.</p>
      </section>

      <section className="panel two">
        <div>
          <h2>Keamanan risiko</h2>
          <div className="grid">
            <Kpi l="Event kill switch" v={String(r.safety.killSwitchEvents)} />
            <Kpi l="Event daily loss lock" v={String(r.safety.dailyLossEvents)} s={`batas ${pct(cfg.risk.dailyLossLimit, 0)} dari ekuitas awal hari WIB`} />
          </div>
          <h3 style={{ marginTop: 12 }}>Entry/exit ditolak per alasan</h3>
          <Kv data={r.safety.rejectedByReason} />
        </div>
        <div>
          <h2>Kesehatan data</h2>
          <table>
            <thead><tr><th>Pasangan</th><th className="r">Umur candle tutup terakhir saat tick terakhir</th></tr></thead>
            <tbody>
              {Object.entries(r.dataHealth.lastClosedAgeSecByPair).map(([p, a]) => (
                <tr key={p}><td>{p}</td><td className={`r ${a !== null && a > cfg.risk.staleBars * cfg.timeframeSeconds ? "warn" : ""}`}>{a === null ? "-" : `${num(a / 60, 0)} menit`}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="grid" style={{ marginTop: 12 }}>
            <Kpi l="Event candle terlewat" v={String(r.dataHealth.missedCandleEvents)} />
            <Kpi l="Order book invalid" v={String(r.dataHealth.invalidBooks)} />
            <Kpi l="Tolak spread > 2%" v={String(r.dataHealth.spreadRejects)} />
            <Kpi l="Event candle invalid" v={String(r.dataHealth.invalidCandleEvents)} />
          </div>
        </div>
      </section>

      <section className="panel">
        <h2>Trade forward tertutup</h2>
        {r.forwardTrades.length === 0 ? <p className="muted">Belum ada trade tertutup pada forward test.</p> : (
          <div className="scroll">
            <table>
              <thead><tr><th>Pasangan</th><th>Masuk</th><th>Keluar</th><th className="r">Kuantitas</th><th className="r">Fee</th><th className="r">Spread+slip</th><th className="r">PnL bersih</th><th>Alasan</th></tr></thead>
              <tbody>
                {r.forwardTrades.map((t, i) => (
                  <tr key={i}><td>{t.pair}</td><td>{wib(t.entryTime)}</td><td>{wib(t.exitTime)}</td><td className="r">{qty(t.qty)}</td><td className="r">{idr(t.fees)}</td><td className="r">{idr(t.spreadCost + t.slippageCost)}</td><td className={`r ${signClass(t.pnl)}`}>{idr(t.pnl)}</td><td className="mono">{t.exitReason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="panel">
        <h2>Aturan beku</h2>
        <table>
          <tbody>
            <tr><td>Universe</td><td className="mono">{cfg.universe.join(", ")} (rezim: {cfg.regimePair})</td></tr>
            <tr><td>Timeframe</td><td>4 jam, hanya candle tertutup</td></tr>
            <tr><td>Entry</td><td>Close &gt; high tertinggi {cfg.params.breakout} bar sebelumnya, close &gt; SMA{cfg.params.trendMa}, close BTC/IDR &gt; SMA{cfg.params.regimeMa} BTC/IDR</td></tr>
            <tr><td>Exit</td><td>Close &lt; close tertinggi sejak masuk - {cfg.params.trailAtr} x ATR{cfg.params.atrWindow}. Tidak ada take profit.</td></tr>
            <tr><td>Sizing</td><td>min({pct(cfg.portfolio.positionFraction, 0)} ekuitas, kas - {pct(cfg.portfolio.cashReserveFraction, 0)} ekuitas cadangan, {pct(cfg.params.liquidityCap, 0)} rata-rata nilai transaksi {cfg.params.liquidityWindow} bar); maks {cfg.portfolio.maxPositions} posisi; ranking kekuatan breakout</td></tr>
            <tr><td>Risiko</td><td>Daily loss {pct(cfg.risk.dailyLossLimit, 0)} dari ekuitas snapshot pertama hari WIB; kill switch di DB; spread &gt; {pct(cfg.risk.spreadMax, 0)} ditolak; data basi &gt; {cfg.risk.staleBars} bar ditolak</td></tr>
            <tr><td>Eksekusi</td><td>BUY makan ask, SELL makan bid, VWAP multi level, fee taker kedua sisi, kedalaman kurang = partial fill sisa dibatalkan</td></tr>
            <tr><td>Asal</td><td>{cfg.basedOn}</td></tr>
          </tbody>
        </table>
      </section>
    </div>
  );
}
