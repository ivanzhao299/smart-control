#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

gk9000_host="${GK9000_HOST:-10.66.66.3}"
gk9000_user="${GK9000_USER:-user}"
gk9000_key="${GK9000_KEY:-/root/.ssh/anksen-gk9000-deploy}"

read -r action commit_sha unexpected <<< "${SSH_ORIGINAL_COMMAND:-}"

if [[ "$action" != "gk9000-deploy" && "$action" != "gk9000-verify" && "$action" != "gk9000-clean" ]]; then
  printf 'Rejected: unsupported GK9000 action.\n' >&2
  exit 64
fi

if [[ "$action" == "gk9000-clean" ]]; then
  # 清理GK9000上可能被merge覆盖的未跟踪文件
  exec ssh \
    -i "$gk9000_key" \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=4 \
    "$gk9000_user@$gk9000_host" \
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Set-Location 'D:\\smart-control'; \\\$untracked = @(git status --porcelain --untracked-files=all 2>\\\$null | Where-Object { \\\$_ -match '^\\\?\\\?' } | ForEach-Object { \\\$_.Substring(3).Trim() }); if (\\\$untracked.Count -gt 0) { Write-Output \\\"Removing \\\$ (\\\$untracked.Count) untracked files: \\\$ (\\\$untracked -join ', ')\\\"; foreach (\\\$f in \\\$untracked) { Remove-Item -Path (Join-Path 'D:\\smart-control' \\\$f) -Force -ErrorAction SilentlyContinue } } else { Write-Output 'No untracked files to remove.' }\""
fi

if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ || -n "${unexpected:-}" ]]; then
  printf 'Rejected: expected one full commit SHA.\n' >&2
  exit 64
fi

# 在执行gk9000-deploy之前，先清理GK9000上可能被merge覆盖的未跟踪文件
# 2026-09-13 根因：GK9000上backend/data/video-binding.json未跟踪导致merge失败
if [[ "$action" == "gk9000-deploy" ]]; then
  ssh \
    -i "$gk9000_key" \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=4 \
    "$gk9000_user@$gk9000_host" \
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Set-Location 'D:\\smart-control'; \\\$untracked = @(git status --porcelain --untracked-files=all 2>\\\$null | Where-Object { \\\$_ -match '^\\\?\\\?' } | ForEach-Object { \\\$_.Substring(3).Trim() }); if (\\\$untracked.Count -gt 0) { Write-Output \\\"Cleaning \\\$ (\\\$untracked.Count) untracked files before deploy: \\\$ (\\\$untracked -join ', ')\\\"; foreach (\\\$f in \\\$untracked) { Remove-Item -Path (Join-Path 'D:\\smart-control' \\\$f) -Force -ErrorAction SilentlyContinue } } else { Write-Output 'No untracked files to clean.' }\"" || true
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
