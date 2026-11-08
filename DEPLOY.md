# Deploy langkah demi langkah

Semua langkah ini butuh akun lo sendiri (GitHub, Vercel, Neon). Agent gak bikin akun dan gak masukin password.

## 1. Commit freeze + push ke GitHub publik

1. Buka https://github.com/new. Buat repo **Public**, misalnya `indodax-dry-run`, tanpa README, tanpa .gitignore, tanpa license.
2. Klik dua kali `1-FREEZE-DAN-PUSH.bat`, lalu tempel URL repo-nya (contoh `https://github.com/FreezyleAlva/indodax-dry-run.git`).
3. Skrip ini akan:
   - membuat repo git,
   - membuat satu commit freeze dengan jam asli,
   - mencetak hash commit,
   - lalu push ke branch `main`.
4. Sesudah itu jangan pernah force-push.

## 2. Vercel + Neon

1. https://vercel.com/new: import repo tadi. Framework: Next.js. Root directory: `.`.
2. Sebelum deploy, buka tab Storage, lalu Create Database, pilih **Neon** (Postgres), dan hubungkan ke project. Ini otomatis mengisi `DATABASE_URL`.
3. Buka Settings, lalu Environment Variables:
   - `CRON_SECRET` = string acak minimal 32 karakter. Bikinnya di PowerShell:
     ```powershell
     [guid]::NewGuid().ToString("N") + [guid]::NewGuid().ToString("N")
     ```
   - `BOT_ENV` = `production`
4. Klik Deploy. Kalau sudah jadi, buka `https://<app>.vercel.app/api/health`. Hasil yang benar: `{"ok":true,...}`.
5. Uji koneksi ke Indodax dengan satu tick manual:
   ```powershell
   curl.exe -X POST https://<app>.vercel.app/api/tick -H "Authorization: Bearer <CRON_SECRET>" -H "Content-Type: application/json" --data "{\"source\":\"manual-deploy-check\"}"
   ```
   Hasil yang benar: `"status":"OK"` dan `processed` berisi 5.

## 3. Scheduler GitHub Actions

1. Buka repo GitHub, lalu Settings, Secrets and variables, Actions, New repository secret.
   - `BOT_TICK_URL` = `https://<app>.vercel.app/api/tick`
   - `CRON_SECRET` = sama persis dengan yang di Vercel
2. Buka tab Actions, pilih `scheduled-dry-run`, klik Run workflow (sekali, buat tes). Hasil yang benar: `attempt 1 http 200`.
3. Mulai dari situ workflow jalan otomatis tiap jam di menit 7. Vercel Cron harian di `vercel.json` jadi cadangan.

## 4. Kill switch (kalau perlu)

Buka Neon, lalu SQL Editor:

```sql
UPDATE bot_state SET kill_switch = true, kill_switch_reason = 'alasan', updated_at = now() WHERE id = 1;
```

## 5. Sesudah 14 Nov 2026 12.00 WIB

1. Matikan workflow: buka Actions, pilih `scheduled-dry-run`, lalu Disable workflow.
2. Salin `DATABASE_URL` dari Neon (Connection string).
3. Klik dua kali `3-EKSPOR-PENGUMPULAN.bat`, lalu tempel `DATABASE_URL`.
4. Isi `docs/reflection.md` dengan angka dari `submission/data/report.json` (jangan diketik ulang dari ingatan).
