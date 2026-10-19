#!/usr/bin/env bash
# Publish the public frontend from this source checkout on the dedicated VPS.
set -Eeuo pipefail
umask 022

[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
ip -4 -o address show | awk '{print $4}' | cut -d/ -f1 | grep -Fxq 138.16.185.3 || {
  echo 'This updater is restricted to the Pokadrovo VPS.' >&2; exit 1;
}
pk_source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
pk_app=/opt/pokadrovo/app
[[ "$pk_source" != "$pk_app" && -f "$pk_app/server/app.mjs" && -f "$pk_app/dist/index.html" && -d "$pk_app/dist/assets" && ! -L "$pk_app/dist" ]] || {
  echo 'A separate source checkout and the existing dedicated installation are required.' >&2; exit 1;
}
pk_files=(src/layered-copy.ts src/AiHome.tsx src/HomeFormats.tsx index.html)
for pk_file in "${pk_files[@]}"; do
  [[ -f "$pk_source/$pk_file" && -f "$pk_app/$pk_file" && ! -L "$pk_app/$pk_file" ]] || {
    echo "Missing or linked frontend input: $pk_file" >&2; exit 1;
  }
done
systemctl is-active --quiet pokadrovo.service
curl --fail --silent --max-time 5 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/api/health
cd "$pk_source"
npm ci --no-audit --no-fund
NODE_OPTIONS=--max-old-space-size=512 npm exec -- tsc --noEmit
NODE_OPTIONS=--max-old-space-size=512 npm exec -- vite build

# Back up public files only. Never copy or alter private data, server code,
# service configuration, Caddy, DNS or owner credentials.
install -d -m 0700 /opt/pokadrovo/backups
pk_backup="$(mktemp /opt/pokadrovo/backups/homepage-before-XXXXXXXX.tar.gz)"
tar -C "$pk_app" -czf "$pk_backup" dist "${pk_files[@]}"
pk_rollback() {
  trap - ERR
  echo "Frontend update failed; restoring $pk_backup" >&2
  tar -C "$pk_app" -xzf "$pk_backup"
  exit 1
}
trap pk_rollback ERR
# Keep earlier hashed assets available to already open browser tabs.
cp -a dist/assets/. "$pk_app/dist/assets/"
for pk_file in "${pk_files[@]}"; do
  install -m 0644 "$pk_file" "$pk_app/$pk_file"
done
install -m 0644 dist/index.html "$pk_app/dist/.homepage-index-next"
mv -f "$pk_app/dist/.homepage-index-next" "$pk_app/dist/index.html"
curl --fail --silent --max-time 5 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/ | cmp - dist/index.html
curl --fail --silent --max-time 5 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/api/health
trap - ERR
echo
echo "Public frontend updated. Backup: $pk_backup"
echo 'Verify the new homepage at https://pokadrovo.ru/.'
