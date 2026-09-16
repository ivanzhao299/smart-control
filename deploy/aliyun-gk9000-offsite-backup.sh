#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

commit_sha="${1:-}"
if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ || $# -ne 1 ]]; then
  printf 'Rejected: expected one full commit SHA.\n' >&2
  exit 64
fi

gk9000_host="${GK9000_HOST:-10.66.66.3}"
gk9000_user="${GK9000_USER:-user}"
gk9000_key="${GK9000_KEY:-/root/.ssh/anksen-gk9000-deploy}"
offsite_root="${SMART_CONTROL_OFFSITE_ROOT:-/var/backups/smart-control}"
backup_tool="${SMART_CONTROL_OFFSITE_TOOL:-/usr/local/sbin/smart-control-offsite-release-backup.py}"
source_root='D:/smart-control-backups/migration-recovery'

if [[ ! -f "$gk9000_key" || ! -f "$backup_tool" ]]; then
  printf 'OFFSITE_BUNDLE_FAILED: required identity or verifier is missing.\n' >&2
  exit 1
fi

read -r -d '' ps_script <<'PS' || true
$ErrorActionPreference='Stop'
$expected='__COMMIT__'
$root='D:\smart-control-backups\migration-recovery'
$match=Get-ChildItem -LiteralPath $root -Directory | Sort-Object LastWriteTime -Descending | ForEach-Object {
  $receipt=Join-Path $_.FullName 'migration-complete.json'
  $release=Join-Path $_.FullName 'release.json'
  if((Test-Path -LiteralPath $receipt -PathType Leaf) -and (Test-Path -LiteralPath $release -PathType Leaf)) {
    try {
      $document=Get-Content -LiteralPath $receipt -Raw | ConvertFrom-Json
      if([string]$document.candidateRevision -eq $expected) { $_.Name }
    } catch {}
  }
} | Select-Object -First 1
if($match){Write-Output $match}
PS
ps_script="${ps_script/__COMMIT__/$commit_sha}"
encoded_command="$(printf '%s' "$ps_script" | iconv -f UTF-8 -t UTF-16LE | base64 | tr -d '\n')"

bundle_name="$(ssh \
  -i "$gk9000_key" \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=4 \
  "$gk9000_user@$gk9000_host" \
  "powershell.exe -NoProfile -NonInteractive -EncodedCommand $encoded_command" \
  | tr -d '\r' | sed -n '/^release-[A-Za-z0-9_-]\+$/p' | tail -n 1)"

if [[ -z "$bundle_name" ]]; then
  printf 'OFFSITE_BUNDLE_NOT_REQUIRED %s\n' "$commit_sha"
  exit 0
fi
if [[ ! "$bundle_name" =~ ^release-[A-Za-z0-9_-]+$ ]]; then
  printf 'OFFSITE_BUNDLE_FAILED: invalid discovered bundle name.\n' >&2
  exit 1
fi

exec python3 "$backup_tool" \
  --source "$gk9000_user@$gk9000_host" \
  --source-path "$source_root/$bundle_name" \
  --identity "$gk9000_key" \
  --bundle-name "$bundle_name" \
  --destination "$offsite_root"
