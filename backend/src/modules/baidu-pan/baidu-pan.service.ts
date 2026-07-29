import { BadRequestException, ConflictException, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import * as https from 'https';
import * as http from 'http';
import { createWriteStream, promises as fsp } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { BaiduPanAuth } from '../../entities/baidu-pan-auth.entity';
import { MediaService } from '../media/media.service';

/**
 * 百度网盘接入 (2026-07-29 业主: "在线曲库能不能连到我的百度网盘 → 把B做出来")
 *
 * 授权走百度 OAuth **设备码模式** (内网系统没有公网回调地址, 设备码是唯一顺路的
 * 官方方案): start() 拿 user_code → 业主手机打开 openapi.baidu.com/device 输码
 * 确认 → poll() 轮询换 token 落库, refresh_token 自动续期。
 *
 * 文件浏览走 xpan file list; 下载走 filemetas 的 dlink (要求 UA=pan.baidu.com,
 * 非会员账号会被百度限速 — 音乐几 MB 无感, 大视频会慢, 属百度侧策略)。
 * 下载在 GK9000 服务器侧**流式落盘** (不进内存), 单文件 2GB 封顶, 同一时刻只跑
 * 一个 (activeDownload), 前端轮询 status 看进度。
 *
 * ⚠️ 联调前提: 业主先在 pan.baidu.com/union 注册个人开发者并创建应用, 把
 * AppKey/SecretKey 粘进媒体页「百度网盘」弹窗 — 本模块所有百度侧调用在配置
 * 完成前都会给出明确指引错误, 不会白报错。
 */

export interface PanFile {
  fsId: number;
  path: string;
  name: string;
  isDir: boolean;
  sizeBytes: number;
  /** 百度的分类: 1视频 2音频 3图片 4文档 5应用 6其他 7种子 */
  category: number;
  downloaded: boolean;
  /** 我们能入库的类型才给下载按钮 */
  ingestible: boolean;
}

const OAUTH_BASE = 'https://openapi.baidu.com/oauth/2.0';
const PAN_BASE = 'https://pan.baidu.com/rest/2.0';
const MAX_BYTES = 2 * 1024 * 1024 * 1024; // 2GB
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

@Injectable()
export class BaiduPanService implements OnModuleInit {
  constructor(
    @InjectRepository(BaiduPanAuth) private readonly repo: Repository<BaiduPanAuth>,
    private readonly media: MediaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /** 进行中的下载 (单并发) */
  private activeDownload: { name: string; receivedBytes: number; totalBytes: number | null; startedAt: number } | null = null;
  private lastResult: { ok: boolean; name: string; message: string; at: number } | null = null;

  async onModuleInit(): Promise<void> {
    // 建表自愈 (与迁移双保险, 防 watcher 部署不跑迁移复发 #22)
    await this.repo.query(`CREATE TABLE IF NOT EXISTS "baidu_pan_auth" (
      "id" integer PRIMARY KEY NOT NULL,
      "appKey" varchar(64), "secretKey" varchar(64), "deviceCode" varchar(128),
      "accessToken" text, "refreshToken" text, "expiresAt" datetime,
      "updatedAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`).catch((e: Error) => {
      this.logger.warn(`[BaiduPan] 建表自愈失败(将影响 /baidu-pan/status): ${e.message}`, { context: 'BaiduPanService' });
    });
  }

  private async row(): Promise<BaiduPanAuth> {
    let r = await this.repo.findOne({ where: { id: 1 } });
    if (!r) {
      r = await this.repo.save(this.repo.create({
        id: 1, appKey: null, secretKey: null, deviceCode: null,
        accessToken: null, refreshToken: null, expiresAt: null,
      }));
    }
    return r;
  }

  // ============ 状态 / 配置 ============

  async status(): Promise<{
    configured: boolean; authorized: boolean;
    download: { active: BaiduPanService['activeDownload']; last: BaiduPanService['lastResult'] };
  }> {
    const r = await this.row();
    return {
      configured: !!(r.appKey && r.secretKey),
      authorized: !!r.refreshToken,
      download: { active: this.activeDownload, last: this.lastResult },
    };
  }

  async saveConfig(appKey: string, secretKey: string): Promise<void> {
    const r = await this.row();
    r.appKey = appKey.trim();
    r.secretKey = secretKey.trim();
    // 换了应用, 旧 token 全部作废
    r.deviceCode = null; r.accessToken = null; r.refreshToken = null; r.expiresAt = null;
    await this.repo.save(r);
    this.logger.info('[BaiduPan] AppKey/SecretKey 已保存, 待授权', { context: 'BaiduPanService' });
  }

  // ============ 设备码授权 ============

  async authStart(): Promise<{ userCode: string; verificationUrl: string; qrcodeUrl: string | null; expiresIn: number; interval: number }> {
    const r = await this.row();
    if (!r.appKey || !r.secretKey) {
      throw new BadRequestException('先在配置里填入百度网盘开放平台的 AppKey/SecretKey (pan.baidu.com/union 创建应用后可见)');
    }
    const j = await this.getJson(`${OAUTH_BASE}/device/code?response_type=device_code&client_id=${encodeURIComponent(r.appKey)}&scope=basic,netdisk`);
    if (!j.device_code || !j.user_code) {
      throw new BadRequestException(`百度返回异常: ${JSON.stringify(j).slice(0, 200)}`);
    }
    r.deviceCode = String(j.device_code);
    await this.repo.save(r);
    return {
      userCode: String(j.user_code),
      verificationUrl: String(j.verification_url ?? 'https://openapi.baidu.com/device'),
      qrcodeUrl: j.qrcode_url ? String(j.qrcode_url) : null,
      expiresIn: Number(j.expires_in ?? 300),
      interval: Number(j.interval ?? 5),
    };
  }

  /** 轮询一次: 用户在手机上确认后返回 authorized=true */
  async authPoll(): Promise<{ authorized: boolean; pending: string | null }> {
    const r = await this.row();
    if (!r.deviceCode) throw new BadRequestException('没有进行中的授权, 先点「开始授权」');
    if (!r.appKey || !r.secretKey) throw new BadRequestException('AppKey/SecretKey 未配置');
    const j = await this.getJson(
      `${OAUTH_BASE}/token?grant_type=device_token&code=${encodeURIComponent(r.deviceCode)}`
      + `&client_id=${encodeURIComponent(r.appKey)}&client_secret=${encodeURIComponent(r.secretKey)}`);
    if (j.access_token) {
      r.accessToken = String(j.access_token);
      r.refreshToken = String(j.refresh_token ?? '');
      r.expiresAt = new Date(Date.now() + Number(j.expires_in ?? 2592000) * 1000);
      r.deviceCode = null;
      await this.repo.save(r);
      this.logger.info('[BaiduPan] 授权成功, token 已落库', { context: 'BaiduPanService' });
      return { authorized: true, pending: null };
    }
    // authorization_pending / slow_down 都算"等着"
    return { authorized: false, pending: String(j.error_description ?? j.error ?? '等待手机确认') };
  }

  /** 取有效 accessToken, 过期自动 refresh */
  private async token(): Promise<string> {
    const r = await this.row();
    if (!r.refreshToken) {
      throw new BadRequestException('百度网盘还没授权 — 在媒体页「百度网盘」里完成一次授权');
    }
    if (r.accessToken && r.expiresAt && r.expiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS) {
      return r.accessToken;
    }
    if (!r.appKey || !r.secretKey) throw new BadRequestException('AppKey/SecretKey 未配置');
    const j = await this.getJson(
      `${OAUTH_BASE}/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(r.refreshToken)}`
      + `&client_id=${encodeURIComponent(r.appKey)}&client_secret=${encodeURIComponent(r.secretKey)}`);
    if (!j.access_token) {
      throw new BadRequestException(`token 续期失败 (${String(j.error ?? '未知')}) — 可能授权已被撤销, 重新授权一次即可`);
    }
    r.accessToken = String(j.access_token);
    r.refreshToken = String(j.refresh_token ?? r.refreshToken);
    r.expiresAt = new Date(Date.now() + Number(j.expires_in ?? 2592000) * 1000);
    await this.repo.save(r);
    return r.accessToken;
  }

  // ============ 文件浏览 / 下载入库 ============

  async list(dir: string): Promise<{ dir: string; entries: PanFile[] }> {
    const d = dir && dir.startsWith('/') ? dir : '/';
    const tok = await this.token();
    const j = await this.getJson(
      `${PAN_BASE}/xpan/file?method=list&dir=${encodeURIComponent(d)}&order=name&desc=0&start=0&limit=500&web=web&folder=0&access_token=${encodeURIComponent(tok)}`);
    if (Number(j.errno) !== 0) {
      throw new BadRequestException(`百度网盘列目录失败 (errno=${j.errno}) — token 失效可重新授权; -9 为目录不存在`);
    }
    const names = new Set((await this.media.listOriginalNames()).map((n) => n.toLowerCase()));
    const entries: PanFile[] = (Array.isArray(j.list) ? j.list : []).map((f: Record<string, unknown>) => {
      const name = String(f.server_filename ?? '');
      const isDir = Number(f.isdir) === 1;
      return {
        fsId: Number(f.fs_id),
        path: String(f.path ?? ''),
        name,
        isDir,
        sizeBytes: Number(f.size ?? 0),
        category: Number(f.category ?? 6),
        downloaded: !isDir && names.has(name.toLowerCase()),
        // 音/视频/图片/文档能入库 (与上传入口同一套 classify 规则, 交给后端最终判)
        ingestible: !isDir && /\.(mp3|wav|flac|aac|m4a|ogg|wma|ape|mp4|mov|mkv|avi|webm|jpg|jpeg|png|gif|webp|ppt|pptx|doc|docx|pdf)$/i.test(name),
      };
    });
    // 文件夹在前, 再按名
    entries.sort((a, b) => (Number(b.isDir) - Number(a.isDir)) || a.name.localeCompare(b.name, 'zh-CN'));
    return { dir: d, entries };
  }

  /** 发起服务器侧代下载 (立即返回, 前端轮询 status 看进度) */
  async startDownload(fsId: number, name: string): Promise<{ started: boolean }> {
    if (this.activeDownload) {
      throw new ConflictException(`「${this.activeDownload.name}」正在下载, 请等它完成`);
    }
    const existing = (await this.media.listOriginalNames()).find((n) => n.toLowerCase() === name.toLowerCase());
    if (existing) throw new ConflictException(`「${name}」已在媒体库里`);
    const tok = await this.token();
    // filemetas 拿 dlink
    const meta = await this.getJson(
      `${PAN_BASE}/xpan/multimedia?method=filemetas&fsids=[${Number(fsId)}]&dlink=1&access_token=${encodeURIComponent(tok)}`);
    const dlink = meta?.list?.[0]?.dlink ? String(meta.list[0].dlink) : null;
    if (!dlink) {
      throw new BadRequestException(`拿不到下载链接 (errno=${meta?.errno}) — 文件可能已被移动/删除`);
    }
    const size = Number(meta.list[0].size ?? 0);
    if (size > MAX_BYTES) throw new BadRequestException('文件超过 2GB 上限');

    this.activeDownload = { name, receivedBytes: 0, totalBytes: size || null, startedAt: Date.now() };
    // 后台跑, 不阻塞请求
    void this.runDownload(`${dlink}&access_token=${encodeURIComponent(tok)}`, name)
      .then((saved) => {
        this.lastResult = { ok: true, name, message: `已入库 (#${saved.id}, ${(saved.sizeBytes / 1048576).toFixed(1)}MB)`, at: Date.now() };
        this.logger.info(`[BaiduPan] 下载入库完成: ${name} (#${saved.id})`, { context: 'BaiduPanService' });
      })
      .catch((e) => {
        this.lastResult = { ok: false, name, message: (e as Error).message, at: Date.now() };
        this.logger.warn(`[BaiduPan] 下载失败: ${name}: ${(e as Error).message}`, { context: 'BaiduPanService' });
      })
      .finally(() => { this.activeDownload = null; });
    return { started: true };
  }

  private async runDownload(url: string, name: string): Promise<{ id: number; sizeBytes: number }> {
    const tmp = join(tmpdir(), `baidupan-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
    try {
      await this.streamToFile(url, tmp, 5);
      const stat = await fsp.stat(tmp);
      if (stat.size < 1024) throw new Error('下载内容异常偏小, 已放弃入库');
      const mime = this.guessMime(name);
      const saved = await this.media.ingestFromFile(name, mime, tmp, 'baidu-pan',
        `百度网盘下载 (${new Date().toISOString().slice(0, 10)})`);
      return { id: saved.id, sizeBytes: saved.sizeBytes };
    } catch (e) {
      await fsp.unlink(tmp).catch(() => undefined);
      throw e;
    }
  }

  private guessMime(name: string): string {
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    const map: Record<string, string> = {
      mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac', aac: 'audio/aac', m4a: 'audio/mp4',
      ogg: 'audio/ogg', wma: 'audio/x-ms-wma', ape: 'audio/x-ape',
      mp4: 'video/mp4', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo', webm: 'video/webm',
      jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
      ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      pdf: 'application/pdf',
    };
    return map[ext] ?? 'application/octet-stream';
  }

  /** dlink 流式落盘 (UA 必须是 pan.baidu.com, 否则 403); 跟随重定向; 进度写 activeDownload */
  private streamToFile(url: string, dest: string, redirects: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const mod = url.startsWith('http:') ? http : https;
      const req = mod.get(url, { headers: { 'User-Agent': 'pan.baidu.com' }, timeout: 60000 }, (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
          res.resume();
          this.streamToFile(new URL(res.headers.location, url).toString(), dest, redirects - 1).then(resolve, reject);
          return;
        }
        if (code < 200 || code >= 300) {
          res.resume();
          reject(new Error(`下载被拒 HTTP ${code} (百度侧限制或链接过期, 重试一次通常可解)`));
          return;
        }
        const out = createWriteStream(dest);
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (this.activeDownload) this.activeDownload.receivedBytes = total;
          if (total > MAX_BYTES) req.destroy(new Error('文件超过 2GB 上限'));
        });
        res.pipe(out);
        out.on('finish', () => resolve());
        out.on('error', reject);
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('连接百度超时')));
      req.on('error', reject);
    });
  }

  /** GET → JSON (百度 OAuth/网盘接口全是 GET + query) */
  private getJson(url: string): Promise<Record<string, any>> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { headers: { 'User-Agent': 'pan.baidu.com' }, timeout: 15000 }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
          catch { reject(new BadRequestException(`百度返回非 JSON (HTTP ${res.statusCode})`)); }
        });
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('连接百度超时')));
      req.on('error', (e) => reject(new BadRequestException(`连不上百度: ${e.message}`)));
    });
  }
}
