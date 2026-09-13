# =====================================================================
# 展贸中心智能化中控系统 - 系统初始化脚本 (Sprint-10 Task-19)
# 文件: deploy\scripts\init.ps1
# 用途: 首次部署到 Windows 10 现场主机时执行
# 内容:
#   1) 创建标准目录: D:\smart-control\{backend,frontend,database,logs,backups,deploy}
#   2) 校验前置软件: Node 20+ / pnpm / pm2 / nginx
#   3) 落地 backend\.env (从 backend\.env.example 复制, 不覆盖)
#   4) pnpm install (backend + frontend)
#   5) backend 构建 + 数据库迁移(自动 synchronize) + UAT seed
#   6) frontend 构建 (vite build → frontend\dist)
#   7) 注册 PM2 进程 + pm2 save
#   8) 提示后续步骤 (nginx 加载 + pm2-windows-startup)
# 用法:
#   deploy\scripts\init.ps1                    # 默认 D:\smart-control\
#   deploy\scripts\init.ps1 -Root 'E:\smart'   # 自定义部署根
#   deploy\scripts\init.ps1 -SkipBuild         # 仅创建目录 + 装依赖
# =====================================================================
[CmdletBinding()]
param(
  [string]$Root = 'D:\smart-control',
  [switch]$SkipBuild,
  [switch]$SkipDeps
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

function Step {
  param([int]$N, [string]$Title)
  Write-Host ""
  Write-Host ("=== [{0}] {1} ===" -f $N, $Title) -ForegroundColor Cyan
}

function Ensure-Cmd {
  param([string]$Cmd, [string]$Hint)
  $c = Get-Command $Cmd -ErrorAction SilentlyContinue
  if (-not $c) {
    Write-Host " 缺少: $Cmd  → $Hint" -ForegroundColor Red
    return $false
  }
  Write-Host " OK    $Cmd  ($($c.Source))" -ForegroundColor Green
  return $true
}

Step 1 "创建部署目录"
$dirs = @('backend','frontend','database','logs','backups','deploy')
foreach ($d in $dirs) {
  $p = Join-Path $Root $d
  if (-not (Test-Path $p)) {
    New-Item -ItemType Directory -Path $p -Force | Out-Null
    Write-Host " 创建: $p" -ForegroundColor Green
  } else {
    Write-Host " 已存在: $p" -ForegroundColor DarkGray
  }
}

Step 2 "校验前置软件"
$ok = $true
$ok = (Ensure-Cmd 'node' 'https://nodejs.org/  (>=20)') -and $ok
$ok = (Ensure-Cmd 'pnpm' 'npm i -g pnpm') -and $ok
$ok = (Ensure-Cmd 'pm2'  'npm i -g pm2 pm2-windows-startup') -and $ok
$nginx = Get-Command 'nginx' -ErrorAction SilentlyContinue
if (-not $nginx) {
  Write-Host " 警告: 未找到 nginx 命令 (可手动放置 C:\nginx\). 不阻塞初始化." -ForegroundColor Yellow
} else {
  Write-Host " OK    nginx  ($($nginx.Source))" -ForegroundColor Green
}
if (-not $ok) {
  Write-Host "前置软件不齐, 先安装再继续." -ForegroundColor Red
  exit 1
}

# Node 版本检查
$nv = (& node -v) -replace '^v',''
$major = [int]($nv.Split('.')[0])
if ($major -lt 20) {
  Write-Host "Node 版本过低: v$nv (要求 >=20)" -ForegroundColor Red
  exit 1
}
Write-Host " Node 版本: v$nv" -ForegroundColor Green

Step 3 "backend\.env 落地"
$envExample = Join-Path $projectRoot 'backend\.env.example'
$envTarget  = Join-Path $projectRoot 'backend\.env'
if (Test-Path $envTarget) {
  Write-Host " backend\.env 已存在, 跳过" -ForegroundColor DarkGray
} elseif (Test-Path $envExample) {
  Copy-Item -Path $envExample -Destination $envTarget
  Write-Host " 已从 .env.example 复制 → backend\.env" -ForegroundColor Green
  Write-Host " 请手动修改: DB_PATH / LOG_DIR / MOCK_MODE / HOST_MACHINE / PLATFORM=windows" -ForegroundColor Yellow
} else {
  Write-Host " 警告: 未找到 backend\.env.example" -ForegroundColor Yellow
}

if (-not $SkipDeps) {
  Step 4 "安装依赖 (backend + frontend)"
  Push-Location (Join-Path $projectRoot 'backend');  pnpm install --frozen-lockfile;  Pop-Location
  Push-Location (Join-Path $projectRoot 'frontend'); pnpm install --frozen-lockfile;  Pop-Location
}

if (-not $SkipBuild) {
  Step 5 "backend 构建"
  Push-Location (Join-Path $projectRoot 'backend')
  pnpm run build
  Pop-Location

  Step 6 "frontend 构建 (vite build)"
  Push-Location (Join-Path $projectRoot 'frontend')
  pnpm run build
  Pop-Location
}

Step 7 "PM2 注册"
$ecosystem = Join-Path $projectRoot 'deploy\ecosystem.config.js'
if (-not (Test-Path $ecosystem)) {
  Write-Host " 缺少 PM2 配置: $ecosystem" -ForegroundColor Red
  exit 1
}
& pm2 start $ecosystem --env production
& pm2 save
Write-Host " PM2 进程已注册并保存" -ForegroundColor Green

Step 8 "后续步骤提示"
Write-Host @"
 1) 开机自启 (任一即可):
    a) PM2 Windows Startup:
         npm i -g pm2-windows-startup
         pm2-startup install
         pm2 save
    b) 任务计划程序:  参考 deploy\windows-startup\README.md
 2) Nginx (可选, 需要 80 端口反代时):
         拷贝 deploy\nginx\smart-control.conf 到 C:\nginx\conf\sites\
         在 nginx.conf 的 http {} 内 include sites/*.conf
         C:\nginx\nginx.exe -t  &&  C:\nginx\nginx.exe
 3) 健康检测:
         deploy\scripts\health.ps1
 4) 定时备份: 任务计划程序 → 每日 03:00 → deploy\scripts\backup.ps1
 5) 上线检查清单: PRODUCTION_CHECKLIST.md
"@ -ForegroundColor Cyan
