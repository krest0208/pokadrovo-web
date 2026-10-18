#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22.16+ (24 LTS recommended): https://nodejs.org/"
  exit 1
fi
exec node tools/start-standalone.mjs
