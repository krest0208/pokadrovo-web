@echo off
setlocal
cd /d "%~dp0"
echo ======================================
echo Pokadrovo WEB - local video editor
echo ======================================
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js not found.
  echo Install Node.js LTS from https://nodejs.org/
  pause
  exit /b 1
)
where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found. Reinstall Node.js LTS.
  pause
  exit /b 1
)
if not exist "node_modules\vite" (
  echo Installing project dependencies...
  call npm install
  if errorlevel 1 goto :failed
)
echo.
echo Local editor: http://localhost:5173
echo Keep this window open. Ctrl+C stops the site.
start "" "http://localhost:5173"
call npm run dev
if errorlevel 1 goto :failed
exit /b 0
:failed
echo.
echo Startup failed. Copy the error text to report the problem.
pause
exit /b 1
