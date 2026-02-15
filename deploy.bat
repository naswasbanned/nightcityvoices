@echo off
REM ── Night City Voices — Build & Deploy ──────────────────
REM Run this on your CasaOS server (or any Windows host)

echo [1/3] Building React client...
cd /d "%~dp0client"
call npm install
call npm run build

echo [2/3] Installing server dependencies...
cd /d "%~dp0server"
call npm install

echo [3/3] Starting production server...
set NODE_ENV=production
node src/index.js
