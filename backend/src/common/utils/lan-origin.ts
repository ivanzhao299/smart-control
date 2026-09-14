import { networkInterfaces } from 'os';

let cached: string | null = null;

/**
 * 计算"手机/外部设备可访问本机"的来源 origin，用于大屏照片下载二维码。
 *
 * 大屏页面跑在 GK9000 本机，window.location 是 localhost，手机扫码不能用
 * localhost，必须给局域网 IP。规则：
 *   1. 显式 env PUBLIC_ORIGIN（如 http://192.168.77.54:3200）优先级最高，现场固定 IP 时建议配置；
 *   2. 否则自动探测网卡 IPv4：优先 192.168.*，其次 10.* / 172.16-31.*，跳过回环/内部；
 *   3. 都没有时返回空串（调用方回退到相对路径，至少本机大屏 img 不受影响）。
 * 结果进程内缓存（IP 不会在运行中变化）。
 */
export function lanOrigin(port: number): string {
  const explicit = (process.env.PUBLIC_ORIGIN ?? '').trim().replace(/\/+$/, '');
  if (explicit) return explicit;
  if (cached !== null) return cached;

  let fallback = '';
  let preferred = '';
  const ifs = networkInterfaces();
  for (const list of Object.values(ifs)) {
    if (!list) continue;
    for (const it of list) {
      if (it.family !== 'IPv4' || it.internal) continue;
      const a = it.address;
      if (/^192\.168\./.test(a)) { preferred = a; break; }
      if (!fallback && /^(10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a)) fallback = a;
    }
    if (preferred) break;
  }
  const ip = preferred || fallback;
  cached = ip ? `http://${ip}:${port}` : '';
  return cached;
}
