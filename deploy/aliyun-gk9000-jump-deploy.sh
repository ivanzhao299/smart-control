#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

gk9000_host="${GK9000_HOST:-10.66.66.3}"
gk9000_user="${GK9000_USER:-user}"
gk9000_key="${GK9000_KEY:-/root/.ssh/anksen-gk9000-deploy}"

read -r action commit_sha unexpected <<< "${SSH_ORIGINAL_COMMAND:-}"

if [[ "$action" != "gk9000-deploy" && "$action" != "gk9000-verify" ]]; then
  printf 'Rejected: unsupported GK9000 action.\n' >&2
  exit 64
fi
if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ || -n "${unexpected:-}" ]]; then
  printf 'Rejected: expected one full commit SHA.\n' >&2
  exit 64
fi

exec ssh \
  -i "$gk9000_key" \
  -o BatchMode=yes \
  -o IdentitiesOnly=yes \
  -o StrictHostKeyChecking=yes \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=4 \
  "$gk9000_user@$gk9000_host" \
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\ProgramData\\Anksen\\smart-control-ci-dispatch.ps1 -Action $action -Commit $commit_sha"
