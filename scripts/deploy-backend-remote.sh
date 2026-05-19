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
#   4) npm ci + npm run build
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

# 4) npm ci + build
echo "[4/7] npm ci + build"
cd "$NEW/backend"
npm ci --no-audit --no-fund --loglevel=error
npm run build

# 5) 切 current 软链
echo "[5/7] 原子切换 current 软链"
cd "$APP_ROOT"
ln -sfn "$NEW" current.tmp
mv -T current.tmp current

# 6) PM2 reload
echo "[6/7] pm2 reload $PM2_NAME"
pm2 reload "$PM2_NAME" --update-env

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
