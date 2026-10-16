import { createHmac, randomBytes } from 'crypto';

/**
 * eWeLink v2 签名 / 区域工具（依据酷宅开放平台 OAuth2.0 文档）。
 */

/** 区域码 → v2 REST API host（回调 region 决定） */
export const REGION_API_HOSTS: Record<string, string> = {
  cn: 'https://cn-apia.coolkit.cn',
  as: 'https://as-apia.coolkit.cc',
  us: 'https://us-apia.coolkit.cc',
  eu: 'https://eu-apia.coolkit.cc',
};

/**
 * 区域码 → OAuth 授权页 host。
 * 注意：授权页所有区域统一用 c2ccdn.coolkit.cc（.cc）。cn 若写成 .cn 域名无法访问
 * （实测 c2ccdn.coolkit.cn 不可达，官方文档授权页 URL 也是 .cc）。
 */
export const REGION_OAUTH_HOSTS: Record<string, string> = {
  cn: 'https://c2ccdn.coolkit.cc',
  as: 'https://c2ccdn.coolkit.cc',
  us: 'https://c2ccdn.coolkit.cc',
  eu: 'https://c2ccdn.coolkit.cc',
};

export function apiHostForRegion(region: string | null | undefined): string {
  return (region && REGION_API_HOSTS[region]) || REGION_API_HOSTS.cn;
}

export function oauthHostForRegion(region: string | null | undefined): string {
  return (region && REGION_OAUTH_HOSTS[region]) || REGION_OAUTH_HOSTS.cn;
}

/**
 * 授权页 authorization 参数：
 *   HMAC-SHA256(key = appSecret, message = `${clientId}_${seq}`) → 原始二进制 → Base64
 */
export function makeAuthorizationSign(
  appSecret: string,
  clientId: string,
  seq: string | number,
): string {
  return createHmac('sha256', appSecret)
    .update(`${clientId}_${seq}`, 'utf8')
    .digest('base64');
}

/**
 * v2 REST 请求 Authorization: Sign 头：
 *   HMAC-SHA256(key = appSecret, message = POST body JSON / GET 排序 query) → Base64
 */
export function makeApiSign(appSecret: string, message: string): string {
  return createHmac('sha256', appSecret).update(message, 'utf8').digest('base64');
}

/** 长度 8 的随机字母数字（X-CK-Nonce / 授权页 nonce） */
export function makeNonce(len = 8): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += alphabet[bytes[i] % alphabet.length];
  return out;
}
