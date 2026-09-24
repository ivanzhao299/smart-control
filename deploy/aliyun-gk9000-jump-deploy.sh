#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

gk9000_host="${GK9000_HOST:-10.66.66.3}"
gk9000_user="${GK9000_USER:-user}"
gk9000_key="${GK9000_KEY:-/root/.ssh/anksen-gk9000-deploy}"

read -r action commit_sha unexpected <<< "${SSH_ORIGINAL_COMMAND:-}"

if [[ "$action" != "gk9000-deploy" && "$action" != "gk9000-verify" && "$action" != "gk9000-status" && "$action" != "gk9000-offsite-backup" ]]; then
  printf 'Rejected: unsupported GK9000 action.\n' >&2
  exit 64
fi

if [[ "$action" == "gk9000-status" ]]; then
  # 只读健康巡检：PowerShell 命令固定写死在网关内，不读取/不拼接任何外部传入参数，
  # 受限 deploy key 无法借此执行任意命令（无注入面），只查询不变更 GK。该命令刻意不含
  # '$' 变量、不含内层双引号：它要穿过 jump bash -> Windows OpenSSH -> powershell(可能两层)，
  # '$_' 会被外层 powershell 展开为空，故只用原始属性 + 单引号。注意：ssh 续行参数序列
  # 中间禁止插入 # 注释行（注释行无尾续行会让命令提前结束），所以说明全部写在这里。
  exec ssh \
    -i "$gk9000_key" \
    -o BatchMode=yes \
    -o IdentitiesOnly=yes \
    -o StrictHostKeyChecking=yes \
    -o ServerAliveInterval=15 \
    -o ServerAliveCountMax=4 \
    "$gk9000_user@$gk9000_host" \
    "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"Write-Output '=== CPU PERCENT (avg) ==='; (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average; Write-Output '=== TOP 15 PROCESSES: CPU=seconds, WS=bytes ==='; Get-Process | Sort-Object CPU -Descending | Select-Object -First 15 Name,Id,CPU,WorkingSet64 | Format-Table -AutoSize | Out-String -Width 200; Write-Output '=== MEMORY KB: TotalVisibleMemorySize / FreePhysicalMemory ==='; Get-CimInstance Win32_OperatingSystem | Select-Object TotalVisibleMemorySize,FreePhysicalMemory | Format-List; Write-Output '=== DISK BYTES: Used / Free ==='; Get-PSDrive -PSProvider FileSystem | Select-Object Name,Used,Free | Format-Table -AutoSize | Out-String -Width 200\""
fi

if [[ ! "$commit_sha" =~ ^[0-9a-f]{40}$ || -n "${unexpected:-}" ]]; then
  printf 'Rejected: expected one full commit SHA.\n' >&2
  exit 64
fi

if [[ "$action" == "gk9000-offsite-backup" ]]; then
  exec /usr/local/sbin/smart-control-gk9000-offsite-backup "$commit_sha"
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
