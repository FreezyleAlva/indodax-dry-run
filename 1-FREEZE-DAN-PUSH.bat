@echo off
setlocal
cd /d "%~dp0"
where git >nul 2>&1 || (echo git tidak ditemukan. & pause & exit /b 1)
where npm >nul 2>&1 || (echo npm tidak ditemukan. & pause & exit /b 1)
if exist ".git" (
  echo Repo git sudah ada. Commit freeze TIDAK dibuat ulang. Riwayat:
  git log --format="%%H %%ad %%s" --date=iso-strict -n 5
  pause
  exit /b 0
)
echo [1/5] Pasang dependensi dan jalankan tes...
call npm install --no-audit --no-fund || (echo npm install gagal. & pause & exit /b 1)
call npm test || (echo Tes gagal. Freeze dibatalkan. & pause & exit /b 1)
echo [2/5] Membuat repo git...
git init -b main || (pause & exit /b 1)
git add -A
git diff --cached --name-only | findstr /r /i "^\.env$ ^\.env\.local$ \.data/" >nul && (echo File rahasia ikut ter-stage. Batal. & pause & exit /b 1)
echo [3/5] Commit freeze dengan waktu asli...
git commit -m "freeze: strategi uas-1.0.0 (breakout 150 / SMA100 / trail 5xATR20 / rezim BTC SMA200), universe btc eth xrp doge sol, timeframe 4 jam" || (pause & exit /b 1)
git log --format="%%H %%ad %%s" --date=iso-strict -n 1 > FREEZE-COMMIT.txt
type FREEZE-COMMIT.txt
echo [4/5] Repo GitHub publik harus sudah dibuat kosong di https://github.com/new
set /p REPO=Tempel URL repo (contoh https://github.com/USER/indodax-dry-run.git):
if "%REPO%"=="" (echo URL kosong. Commit sudah ada, push belum. Jalankan: git remote add origin URL lalu git push -u origin main & pause & exit /b 1)
git remote add origin %REPO%
echo [5/5] Push...
git push -u origin main || (echo Push gagal. Cek URL dan login Git Credential Manager, lalu ulangi: git push -u origin main & pause & exit /b 1)
echo Selesai. Jangan pernah force-push. Hash freeze ada di FREEZE-COMMIT.txt
pause
