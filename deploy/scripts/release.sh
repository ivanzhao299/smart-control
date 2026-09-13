#!/usr/bin/env bash
# /srv/www/cnjinhu.top/bin/release.sh
# 通用版本化发布脚本 - cnjinhu.top
#
# 用法:
#   release.sh <app-name> <source>
#
#   <app-name>  应用名 (= URL 路径段, 如 ai / docs / portal)
#   <source>    本地文件 (HTML) 或目录 (SPA dist/)
#
# 例:
#   scp dist.tar.gz root@server:/tmp/
#   ssh root@server 'tar xzf /tmp/dist.tar.gz -C /tmp/'
#   release.sh portal /tmp/dist
#
#   或直接传单个 HTML:
#   scp index.html root@server:/tmp/foo.html
#   release.sh foo /tmp/foo.html
#
# 行为:
#   - 创建 /srv/www/cnjinhu.top/<app>/releases/<TS>/
#   - 拷贝源到该目录 (单文件 → index.html; 目录 → 整目录拷贝)
#   - 原子切换 current 软链
#   - 自动改 nginx (alias 指向 current/), 备份原配置
#   - 验证 nginx -t & reload
#   - 保留最近 KEEP_RELEASES (默认 5) 个 release, 旧版本删除
#
# 环境变量:
#   KEEP_RELEASES=5            保留最近 N 个版本
#   SITE_ROOT=/srv/www/cnjinhu.top
#   NGINX_CONF=/etc/nginx/sites-available/default
#   SKIP_NGINX=1               不动 nginx (适合首次外面手动配好的情况)

set -euo pipefail

APP_NAME="${1:-}"
SOURCE="${2:-}"

if [[ -z "$APP_NAME" || -z "$SOURCE" ]]; then
  sed -n '2,30p' "$0"
  exit 1
fi

SITE_ROOT="${SITE_ROOT:-/srv/www/cnjinhu.top}"
NGINX_CONF="${NGINX_CONF:-/etc/nginx/conf.d/cnjinhu-default.conf}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"

APP_ROOT="$SITE_ROOT/$APP_NAME"
RELEASES_DIR="$APP_ROOT/releases"
CURRENT_LINK="$APP_ROOT/current"
TS="$(date +%Y%m%d-%H%M%S)"
NEW_RELEASE="$RELEASES_DIR/$TS"

[[ -e "$SOURCE" ]] || { echo "ERROR: 源 $SOURCE 不存在"; exit 1; }

echo "[release] app=$APP_NAME  source=$SOURCE  ts=$TS"

mkdir -p "$NEW_RELEASE"
if [[ -d "$SOURCE" ]]; then
  cp -a "$SOURCE/." "$NEW_RELEASE/"
else
  cp "$SOURCE" "$NEW_RELEASE/index.html"
fi
chown -R www-data:www-data "$NEW_RELEASE" 2>/dev/null || true
find "$NEW_RELEASE" -type f -exec chmod 644 {} \;
find "$NEW_RELEASE" -type d -exec chmod 755 {} \;

ln -sfn "$NEW_RELEASE" "$CURRENT_LINK.tmp"
mv -T "$CURRENT_LINK.tmp" "$CURRENT_LINK"
echo "[release] current -> $(readlink "$CURRENT_LINK")"

if [[ "${SKIP_NGINX:-0}" != "1" ]]; then
  if [ ! -f "$NGINX_CONF" ]; then
    echo "[release] [WARN] NGINX_CONF=$NGINX_CONF 不存在, 跳过 nginx 改写 (假设已手动配好)"
  else
  if ! grep -qE "alias\s+$SITE_ROOT/$APP_NAME/current/" "$NGINX_CONF"; then
    echo "[release] 检测到 nginx 尚未指向 $APP_NAME, 尝试改写 /$APP_NAME/ location"
    cp -a "$NGINX_CONF" "$NGINX_CONF.bak-$APP_NAME-$TS"
    python3 - "$APP_NAME" "$SITE_ROOT" "$NGINX_CONF" <<'PY'
import re, sys
app, site_root, path = sys.argv[1], sys.argv[2], sys.argv[3]
with open(path) as f:
    text = f.read()
pat = re.compile(
    r"location\s+\^~\s+/" + re.escape(app) + r"/\s*\{(?:[^{}]|\{[^{}]*\})*?\}",
    re.DOTALL,
)
new_block = (
    f"location ^~ /{app}/ {{\n"
    f"        alias {site_root}/{app}/current/;\n"
    f"        index index.html;\n"
    f"        try_files $uri $uri/ =404;\n"
    f"    }}"
)
if pat.search(text):
    text = pat.sub(new_block, text, count=1)
    print(f"  替换了已有 /{app}/ location 块")
else:
    print(f"  /{app}/ location 块未找到, 跳过 nginx 修改 (请手动添加)")
    print("  推荐:")
    print(f"    location ^~ /{app}/ {{")
    print(f"        alias {site_root}/{app}/current/;")
    print("        index index.html;")
    print("        try_files $uri $uri/ =404;")
    print("    }")
    sys.exit(0)
with open(path, "w") as f:
    f.write(text)
PY
    nginx -t
    systemctl reload nginx
    echo "[release] nginx reload OK"
  else
    echo "[release] nginx 已指向 $APP_NAME/current/, 不动配置"
  fi
  fi
fi

cd "$RELEASES_DIR"
ls -1t | tail -n +$((KEEP_RELEASES + 1)) | xargs -r rm -rf
REMAIN=$(ls -1 "$RELEASES_DIR" | wc -l)
echo "[release] 保留 release 数: $REMAIN"

echo "[release] DONE"
