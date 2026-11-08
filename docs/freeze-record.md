# Catatan freeze

| Item | Isi |
|---|---|
| Jadwal freeze soal | Rabu 4 Nov 2026 12.00 WIB |
| Kondisi sebenarnya | Pada jadwal itu belum ada repositori, kode bot, maupun commit. Kode dibuat 9 Nov 2026. |
| Commit freeze | Dibuat lewat `1-FREEZE-DAN-PUSH.bat`. Hash dan waktunya dibaca dari `git log`, tidak ditulis tangan di sini. |
| Yang dibekukan | `src/strategy/config.ts` (strategi `uas-1.0.0`, universe, timeframe, parameter, sizing, risiko, fee), `src/strategy/evaluate.ts`, `src/strategy/portfolio.ts` |
| Hash konfigurasi | Dihitung `configHash()` dan tercatat di setiap baris `signals.config_hash` dan di `bot_config` |
| Kebijakan sesudah freeze | Hanya perbaikan bug non-strategi. Tiap perbaikan dicatat di `docs/change-log.md`: insiden, akar masalah, file, commit, waktu deploy, dan bukti bahwa sinyal untuk input yang sama tidak berubah (`npm test` + paritas). |

## Pernyataan

Commit freeze tidak dimundurkan dan riwayatnya tidak ditulis ulang. Keterlambatan dari jadwal soal dilaporkan ke dosen apa adanya.
Soal menyebut komponen kecocokan bisa dinilai 0 kalau riwayat commit tidak ada; keputusan atas keterlambatan ini ada di dosen.

Bukti yang bisa diperiksa:

```powershell
git log --format="%H %ad %s" --date=iso-strict
```
