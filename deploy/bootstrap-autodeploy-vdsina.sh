#!/usr/bin/env bash
# Fetch one owner-selected public release to install the fixed deployment agent.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run once in the VPS root console.' >&2; exit 1; }
pk_release="${1:-}"
[[ "$pk_release" =~ ^[0-9a-f]{40}$ ]] || { echo 'Pass the exact setup commit.' >&2; exit 1; }
ip -4 -o address show | awk '{print $4}' | cut -d/ -f1 | grep -Fxq 138.16.185.3 || { echo 'Wrong VPS; stopped.' >&2; exit 1; }
[[ -d /opt/pokadrovo/app && ! -L /opt/pokadrovo/app && -d /var/lib/pokadrovo ]]
pk_work="$(mktemp -d /opt/pokadrovo/agent-setup-XXXXXXXX)"
trap 'rm -rf -- "$pk_work"' EXIT
install -d -m 0700 "$pk_work/source"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-time 180 "https://codeload.github.com/krest0208/pokadrovo-web/tar.gz/$pk_release" -o "$pk_work/release.tar.gz"
tar -xzf "$pk_work/release.tar.gz" -C "$pk_work/source" --strip-components=1
bash "$pk_work/source/deploy/autodeploy/install-vdsina.sh"
