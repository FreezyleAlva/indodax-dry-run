# Model eksekusi

## Forward (bot live)

1. Tick membaca `/api/server_time`. Candle dianggap sudah tutup kalau `open_time + 14400 <= server_time`.
2. Sinyal diambil dari candle tutup terakhir. Order disimulasikan saat itu juga terhadap order book `/api/depth/{pair}` yang diambil di tick yang sama.
3. BUY makan level ask mulai dari harga terendah, SELL makan bid mulai dari harga tertinggi. Isi per level = min(sisa, kuantitas level), dibulatkan ke bawah ke `quantity_increment`. BUY dibatasi anggaran IDR yang sudah termasuk fee.
4. VWAP = jumlah(harga x isi) / jumlah(isi). Fee = notional x fee taker, dengan fee taker = max(`/api/pairs trade_fee_percent_taker`, 0,20%).
5. Kalau kedalaman book habis, order jadi partial fill dan sisanya dibatalkan (`DEPTH_EXHAUSTED_REMAINDER_CANCELLED`). Order di bawah minimum Rp10.000 ditolak.
6. Seluruh jalur level yang termakan disimpan di `sim_fills`. Best bid/ask/mid saat keputusan dan harga close sinyal disimpan di `sim_orders`.
7. Inventori di-mark-to-market di best bid, bukan harga last dan bukan mid.

## Backtest

- Sinyal diambil di close bar t, eksekusi di open bar t+1.
- Harga BUY = open x (1 + biaya beli). Harga SELL = open x (1 - biaya jual).
- Biaya beli/jual = median (VWAP - mid)/mid untuk order Rp18 juta, diukur dari snapshot order book asli (`research/manifests/cost-model.json`).
- Fee taker sama dengan forward.
- Ekuitas di-mark ke close x (1 - biaya jual) sebagai proksi best bid.

## Dekomposisi biaya (tidak dihitung dua kali)

Acuannya mid saat keputusan.

- Spread = qty x (best ask - mid) untuk beli, atau qty x (mid - best bid) untuk jual.
- Slippage = qty x (VWAP - best ask) untuk beli, atau qty x (best bid - VWAP) untuk jual.
- Jadi spread + slippage = qty x |VWAP - mid|.

Cost ratio = (fee + spread + slippage) / laba kotor sebelum biaya. Laba kotor = jumlah max(0, PnL bersih + biaya trade itu) dari semua trade.
