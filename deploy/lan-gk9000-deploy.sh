#!/usr/bin/env bash

set -Eeuo pipefail

host="${GK9000_LAN_HOST:-192.168.77.54}"
user="${GK9000_LAN_USER:-user}"
identity="${GK9000_LAN_IDENTITY:-}"
commit=""
verify_only=0

usage() {
  cat <<'EOF'
Usage: deploy/lan-gk9000-deploy.sh [options]

Deploy the current (or requested) origin/main commit directly to a GK9000 on
the same LAN. The remote deployment keeps the existing lock, backup, build,
restart, rollback, and verification contract.

Options:
  --verify-only       Run the remote production verification without deploying
  --commit SHA        Deploy or verify this full 40-character commit SHA
  --host HOST         GK9000 LAN address (default: 192.168.77.54)
  --user USER         SSH user (default: user)
  --identity PATH     SSH private key; otherwise SSH may prompt for a password
  -h, --help          Show this help

Environment equivalents:
  GK9000_LAN_HOST, GK9000_LAN_USER, GK9000_LAN_IDENTITY
EOF
}

while (($#)); do
  case "$1" in
    --verify-only)
      verify_only=1
      shift
      ;;
    --commit|--host|--user|--identity)
      if (($# < 2)); then
        printf 'Missing value for %s\n' "$1" >&2
        exit 64
      fi
      case "$1" in
        --commit) commit="$2" ;;
        --host) host="$2" ;;
        --user) user="$2" ;;
        --identity) identity="$2" ;;
      esac
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 64
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
  printf 'Run this command from inside the smart-control Git repository.\n' >&2
  exit 1
}
cd "$repo_root"

if [[ -z "$commit" ]]; then
  commit="$(git rev-parse HEAD)"
fi
if [[ ! "$commit" =~ ^[0-9a-f]{40}$ ]]; then
  printf 'Commit must be one full 40-character lowercase SHA: %s\n' "$commit" >&2
  exit 64
fi
git cat-file -e "${commit}^{commit}"

if ! git merge-base --is-ancestor "$commit" origin/main; then
  printf 'Refusing: commit %s is not present in the local origin/main view.\n' "$commit" >&2
  printf 'Push it to origin/main (or refresh the remote refs) before deploying.\n' >&2
  exit 1
fi

action='gk9000-deploy'
if ((verify_only)); then
  action='gk9000-verify'
fi

ssh_args=(
  -o ConnectTimeout=8
  -o ServerAliveInterval=15
  -o ServerAliveCountMax=4
  -o StrictHostKeyChecking=yes
)
if [[ -n "$identity" ]]; then
  if [[ ! -f "$identity" ]]; then
    printf 'SSH identity does not exist: %s\n' "$identity" >&2
    exit 1
  fi
  ssh_args+=( -o IdentitiesOnly=yes -i "$identity" )
fi

printf 'Route: this Mac -> %s@%s -> GK9000 dispatcher\n' "$user" "$host"
printf 'Action: %s %s\n' "$action" "$commit"

ssh "${ssh_args[@]}" "$user@$host" \
  "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\ProgramData\\Anksen\\smart-control-ci-dispatch.ps1 -Action $action -Commit $commit"

if ((!verify_only)); then
  printf '\nDeployment returned successfully; running an independent verification...\n'
  ssh "${ssh_args[@]}" "$user@$host" \
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -File C:\\ProgramData\\Anksen\\smart-control-ci-dispatch.ps1 -Action gk9000-verify -Commit $commit"
fi

printf '\nLAN %s completed successfully for %s.\n' "$action" "$commit"
