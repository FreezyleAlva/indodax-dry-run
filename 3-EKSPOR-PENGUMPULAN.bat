@echo off
setlocal
cd /d "%~dp0"
echo Tempel connection string Neon (dipakai di jendela ini saja, tidak disimpan ke file).
set /p DATABASE_URL=DATABASE_URL:
if "%DATABASE_URL%"=="" (echo Kosong. Batal. & pause & exit /b 1)
for /f %%i in ('git rev-list --max-parents=0 HEAD 2^>nul') do set FREEZE_COMMIT_SHA=%%i
echo [1/4] Ekspor log mentah + dashboard offline...
call npm run export || (pause & exit /b 1)
echo [2/4] Hitung ulang dari log mentah...
call npm run hitung_ulang || (echo HITUNG ULANG GAGAL. Jangan kumpulkan sebelum diselidiki. & pause & exit /b 1)
echo [3/4] Paritas sinyal...
call npm run parity || (pause & exit /b 1)
set DATABASE_URL=
echo [4/4] Membuat ZIP (source + .git utuh + submission + docs, tanpa node_modules / .env / DB lokal)...
set STAGE=%TEMP%\uas-indodax-stage
if exist "%STAGE%" rmdir /s /q "%STAGE%"
robocopy . "%STAGE%" /E /XD node_modules .next .data .vercel /XF *.zip .env .env.local .env.development.local .env.production.local *.log tsconfig.tsbuildinfo >nul
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set STAMP=%%d
powershell -NoProfile -Command "Compress-Archive -Path '%STAGE%\*' -DestinationPath '%~dp0UAS_Indodax_DryRun_%STAMP%.zip' -Force"
rmdir /s /q "%STAGE%"
echo ZIP: %~dp0UAS_Indodax_DryRun_%STAMP%.zip
pause
