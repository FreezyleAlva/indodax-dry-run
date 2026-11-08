# Change log

Format tiap entri sesudah freeze:

| Tanggal (WIB) | Insiden | Akar masalah | File | Commit | Deploy | Bukti sinyal tidak berubah |
|---|---|---|---|---|---|---|

## Sebelum freeze (9 Nov 2026)

- Implementasi awal: domain, indikator, strategi, simulator order book, guard, risiko, persistence, TickService, backtest, dashboard online/offline, hitung_ulang, paritas, 30 tes.
- Universe dipilih dari likuiditas 30 hari sebelum awal backtest (`research/manifests/universe.json`).
- Model biaya backtest dari 3 putaran snapshot order book 9 Nov 2026 (`research/manifests/cost-model.json`).
