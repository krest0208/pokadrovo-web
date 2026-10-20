#!/usr/bin/env bash
# One-time installation. It does not read or change the owner's sign-in credentials.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run once in the VPS root console.' >&2; exit 1; }
ip -4 -o address show | awk '{print $4}' | cut -d/ -f1 | grep -Fxq 138.16.185.3 || { echo 'Wrong VPS; stopped.' >&2; exit 1; }
[[ $(systemctl show -p User --value pokadrovo.service) == pokadrovo ]]
[[ $(systemctl show -p WorkingDirectory --value pokadrovo.service) == /opt/pokadrovo/app ]]
systemctl show -p Environment --value pokadrovo.service | grep -Fq 'POKADROVO_PUBLIC_ORIGIN=https://pokadrovo.ru'
systemctl show -p Environment --value pokadrovo.service | grep -Fq 'POKADROVO_DATA_DIR=/var/lib/pokadrovo'
systemctl show -p Environment --value pokadrovo.service | grep -Fq 'POKADROVO_HOST=127.0.0.1'
systemctl is-active --quiet pokadrovo.service
[[ -d /opt/pokadrovo/app && ! -L /opt/pokadrovo/app && -d /var/lib/pokadrovo && ! -L /var/lib/pokadrovo ]]
for pk_program in /usr/bin/node /usr/bin/npm /usr/bin/python3 /usr/bin/systemd-run /usr/bin/flock /usr/bin/tar /usr/bin/chown; do [[ -x "$pk_program" ]]; done
/usr/bin/node --input-type=module -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||a===22&&b<16)process.exit(1)'
pk_source="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
for pk_name in agent.mjs core.mjs worker.mjs unpack.py pokadrovo-autodeploy.service pokadrovo-autodeploy.timer; do [[ -f "$pk_source/$pk_name" && ! -L "$pk_source/$pk_name" ]]; done
if id pokadrovo-build >/dev/null 2>&1; then
  [[ $(id -u pokadrovo-build) -gt 0 && $(id -u pokadrovo-build) -lt 1000 ]]
  [[ $(getent passwd pokadrovo-build | cut -d: -f6) == /var/lib/pokadrovo-build ]]
  [[ $(getent passwd pokadrovo-build | cut -d: -f7) == /usr/sbin/nologin ]]
  [[ $(id -Gn pokadrovo-build) == pokadrovo-build ]]
else
  useradd --system --user-group --home-dir /var/lib/pokadrovo-build --create-home --shell /usr/sbin/nologin pokadrovo-build
fi
[[ $(id -u pokadrovo-build) != $(id -u pokadrovo) ]]
[[ $(id -g pokadrovo-build) != $(id -g pokadrovo) ]]
for pk_path in /etc/systemd/system/pokadrovo-autodeploy.service /etc/systemd/system/pokadrovo-autodeploy.timer /usr/local/lib/pokadrovo-deploy /var/lib/pokadrovo-deploy /opt/pokadrovo/deploy-work /opt/pokadrovo/backups; do [[ ! -L "$pk_path" ]]; done
install -d -o root -g root -m 0755 /usr/local/lib/pokadrovo-deploy /opt/pokadrovo/deploy-work
install -d -o root -g root -m 0700 /var/lib/pokadrovo-deploy /opt/pokadrovo/backups
# A reinstall may replace the fixed control code only after the active deployment finishes.
if systemctl is-active --quiet pokadrovo-autodeploy.service; then echo 'A deployment is running. Retry after it finishes.' >&2; exit 1; fi
systemctl stop pokadrovo-autodeploy.timer 2>/dev/null || true
exec 9>/var/lib/pokadrovo-deploy/agent.lock
flock --nonblock 9 || { echo 'Deployment is busy; retry after it finishes.' >&2; exit 1; }
for pk_name in agent.mjs core.mjs worker.mjs unpack.py; do install -o root -g root -m 0644 "$pk_source/$pk_name" "/usr/local/lib/pokadrovo-deploy/$pk_name"; done
for pk_name in pokadrovo-autodeploy.service pokadrovo-autodeploy.timer; do install -o root -g root -m 0644 "$pk_source/$pk_name" "/etc/systemd/system/$pk_name"; done
systemd-analyze --generators=no --man=no verify /etc/systemd/system/pokadrovo-autodeploy.service /etc/systemd/system/pokadrovo-autodeploy.timer
systemctl daemon-reload
flock --unlock 9
systemctl enable --now pokadrovo-autodeploy.timer
systemctl start --no-block pokadrovo-autodeploy.service
systemctl is-enabled --quiet pokadrovo-autodeploy.timer
systemctl is-active --quiet pokadrovo-autodeploy.timer
echo 'Pokadrovo automatic deployment timer is enabled.'
echo 'It checks main after GitHub CI, builds separately, and updates only pokadrovo.ru.'
echo 'Status: systemctl status pokadrovo-autodeploy.timer'
echo 'Log: journalctl -u pokadrovo-autodeploy.service -n 30 --no-pager'
echo 'Pause: systemctl disable --now pokadrovo-autodeploy.timer'
