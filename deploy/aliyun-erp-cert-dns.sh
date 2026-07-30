#!/usr/bin/env bash
#
# erp.cnjinhu.top 证书签发 — DNS 验证方式 (acme.sh + 阿里云 DNS API)
#
# 背景: cnjinhu.top 未备案, 阿里云大陆 ECS 对该域名的 80/443 有拦截,
# certbot 的 HTTP 验证必然失败 (拦截页 403)。DNS 验证不走任何端口, 不受影响。
#
# 前置: 阿里云 AccessKey。安全起见建议用 RAM 子账号:
#   控制台 → RAM 访问控制 → 用户 → 创建用户(勾选 OpenAPI 调用访问) →
#   授权「AliyunDNSFullAccess」→ 记下 AccessKey ID / Secret。
#   (用主账号 AccessKey 也能跑, 但权限过大, 不推荐长期保留)
#
# 运行: root 在跳板机上执行, 按提示输入 AccessKey (输入不回显、不落 shell 历史)。
# 签发成功后 acme.sh 会自动续签 (装了 cron), 并自动 reload nginx。

set -euo pipefail
DOMAIN=erp.cnjinhu.top
CERT_DIR=/etc/nginx/certs

read -rp "阿里云 AccessKey ID: " Ali_Key
read -rsp "阿里云 AccessKey Secret (输入不显示): " Ali_Secret; echo ""
export Ali_Key Ali_Secret

echo "==== 1. 安装 acme.sh (已装则跳过) ===="
if [ ! -f ~/.acme.sh/acme.sh ]; then
  curl -fsSL https://get.acme.sh | sh -s email=admin@cnjinhu.top || {
    echo "官方源安装失败, 试 gitee 镜像..."
    rm -rf /tmp/acme.sh
    git clone --depth 1 https://gitee.com/neilpang/acme.sh.git /tmp/acme.sh
    (cd /tmp/acme.sh && ./acme.sh --install -m admin@cnjinhu.top)
  }
fi

echo "==== 2. DNS 验证签发 ===="
~/.acme.sh/acme.sh --issue --dns dns_ali -d "$DOMAIN" --server letsencrypt

echo "==== 3. 安装证书到 nginx 目录 + 自动续签挂钩 ===="
mkdir -p "$CERT_DIR"
~/.acme.sh/acme.sh --install-cert -d "$DOMAIN" \
  --fullchain-file "$CERT_DIR/$DOMAIN.fullchain.pem" \
  --key-file "$CERT_DIR/$DOMAIN.key.pem" \
  --reloadcmd "systemctl reload nginx 2>/dev/null || nginx -s reload"

echo ""
echo "==== 完成 ===="
echo "证书: $CERT_DIR/$DOMAIN.fullchain.pem (60 天自动续签)"
echo "下一步: 重跑 aliyun-public-proxy.sh, 它会自动改用 HTTPS (443 + 8443 双监听)"
