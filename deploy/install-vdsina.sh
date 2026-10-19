#!/usr/bin/env bash
# First installation of the unified application on its dedicated VDSina VPS.
set -Eeuo pipefail
umask 022

pokadrovo_domain=pokadrovo.ru
pokadrovo_address=138.16.185.3
pokadrovo_source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
pokadrovo_app_dir=/opt/pokadrovo/app

[[ $(id -u) == 0 ]] || { echo 'Run this installer as root.' >&2; exit 1; }
ip -4 -o address show | awk '{print $4}' | cut -d/ -f1 | \
  grep -Fxq "$pokadrovo_address" || {
    echo "This installer is restricted to the Pokadrovo VPS ($pokadrovo_address)." >&2
    exit 1
  }
[[ -f /etc/os-release ]] || { echo 'Ubuntu is required.' >&2; exit 1; }
. /etc/os-release
[[ ${ID:-} == ubuntu ]] || { echo 'Ubuntu is required.' >&2; exit 1; }
[[ ! -e "$pokadrovo_app_dir" && ! -e /etc/systemd/system/pokadrovo.service ]] || {
  echo 'An existing installation was found. Back it up and use an update procedure.' >&2
  exit 1
}
for pokadrovo_input in package.json package-lock.json src/Studio.tsx server/app.mjs; do
  [[ -f "$pokadrovo_source_dir/$pokadrovo_input" ]] || {
    echo "Missing source: $pokadrovo_input" >&2; exit 1;
  }
done

# Never overwrite another site's Caddy configuration. Only its unmodified
# distribution default is accepted on this first-install path.
if [[ -f /etc/caddy/Caddyfile ]]; then
  pokadrovo_default_hash="$(dpkg-query -W -f='${Conffiles}\n' caddy 2>/dev/null | awk '$1 == "/etc/caddy/Caddyfile" {print $2}')"
  pokadrovo_current_hash="$(md5sum /etc/caddy/Caddyfile | cut -d' ' -f1)"
  [[ -n "$pokadrovo_default_hash" && "$pokadrovo_default_hash" == "$pokadrovo_current_hash" ]] || {
    echo 'A customised Caddy configuration exists; it has not been changed.' >&2
    exit 1
  }
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends nodejs npm caddy ca-certificates curl tar dnsutils
node --input-type=module -e '
  import { DatabaseSync } from "node:sqlite";
  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 22 || (major === 22 && minor < 16)) throw Error("Node.js 22.16 or newer is required");
  const database = new DatabaseSync(":memory:"); database.close();
'

install -d -m 0755 /opt/pokadrovo "$pokadrovo_app_dir"
tar -C "$pokadrovo_source_dir" -cf - \
  package.json package-lock.json index.html tsconfig.json vite.config.ts src public server | \
  tar -C "$pokadrovo_app_dir" -xf -
cd "$pokadrovo_app_dir"
npm ci --no-audit --no-fund
# Recheck the server on the VPS's Node.js without parallel scrypt workloads.
node --test --test-concurrency=1 server/tests/*.test.mjs
# Build sequentially within the 1 GB VPS.
NODE_OPTIONS=--max-old-space-size=512 npm exec -- tsc --noEmit
NODE_OPTIONS=--max-old-space-size=512 npm exec -- vite build

if id pokadrovo >/dev/null 2>&1; then
  [[ $(id -u pokadrovo) -lt 1000 && $(getent passwd pokadrovo | cut -d: -f6) == /var/lib/pokadrovo ]] || {
    echo 'An unrelated account named pokadrovo exists; no permissions were changed.' >&2
    exit 1
  }
else
  useradd --system --user-group --home-dir /var/lib/pokadrovo --shell /usr/sbin/nologin pokadrovo
fi
install -d -o pokadrovo -g pokadrovo -m 0700 /var/lib/pokadrovo

cat > /etc/systemd/system/pokadrovo.service <<'UNIT'
[Unit]
Description=Pokadrovo website and owner API
After=network.target

[Service]
Type=simple
User=pokadrovo
Group=pokadrovo
WorkingDirectory=/opt/pokadrovo/app
Environment=NODE_ENV=production
Environment=POKADROVO_PUBLIC_ORIGIN=https://pokadrovo.ru
Environment=POKADROVO_HOST=127.0.0.1
Environment=POKADROVO_PORT=5173
Environment=POKADROVO_DATA_DIR=/var/lib/pokadrovo
Environment=POKADROVO_ACCOUNTS_ENABLED=1
Environment=POKADROVO_GUEST_EDITING=1
Environment=POKADROVO_SOCIAL_LOGIN_ENABLED=0
Environment=POKADROVO_TRUST_LOOPBACK_PROXY=1
ExecStart=/usr/bin/node /opt/pokadrovo/app/server/app.mjs
Restart=on-failure
RestartSec=3
TimeoutStopSec=20
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
PrivateDevices=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/pokadrovo
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
MemoryMax=640M
TasksMax=128

[Install]
WantedBy=multi-user.target
UNIT

cp -p /etc/caddy/Caddyfile /opt/pokadrovo/Caddyfile.before-install
cat > /etc/caddy/Caddyfile <<'CADDY'
pokadrovo.ru {
    encode zstd gzip
    reverse_proxy 127.0.0.1:5173
}
CADDY
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
systemctl daemon-reload
systemctl enable --now pokadrovo.service
for pokadrovo_attempt in {1..20}; do
  if curl --fail --silent --max-time 2 -H "Host: $pokadrovo_domain" \
    http://127.0.0.1:5173/api/health; then
    break
  fi
  [[ $pokadrovo_attempt -lt 20 ]] || { journalctl -u pokadrovo -n 30 --no-pager; exit 1; }
  sleep 1
done
systemctl enable caddy.service
systemctl restart caddy.service

echo
echo "Application installed for https://$pokadrovo_domain on $pokadrovo_address."
echo 'DNS must point to this server before HTTPS can become available.'
echo 'Owner access is not provisioned by this installer; no default password exists.'
echo 'First owner setup (interactive, run as root):'
echo 'runuser -u pokadrovo -- env POKADROVO_DATA_DIR=/var/lib/pokadrovo node /opt/pokadrovo/app/server/setup.mjs'
echo 'To generate a random initial password in your private terminal, append --generate.'
echo 'After signing in, use the Change password button (Сменить пароль).'
echo 'Back up all of /var/lib/pokadrovo, including its database and master.key.'
