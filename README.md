# Indodax Dry-Run Trading Bot - Freezyle Trend Breakout Crypto

UAS Algorithmic Trading. Bot ini spot long-only. Order-nya cuma simulasi: datanya dari API publik Indodax, tanpa API key dan tanpa uang sungguhan. Bot jalan di Vercel, dipanggil scheduler eksternal, dan state-nya disimpan di Postgres (Neon). Semua angka di dashboard dihitung ulang dari log mentah, gak ada yang diketik tangan.

Status jujur: jadwal freeze resmi 4 Nov 2026 12.00 WIB sudah terlewat, karena repositori ini baru dibuat 9 Nov 2026. Commit freeze pakai jam asli dan gak dimundurkan. Lihat `docs/freeze-record.md`.

## Arsitektur

```
GitHub Actions (7 * * * *) --POST Bearer CRON_SECRET--> /api/tick (Vercel, Node, maks 300 dtk)
  TickService: lease -> server_time -> pairs/price_increments -> candles 4j (221 bar) -> depth 5 pasangan
             -> validasi (candle tutup, OHLC, staleness, gap, book, spread) -> evaluateSignal (fungsi murni, sama dengan backtest)
             -> risk gate (kill switch, daily loss WIB, data basi) -> simulasi jalan order book (VWAP, fee, increment, minimum)
             -> 1 transaksi DB: sinyal + order + fill + ledger + posisi + snapshot ekuitas -> tick_runs
Vercel Cron harian (37 17 * * *) = cadangan kalau GitHub Actions telat.
Dashboard online (/) = baca DB, hitung lewat buildReport(). Dashboard offline = komponen React yang sama dirender statis + verifikasi di browser.
```

| Folder | Isi |
|---|---|
| `src/domain` | Tipe Candle, Signal, OrderBook, Fill, Position |
| `src/indicators` | SMA, highest sebelumnya, ATR, turnover, deteksi gap (deterministik, tanpa rolling sum) |
| `src/strategy` | `config.ts` (parameter beku), `evaluate.ts` (satu-satunya logika sinyal), `portfolio.ts` (ranking + sizing), `hash.ts` |
| `src/market-data` | `IndodaxPublicClient`: timeout, retry terbatas + jitter, normalisasi |
| `src/validation` | Guard candle tertutup, OHLC, staleness, order book, spread |
| `src/execution` | Simulator jalan order book (BUY di ask, SELL di bid) |
| `src/risk` | Hari WIB, daily loss, kill switch |
| `src/persistence` | Postgres (`pg`) / PGlite lokal, migrasi, ekspor log |
| `src/services/tick.ts` | Orkestrasi satu tick |
| `src/backtest` | Mesin backtest yang memanggil `evaluateSignal` dan `planOrders` yang sama |
| `src/analytics` | Metrik dan `buildReport` (dipakai dashboard online, offline, dan hitung_ulang) |
| `src/dashboard` | Komponen dashboard + verifikasi offline |
| `research/` | Downloader 3 tahun, pemilihan universe, runner backtest, manifest, data mentah + SHA256 |
| `scripts/` | migrate, tick lokal, snapshot order book, ekspor, hitung_ulang, paritas |
| `migrations/` | Skema SQL (sumber tunggal, di-generate ke modul TS saat build) |
| `docs/` | strategi, risiko, eksekusi, freeze, change log, refleksi |
| `tests/` | 30 tes unit + integrasi (PGlite, respons Indodax tiruan) |

## Jalankan lokal

```powershell
npm install
npm test
npm run tick:local
npm run dev
```

Tanpa `DATABASE_URL`, mode lokal pakai PGlite di `.data/pglite`. Kalau `BOT_ENV=production` atau jalan di Vercel tanpa `DATABASE_URL`, bot menolak jalan (gagal tertutup).

## Riset dan backtest

```powershell
npm run universe
npm run download
npm run snapshots -- 3
npm run backtest
```

Output-nya:

- `research/manifests/universe.json`
- `research/manifests/extraction.json`
- `research/manifests/cost-model.json`
- `research/output/backtest.json` dan `backtest-summary.json`

## Deploy (langkah lengkap di `DEPLOY.md`)

1. Repo GitHub publik + commit freeze (`1-FREEZE-DAN-PUSH.bat`).
2. Vercel: import repo, tambah Neon dari menu Storage (otomatis mengisi `DATABASE_URL`), isi `CRON_SECRET`, deploy.
3. GitHub: isi secret `BOT_TICK_URL` (`https://<app>.vercel.app/api/tick`) dan `CRON_SECRET`, jalankan workflow sekali secara manual.

## Pengumpulan

`3-EKSPOR-PENGUMPULAN.bat` menjalankan ekspor log mentah, `hitung_ulang`, dan paritas, lalu membuat ZIP berisi source code, `.git` utuh, folder `submission/` (log, `report.json`, dashboard offline), dan docs.

## Variabel lingkungan

Nama variabelnya ada di `.env.example`. Nilai aslinya cuma disimpan di Vercel env dan GitHub secrets, gak pernah masuk repo.
