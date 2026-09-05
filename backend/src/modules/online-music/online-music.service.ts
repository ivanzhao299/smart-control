import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import * as https from 'https';
import { MediaService } from '../media/media.service';
import { FREEPD_GENRE_LABELS, FREEPD_TRACKS } from './freepd-catalog';
import { Actor } from '../../common/auth/actor';
import { assertCanUpload } from '../../common/auth/resource-policy';

/**
 * 在线无版权曲库 (2026-07-29 业主: "不能在系统里搜索和下载吗") —
 * FreePD (CC0 公有领域) 的 GitHub 镜像做源, 业主在媒体页浏览/搜索, 点一下
 * 后端代下载并入媒体库。要点:
 * - **只认目录里的曲子** (path 必须命中 FREEPD_TRACKS), 前端传不了任意 URL;
 * - 下载走 raw.githubusercontent.com (GK9000 与 GitHub 的连通性由每分钟的
 *   auto-update-watcher 常年验证); 可用 FREEPD_MIRROR_PREFIX 环境变量整体
 *   换镜像前缀 (现场若 raw 被墙, 配一个加速前缀即可, 不用改代码);
 * - 单文件 40MB 封顶, 同一时刻只跑一个下载 (串行, 不挤占展厅带宽)。
 */
@Injectable()
export class OnlineMusicService {
  constructor(
    private readonly media: MediaService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  private static readonly MAX_BYTES = 40 * 1024 * 1024;
  private downloading: string | null = null;

  private baseUrl(): string {
    const prefix = (process.env.FREEPD_MIRROR_PREFIX ?? '').trim().replace(/\/$/, '');
    return prefix || 'https://raw.githubusercontent.com/0lhi/FreePD/master';
  }

  /** 目录 + 已入库标记。已入库判定: 库里有同名文件, 或备注里带同名 CC0 溯源标 */
  async catalog(actor: Actor): Promise<{
    genres: Array<{ key: string; label: string; count: number }>;
    tracks: Array<{ path: string; name: string; genre: string; downloaded: boolean }>;
    downloading: string | null;
  }> {
    const visible = (await this.media.list({ actor })).items;
    const names = new Set(visible.map((m) => m.originalName.toLowerCase()));
    const remarkNames = this.remarkTrackNames(visible.map(m => m.remark));
    const tracks = FREEPD_TRACKS.map((t) => ({
      ...t,
      downloaded: names.has(`${t.name.toLowerCase()}.mp3`) || remarkNames.has(t.name),
    }));
    const counts = new Map<string, number>();
    for (const t of tracks) counts.set(t.genre, (counts.get(t.genre) ?? 0) + 1);
    const genres = Object.entries(FREEPD_GENRE_LABELS)
      .filter(([k]) => counts.has(k))
      .map(([key, label]) => ({ key, label, count: counts.get(key) ?? 0 }));
    return { genres, tracks, downloading: null };
  }

  /** 备注里的溯源标 (内置 10 首用中文名入库, 靠备注「英文名」识别已入库) */
  private remarkTrackNames(remarks: Array<string | null>): Set<string> {
    const set = new Set<string>();
    for (const r of remarks) {
      const m = /freepd\.com「(.+?)」/.exec(r ?? '');
      if (m) set.add(m[1]);
    }
    return set;
  }

  async download(path: string, actor: Actor): Promise<{ id: number; originalName: string; sizeBytes: number }> {
    assertCanUpload(actor);
    const track = FREEPD_TRACKS.find((t) => t.path === path);
    if (!track) throw new NotFoundException('曲目不在曲库目录里');
    if (this.downloading) {
      throw new ConflictException('下载服务正忙，请稍后重试');
    }
    const originalName = `${track.name}.mp3`;
    const existing = (await this.media.list({ actor })).items.find((m) => m.originalName.toLowerCase() === originalName.toLowerCase());
    if (existing) throw new ConflictException(`「${track.name}」已在媒体库里`);

    this.downloading = track.name;
    try {
      const url = `${this.baseUrl()}/${encodeURI(track.path)}`;
      const buf = await this.fetchBinary(url, OnlineMusicService.MAX_BYTES);
      if (buf.length < 100 * 1024) {
        throw new BadRequestException('下载内容异常偏小, 可能被网络设备拦截, 已放弃入库');
      }
      const saved = await this.media.ingestFromBuffer(
        originalName, 'audio/mpeg', buf, actor.username, actor,
        `在线曲库下载 (CC0 公有领域, freepd.com「${track.name}」) — 可商用免署名`,
      );
      this.logger.info(`[OnlineMusic] 已下载入库: ${originalName} (#${saved.id}, ${(buf.length / 1048576).toFixed(1)}MB)`, {
        context: 'OnlineMusicService',
      });
      return { id: saved.id, originalName: saved.originalName, sizeBytes: saved.sizeBytes };
    } finally {
      this.downloading = null;
    }
  }

  /** https GET → Buffer, 跟随最多 3 跳重定向, 超过 maxBytes 立即中止 */
  private fetchBinary(url: string, maxBytes: number, redirects = 3): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 30000 }, (res) => {
        const code = res.statusCode ?? 0;
        if (code >= 300 && code < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          this.fetchBinary(next, maxBytes, redirects - 1).then(resolve, reject);
          return;
        }
        if (code < 200 || code >= 300) {
          res.resume();
          reject(new BadRequestException(`下载失败: 源站返回 HTTP ${code} (现场网络若访问不了 GitHub raw, 可配 FREEPD_MIRROR_PREFIX 镜像前缀)`));
          return;
        }
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (c: Buffer) => {
          total += c.length;
          if (total > maxBytes) {
            req.destroy(new Error('文件超过 40MB 上限'));
            return;
          }
          chunks.push(c);
        });
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('连接源站超时')));
      req.on('error', (e) => reject(new BadRequestException(`下载失败: ${e.message}`)));
    });
  }
}
