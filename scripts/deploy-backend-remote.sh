#!/usr/bin/env bash
# =====================================================================
# 后端远程部署脚本 (服务器端执行)
# 文件: scripts/deploy-backend-remote.sh
# 调用方: .github/workflows/deploy.yml (scp 本脚本 + 两个 tarball 到 /tmp/, 然后 ssh 执行)
# 也可手动 ssh 执行 (从 /srv/app/smart-control/releases/<release>/scripts/ 拷贝调用)
#
# 步骤:
#   1) 解压 backend-src.tgz 到新 release 目录
#   2) 复用旧 .env (不覆盖生产配置)
#   3) 落地 version.json (CI 生成, 含 commit/buildTime)
#   4) pnpm install --frozen-lockfile + pnpm run build
#   5) 原子切换 current 软链
#   6) pm2 reload smart-control-backend --update-env
#   7) 清理超出 --keep 数量的旧 release
# =====================================================================
set -euo pipefail

BACKEND_TARBALL=""
META_TARBALL=""
APP_ROOT="/srv/app/smart-control"
PM2_NAME="smart-control-backend"
KEEP=5

while [ $# -gt 0 ]; do
  case "$1" in
    --backend-tarball) BACKEND_TARBALL="$2"; shift 2 ;;
    --meta-tarball)    META_TARBALL="$2"; shift 2 ;;
    --app-root)        APP_ROOT="$2"; shift 2 ;;
    --pm2-name)        PM2_NAME="$2"; shift 2 ;;
    --keep)            KEEP="$2"; shift 2 ;;
    -h|--help)
      grep -E '^# ' "$0" | sed 's/^# //'; exit 0 ;;
    *) echo "未知参数: $1" >&2; exit 2 ;;
  esac
done

[ -f "$BACKEND_TARBALL" ] || { echo "缺少 --backend-tarball" >&2; exit 2; }
[ -d "$APP_ROOT" ]        || { echo "APP_ROOT 不存在: $APP_ROOT" >&2; exit 2; }

TS=$(date +%Y%m%d-%H%M%S)
NEW="$APP_ROOT/releases/$TS"
mkdir -p "$NEW"

echo "================================================"
echo " 后端部署 → $NEW"
echo "================================================"

# 1) 解压源码
echo "[1/7] 解压后端源码"
tar xzf "$BACKEND_TARBALL" -C "$NEW"

# 2) 复用旧 .env
if [ -L "$APP_ROOT/current" ] && [ -f "$APP_ROOT/current/backend/.env" ]; then
  cp "$APP_ROOT/current/backend/.env" "$NEW/backend/.env"
  echo "[2/7] 复用旧 .env"
else
  echo "[2/7] 警告: 未找到旧 .env, 跳过 (首次部署需手动创建)" >&2
fi

# 3) 落地 version.json
if [ -n "$META_TARBALL" ] && [ -f "$META_TARBALL" ]; then
  tar xzf "$META_TARBALL" -C "$NEW"
  echo "[3/7] version.json 已落地: $(cat $NEW/deploy/configs/version.json 2>/dev/null | head -c 200)"
else
  echo "[3/7] 无 version.json (跳过)"
fi

# 4) pnpm install + build (统一用 pnpm, 不再混 npm 导致 lock 不同步)
echo "[4/7] pnpm install --frozen-lockfile + rebuild native + build"
cd "$NEW/backend"
pnpm install --frozen-lockfile --reporter=append-only
# pnpm 10 默认禁 install 脚本, 显式 rebuild 原生模块兜底 (即便 onlyBuiltDependencies 已配)
pnpm rebuild better-sqlite3
pnpm run build

# 5) 切 current 软链
echo "[5/7] 原子切换 current 软链"
cd "$APP_ROOT"
ln -sfn "$NEW" current.tmp
mv -T current.tmp current

# 6) PM2: 强制 delete + start, 不再用 pm2 reload
# 之前用 pm2 reload 在以下场景会变成 no-op, 导致 deploy 看似成功但代码没换:
#   1) 上一次 deploy 后 backend 启动失败, pm2 把进程标 "errored", reload 不动 errored
#   2) max_restarts (50) 用完后 pm2 不再尝试拉, reload 也不会重新计数
#   3) min_uptime 未达, pm2 把短命进程标 "errored" 同样卡死
# delete + start 是更彻底的方式: 不管前状态, 都清掉重起, 拿到的肯定是新 dist/main.js.
# 代价: 进程会断 ~2-3s (vs reload 的 graceful 0 downtime), 但在生产链路上"可靠"优先于"零 downtime".
echo "[6/7] pm2 delete + start $PM2_NAME (确保拿到新代码)"
pm2 delete "$PM2_NAME" 2>&1 | tail -3 || true
sleep 1
ECOSYSTEM="$APP_ROOT/current/deploy/ecosystem.config.js"
if [ -f "$ECOSYSTEM" ]; then
  pm2 start "$ECOSYSTEM" --only "$PM2_NAME" --update-env
else
  echo "  ecosystem.config.js 不在, 走 dist/main.js 直接启动 (兜底)"
  cd "$APP_ROOT/current/backend"
  pm2 start dist/main.js --name "$PM2_NAME" --update-env
fi
pm2 save

# 7) 清理过期 release (保留 --keep 个)
echo "[7/7] 清理过期 release (保留 $KEEP)"
cd "$APP_ROOT/releases"
ls -1t | tail -n "+$((KEEP + 1))" | while read d; do
  if [ -n "$d" ] && [ -d "$d" ]; then
    rm -rf "$d"
    echo "  清理: $d"
  fi
done

echo ""
echo "=== 后端部署完成: $TS ==="
pm2 describe "$PM2_NAME" 2>/dev/null | grep -E "status|restart time|version|cwd" | head -6
