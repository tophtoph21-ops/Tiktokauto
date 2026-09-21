@echo off
cd /d %~dp0
where node >nul 2>nul || (echo Node.js 22+ est requis. Alternative: docker compose up --build & pause & exit /b 1)
where ffmpeg >nul 2>nul || (echo FFmpeg est requis. Alternative: docker compose up --build & pause & exit /b 1)
node --experimental-sqlite server.mjs
pause
