@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 22.16 or newer from https://nodejs.org/
  pause
  exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<16)){console.error('Node.js 22.16 or newer is required');process.exit(1)}"
if errorlevel 1 goto :failed
if not exist "dist\index.html" (
  echo Building local website from source...
  call npm install --no-audit --no-fund
  if errorlevel 1 goto :failed
  call npm run build
  if errorlevel 1 goto :failed
)
echo.
echo Website: http://localhost:5173
echo Admin:   http://localhost:5173/admin
echo Keep this window open. Ctrl+C stops the server.
echo.
node server/app.mjs
if errorlevel 1 goto :failed
exit /b 0
:failed
echo Startup failed. Please review the error above.
pause
exit /b 1
