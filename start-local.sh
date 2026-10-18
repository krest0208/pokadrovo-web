#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22.16 or newer from https://nodejs.org/"
  exit 1
fi
node -e "const [a,b]=process.versions.node.split('.').map(Number);if(a<22||(a===22&&b<16)){console.error('Node.js 22.16 or newer is required');process.exit(1)}"
if [ ! -f dist/index.html ]; then
  echo "Building local website from source..."
  npm install --no-audit --no-fund
  npm run build
fi
printf '\nWebsite: http://localhost:5173\nAdmin: http://localhost:5173/krest0208!!!\nKeep this terminal open. Ctrl+C stops the server.\n\n'
exec node server/app.mjs
