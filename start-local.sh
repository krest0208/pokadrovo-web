#!/usr/bin/env bash
set -e
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Install Node.js LTS from https://nodejs.org/"
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "npm not found. Reinstall Node.js LTS."
  exit 1
fi
if [ ! -d node_modules/vite ]; then
  echo "Installing dependencies..."
  npm install
fi
echo "Pokadrovo WEB: http://localhost:5173"
echo "Keep this terminal open. Press Ctrl+C to stop."
exec npm run dev
