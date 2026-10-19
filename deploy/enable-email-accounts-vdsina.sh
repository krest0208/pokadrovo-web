#!/usr/bin/env bash
# Update the dedicated existing installation without replacing its private store.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run as root.' >&2; exit 1; }
ip -4 -o address show | awk '{print $4}' | cut -d/ -f1 | grep -Fxq 138.16.185.3 || {
  echo 'This updater is restricted to the Pokadrovo VPS.' >&2; exit 1;
}
pk_source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
pk_app=/opt/pokadrovo/app
pk_private=/var/lib/pokadrovo
pk_drop=/etc/systemd/system/pokadrovo.service.d/email-accounts.conf
[[ "$pk_source" != "$pk_app" && -f "$pk_app/dist/index.html" && -d "$pk_private" && ! -L "$pk_private" && ! -L "$pk_app/dist" && ! -L "$pk_drop" ]] || exit 1
[[ $(systemctl show -p User --value pokadrovo.service) == pokadrovo ]]
[[ $(systemctl show -p WorkingDirectory --value pokadrovo.service) == "$pk_app" ]]
systemctl show -p Environment --value pokadrovo.service | grep -Fq 'POKADROVO_DATA_DIR=/var/lib/pokadrovo'
systemctl show -p Environment --value pokadrovo.service | grep -Fq 'POKADROVO_PUBLIC_ORIGIN=https://pokadrovo.ru'
systemctl show -p Environment --value pokadrovo.service | grep -Fq 'POKADROVO_HOST=127.0.0.1'
systemctl is-active --quiet pokadrovo.service
pk_files=(shared/coin-pricing.json src/HomeShowcase.tsx src/PlatformIcon.tsx src/assets.d.ts src/home/redesign.css src/home/assets/coastal-story.webp src/ai-home.css src/HomeFormats.tsx src/home-formats.css tsconfig.json server/setup.mjs server/accounts.mjs server/app.mjs server/ai.mjs server/yandex.mjs server/standalone.mjs server/public/admin.html server/public/admin.js src/Studio.tsx src/account/api.ts src/account/AccountViews.tsx src/AiHome.tsx src/BrandMark.tsx src/brand.ts src/brand.css src/layered-copy.ts src/editor/editor.ts src/editor/ai.ts src/editor/ai-panel.ts src/editor/omni.ts src/editor/editor.css public/favicon.svg public/pokadrovo-logo.svg public/pokadrovo-animated.svg)
pk_existing=()
pk_new=()
for pk_file in "${pk_files[@]}"; do
  [[ -f "$pk_source/$pk_file" && ! -L "$pk_app/$pk_file" ]] || exit 1
  if [[ -f "$pk_app/$pk_file" ]]; then pk_existing+=("$pk_file");
  elif [[ "$pk_file" == shared/coin-pricing.json || "$pk_file" == src/HomeShowcase.tsx || "$pk_file" == src/PlatformIcon.tsx || "$pk_file" == src/assets.d.ts || "$pk_file" == src/home/redesign.css || "$pk_file" == src/home/assets/coastal-story.webp || "$pk_file" == server/ai.mjs || "$pk_file" == server/yandex.mjs || "$pk_file" == src/editor/omni.ts || "$pk_file" == src/brand.ts || "$pk_file" == src/brand.css || "$pk_file" == public/pokadrovo-animated.svg ]]; then pk_new+=("$pk_file");
  else exit 1; fi
done
cd "$pk_source"
npm ci --no-audit --no-fund
install -d -m 0700 .deploy-test-tmp
TMPDIR="$pk_source/.deploy-test-tmp" NODE_OPTIONS=--max-old-space-size=384 node --test --test-concurrency=1 server/tests/*.test.mjs tests/guest-storage.test.mjs tests/admin-navigation.test.mjs
NODE_OPTIONS=--max-old-space-size=512 npm exec -- tsc --noEmit
NODE_OPTIONS=--max-old-space-size=512 npm exec -- vite build
install -d -m 0700 /opt/pokadrovo/backups
pk_backup="$(mktemp -d /opt/pokadrovo/backups/email-accounts-before-XXXXXXXX)"
tar -C "$pk_app" -czf "$pk_backup/code.tar.gz" dist "${pk_existing[@]}"
if [[ -f "$pk_drop" ]]; then cp -a "$pk_drop" "$pk_backup/email-accounts.conf"; fi
pk_rollback() {
  trap - ERR
  echo "Update failed; restoring code and service settings from $pk_backup" >&2
  systemctl stop pokadrovo.service || true
  tar -C "$pk_app" -xzf "$pk_backup/code.tar.gz"
  for pk_file in "${pk_new[@]}"; do rm -f -- "$pk_app/$pk_file"; done
  if [[ -f "$pk_backup/email-accounts.conf" ]]; then install -m 0644 "$pk_backup/email-accounts.conf" "$pk_drop"; else rm -f "$pk_drop"; fi
  systemctl daemon-reload
  systemctl start pokadrovo.service
  # Never roll back the database automatically: this could erase new registrations.
  exit 1
}
trap pk_rollback ERR
systemctl stop pokadrovo.service
# Consistent root-only disaster-recovery copy, including the database and key.
tar -C /var/lib -czf "$pk_backup/private.tar.gz" pokadrovo
for pk_file in "${pk_files[@]}"; do install -d -m 0755 "$(dirname "$pk_app/$pk_file")"; install -m 0644 "$pk_file" "$pk_app/$pk_file"; done
# Keep prior hashed assets for browser tabs that are already open.
cp -a dist/assets/. "$pk_app/dist/assets/"
install -m 0644 dist/favicon.svg "$pk_app/dist/favicon.svg"
install -m 0644 dist/pokadrovo-logo.svg "$pk_app/dist/pokadrovo-logo.svg"
install -m 0644 dist/pokadrovo-animated.svg "$pk_app/dist/pokadrovo-animated.svg"
find "$pk_app/dist/assets" -type d -exec chmod 0755 {} +
find "$pk_app/dist/assets" -type f -exec chmod 0644 {} +
install -m 0644 dist/index.html "$pk_app/dist/.email-index-next"
mv -f "$pk_app/dist/.email-index-next" "$pk_app/dist/index.html"
install -d -m 0755 "$(dirname "$pk_drop")"
cat > "$pk_drop" <<'CONFIG'
[Service]
Environment=POKADROVO_ACCOUNTS_ENABLED=1
Environment=POKADROVO_GUEST_EDITING=1
Environment=POKADROVO_SOCIAL_LOGIN_ENABLED=0
Environment=POKADROVO_TRUST_LOOPBACK_PROXY=1
CONFIG
chmod 0644 "$pk_drop"
systemctl daemon-reload
systemctl start pokadrovo.service
pk_ready=0
for pk_attempt in {1..15}; do
  if curl --fail --silent --max-time 2 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/api/health > "$pk_backup/health.json"; then pk_ready=1; break; fi
  sleep 1
done
[[ "$pk_ready" == 1 ]]
curl --fail --silent --max-time 5 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/api/account/session | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;const a=JSON.parse(s);if(!a.accountsEnabled||!a.guestEditingEnabled||a.socialLoginEnabled||a.providers.length||a.user)process.exit(1);console.log("Email registration enabled; social sign-in disabled; guest editing available.");'
[[ $(curl --silent -o /dev/null -w '%{http_code}' --max-time 5 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/studio) == 200 ]]
[[ $(curl --silent -o /dev/null -w '%{http_code}' --max-time 5 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/api/account/projects) == 401 ]]
curl --fail --silent --max-time 5 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/api/ai/status | node --input-type=module -e 'let s="";for await(const c of process.stdin)s+=c;const a=JSON.parse(s);if(a.available||!a.freeTrialRequiresAccount||a.limits.maxDuration!==60||a.modes.some(m=>m.available)||a.billing.unit!=="coin"||a.billing.rubPerCoin!==null||a.billing.paymentsEnabled)process.exit(1);console.log("Qwen trial and Yandex prepared; guests cannot start model calls.");'
[[ $(curl --silent -o /dev/null -w '%{http_code}' --max-time 5 -X POST -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/api/account/oauth/google) == 404 ]]
curl --fail --silent --max-time 5 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/ | cmp - dist/index.html
curl --fail --silent --max-time 5 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/favicon.svg | cmp - dist/favicon.svg
curl --fail --silent --max-time 5 -H 'Host: pokadrovo.ru' http://127.0.0.1:5173/pokadrovo-logo.svg | cmp - dist/pokadrovo-logo.svg
trap - ERR
echo "Update complete. Private backup directory: $pk_backup"
echo 'Verify https://pokadrovo.ru/ in a browser. No DNS or owner credentials were changed.'
