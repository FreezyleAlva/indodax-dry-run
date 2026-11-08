# Strategi: Freezyle Trend Breakout Crypto (uas-1.0.0)

Strategi ini turunan langsung dari strategi UTS "Freezyle Trend Breakout K100" (saham KOMPAS100, bar harian). Angka parameternya sama persis dengan UTS. Yang berubah cuma pasarnya (spot crypto IDR di Indodax) dan ukuran bar (4 jam, karena scheduler-nya intrahari dan forward test-nya 10 hari).

Sumber kebenaran: `src/strategy/config.ts`. Hash konfigurasi dicatat di tiap sinyal dan ditampilkan di dashboard.

## Universe (dipilih di awal backtest, bukan hari ini)

Top 5 pasangan IDR menurut rata-rata nilai transaksi harian (close x volume) selama 30 hari sebelum 2023-11-04 12.00 WIB. Stablecoin dan aset yang dipatok USD/emas dikeluarkan.

- Hasil: `btcidr, ethidr, xrpidr, dogeidr, solidr`.
- Bukti: `research/manifests/universe.json` (433 kandidat, peringkat lengkap, hash respons mentah).
- Keterbatasan: kandidat diambil dari `/api/pairs` saat akses. Pasangan yang sudah delisting gak kelihatan dari situ.

## Fitur

| Fitur | Definisi | Warm-up |
|---|---|---|
| HH150 | high tertinggi 150 bar SEBELUM bar sekarang | 151 bar |
| SMA100 | rata-rata close 100 bar termasuk bar sekarang | 100 bar |
| ATR20 | rata-rata true range 20 bar (TR pakai close bar sebelumnya) | 21 bar |
| Rezim | close BTC/IDR > SMA200 close BTC/IDR, pada open_time yang sama | 200 bar |
| Turnover20 | rata-rata close x volume 20 bar (IDR) | 20 bar |

Aturan data:

- Warm-up total 201 bar tertutup. Kalau kurang, HOLD `WARMUP`.
- Ada gap timestamp di jendela lookback: HOLD `DATA_GAP`, tanpa entry.
- Data rezim gak ada atau bergap: HOLD `REGIME_DATA_MISSING`.

Indikator dihitung ulang penuh per bar, bukan pakai rolling sum. Jadi hasil di bar terakhir identik antara jendela 221 bar (live) dan histori penuh (backtest).

## Entry (dievaluasi hanya di candle tertutup)

BUY kalau posisi flat dan ketiga syarat ini terpenuhi: rezim aktif, close > HH150, dan close > SMA100.

Kalau gak BUY, alasan HOLD dicek dengan urutan ini: `DATA_GAP` -> `REGIME_DATA_MISSING` -> `INDICATOR_MISSING` -> `REGIME_OFF` -> `NO_BREAKOUT` -> `BELOW_TREND`.

Kalau ada beberapa BUY bersamaan, diurutkan dari kekuatan breakout terbesar (close/HH150 - 1). Kalau seri, nama pasangan diurutkan naik.

## Exit

Exit-nya cuma satu, yaitu trailing stop: SELL kalau close < close tertinggi sejak masuk - 5 x ATR20.

- Close tertinggi mulai dihitung dari candle pertama SESUDAH candle sinyal entry. Ini sama dengan UTS, yang mulai dari bar eksekusi.
- Gak ada take profit dan gak ada stop tetap.
- Kill switch dan daily loss TIDAK memaksa jual. Dua-duanya cuma memblok entry baru.

## Sizing dan batas portofolio

- notional = min(18% ekuitas, kas - 10% ekuitas sebagai cadangan, 5% x Turnover20).
- Maksimal 5 posisi, satu posisi per pasangan.
- Notional di bawah minimum order Indodax (Rp10.000) ditolak dengan alasan `BELOW_MIN_NOTIONAL`.
- Kuantitas dibulatkan ke bawah ke `quantity_increment`.

## Perubahan dari UTS

| Aspek | UTS | UAS |
|---|---|---|
| Pasar | 100 saham KOMPAS100 | 5 crypto IDR Indodax |
| Bar | harian | 4 jam |
| Rezim | IHSG > SMA200 | BTC/IDR > SMA200 |
| Slot | 10 x 10% | 5 x 18% + cadangan kas 10% |
| Likuiditas | ADV20 >= Rp5 M, maks 5% ADV | maks 5% Turnover20 |
| Lot/ARA/ARB | lot 100, fraksi BEI | quantity_increment, price_increments Indodax |
| Eksekusi | open besok + 1 fraksi spread | live: jalan order book; backtest: open bar berikutnya + biaya terukur |
