# Kebijakan risiko

| Kontrol | Aturan | Kode |
|---|---|---|
| Modal awal | Rp100.000.000 virtual, satu event `INIT_CAPITAL`, tanpa deposit lain | `bootstrap()` |
| Batas posisi | maksimal 5 posisi terbuka, satu per pasangan (indeks unik `positions_one_open_per_pair`) | `planOrders` |
| Sizing | min(18% ekuitas, kas - 10% ekuitas, 5% Turnover20) | `sizeEntry` |
| Daily loss | Kalau ekuitas sekarang turun 5% atau lebih dari snapshot PRE_TRADE pertama hari WIB itu, entry baru diblok sampai hari WIB berikutnya | `dailyLoss` |
| Hari WIB | Pakai UTC+7 secara eksplisit. Snapshot pertama sesudah 00.00 WIB ditandai `is_day_start` (indeks unik per tanggal) | `wibDate` |
| Kill switch | `bot_state.kill_switch` di DB, tanpa redeploy. Tiap tick yang terblok mencatat `risk_events` | `entryBlockReason` |
| Data basi | Candle tutup terakhir lebih tua dari 2 x 4 jam: entry ditolak `STALE_DATA` | `staleness` |
| Spread | Kalau (best ask - best bid) / mid > 2%, entry ditolak. Exit tetap boleh di book yang valid | `validateBook` |
| Order book rusak | Book kosong, level <= 0, gak urut, atau crossed: entry dan exit ditolak, lalu dicatat | `validateBook` |
| Idempotensi | UNIQUE(pair, timeframe, candle_open_time, strategy_version) di `signals`; UNIQUE(idempotency_key) di order dan ledger | migrasi 001 |
| Konkurensi | Lease `bot_lock` 280 detik. Tick kedua yang datang barengan jadi `SKIPPED_LOCKED` | `acquireLease` |
| Retry | Maksimal 3 percobaan, backoff 300/600 ms + jitter, hanya untuk timeout/jaringan/429/5xx | `IndodaxPublicClient` |
| Gagal tertutup | Kalau server_time gagal, tick FAILED tanpa sinyal/order. Kalau candle/depth gagal, pasangan itu gak boleh entry | `runTick` |
| Invarian | Kas dan kuantitas gak boleh negatif, dicek di dalam transaksi. Kalau dilanggar, transaksi di-rollback | `runTick` |

Cara mengaktifkan kill switch (di SQL editor Neon):

```sql
UPDATE bot_state SET kill_switch = true, kill_switch_reason = 'alasan', updated_at = now() WHERE id = 1;
```
