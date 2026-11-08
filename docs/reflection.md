# Refleksi (diisi sesudah forward test selesai)

Semua angka di sini wajib diambil dari `submission/data/report.json` hasil `npm run export`, lalu dicocokkan lewat `npm run hitung_ulang`. Jangan ada angka yang diketik dari ingatan.

## 1. Paritas sinyal

- Jumlah candle dibandingkan, jumlah yang cocok, dan yang tidak cocok: ambil dari `report.parity`.
- Untuk tiap ketidakcocokan, sebutkan alasannya (`report.parity.byReason`) dan penyebab teknisnya.

## 2. Selisih fill forward vs backtest

- Bandingkan VWAP order forward (`sim_orders.avg_fill`) dengan harga eksekusi model backtest di candle yang sama.
- Pisahkan efek waktu eksekusi: forward mengeksekusi di tick sesudah candle tutup, sedangkan backtest di open bar berikutnya.

## 3. Spread dan slippage

- Distribusi spread per pasangan: `report.costs.spreadBpsByPair`.
- Bandingkan biaya terukur forward dengan model biaya backtest (`research/manifests/cost-model.json`, 3 putaran snapshot sebelum freeze).
- Keterbatasan: sampel model biaya kecil.

## 4. Keterlambatan scheduler dan uptime

- Drift p50: `report.operations.schedulerDriftP50Sec`.
- Uptime sejak deploy: `report.operations.uptime`.
- Uptime jendela resmi: `report.operations.officialUptime`.
- Jelaskan bahwa candle 4 Nov 12.00 WIB sampai saat deploy hilang karena bot belum ada, bukan karena bot gagal jalan.

## 5. Keterbatasan yang diakui

- Freeze terlambat dari jadwal (lihat `docs/freeze-record.md`).
- Survivorship: universe diambil dari pasangan yang masih terdaftar.
- Backtest mengeksekusi di open bar berikutnya dengan biaya median. Forward mengeksekusi terhadap order book nyata.
