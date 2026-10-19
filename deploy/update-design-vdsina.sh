#!/usr/bin/env bash
# Run the pinned, already-installed Pokadrovo application's reviewed update.
set -Eeuo pipefail
umask 077
[[ $(id -u) == 0 ]] || { echo 'Run in the VPS root console.' >&2; exit 1; }
pk_release="${1:-}"
[[ "$pk_release" =~ ^[0-9a-f]{40}$ ]] || { echo 'Pass the exact release commit.' >&2; exit 1; }
ip -4 -o address show | awk '{print $4}' | cut -d/ -f1 | grep -Fxq 138.16.185.3 || { echo 'Wrong VPS; stopped.' >&2; exit 1; }
[[ -d /opt/pokadrovo/app && -d /var/lib/pokadrovo ]] || exit 1
pk_work="$(mktemp -d /opt/pokadrovo/design-release-XXXXXXXX)"
trap 'rm -rf -- "$pk_work"' EXIT
install -d -m 0700 "$pk_work/source"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --max-time 180 "https://api.github.com/repos/krest0208/pokadrovo-web/tarball/$pk_release" -o "$pk_work/release.tar.gz"
tar -xzf "$pk_work/release.tar.gz" -C "$pk_work/source" --strip-components=1
printf '%s  %s\n' 'c3528b1cc9aa39eef86790bc5342c4e45c8abfa7c7e50014c5eb90f5d6c257a6' "$pk_work/source/deploy/enable-email-accounts-vdsina.sh" | sha256sum --check --status
echo "Installing reviewed release $pk_release on pokadrovo.ru"
bash "$pk_work/source/deploy/enable-email-accounts-vdsina.sh"
echo "Updated pokadrovo.ru to $pk_release."
