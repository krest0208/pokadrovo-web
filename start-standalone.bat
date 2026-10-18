@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.16+ ^(24 LTS recommended^): https://nodejs.org/
  pause
  exit /b 1
)
node tools/start-standalone.mjs
if errorlevel 1 (
  echo.
  echo Startup failed. Read the message above.
  pause
  exit /b 1
)
