import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { AppConfig } from '../../common/config/configuration';
import { AlertService } from '../alerts/alert.service';
import { SystemService } from './system.service';

/**
 * 站点心跳 —— 解决"现场挂了没人知道"。
 *
 * 【为什么不能只在本机加告警】
 * 2026-07-19 GK9000 掉线 14 小时无人知晓。当时就算本机装了告警推送也没用:
 * **整机离线时它自己发不出任何东西**(死人报不了自己的死讯)。所以必须由**外部**
 * 来判定离线 —— 现场定时往云端上报, 云端发现"该来的没来"才报警。
 *
 * 【一个服务两个角色, 靠 env 区分】
 *   现场机 (GK9000): 配 SITE_HEARTBEAT_URL → 每 5 分钟上报一次
 *   云端 (cnjinhu):  配 SITE_WATCHDOG_EXPECT=GK9000 → 每 2 分钟检查, 超 15 分钟没来就告警
 * 两边跑同一份代码, 只是 env 不同; 都不配 = 两个角色都不启用, 零影响。
 *
 * 【为什么用"期望主机名"而不是"见过谁就监控谁"】
 * 云端的心跳记录在内存里, 云端一重启就空了。如果按"见过谁监控谁", 重启后
 * 记录为空 → 什么都不监控 → 现场挂了照样没人知道, 正好在最需要它的时候失灵。
 * 所以改成显式声明"这几台必须在线", 即使从没收到过心跳也照样报警。
 *
 * env:
 *   SITE_HEARTBEAT_URL          现场上报地址 (云端的 /api/system/site-heartbeat)
 *   SITE_HEARTBEAT_INTERVAL_MS  上报间隔, 默认 5 分钟
 *   SITE_WATCHDOG_EXPECT        期望在线的主机名, 逗号分隔 (云端配)
 *   SITE_WATCHDOG_STALE_MS      多久没心跳算离线, 默认 15 分钟 (= 3 个上报周期)
 *   SITE_WATCHDOG_CHECK_MS      检查间隔, 默认 2 分钟
 */
@Injectable()
export class SiteHeartbeatService implements OnModuleInit, OnModuleDestroy {
  // ---- 发送方 (现场机) ----
  private readonly sendUrl = (process.env.SITE_HEARTBEAT_URL ?? '').trim();
  private readonly sendIntervalMs = Number.parseInt(
    process.env.SITE_HEARTBEAT_INTERVAL_MS ?? '300000',
    10,
  );
  private sendTimer?: NodeJS.Timeout;

  // ---- 监控方 (云端) ----
  private readonly expectHosts = (process.env.SITE_WATCHDOG_EXPECT ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  private readonly staleMs = Number.parseInt(process.env.SITE_WATCHDOG_STALE_MS ?? '900000', 10);
  private readonly checkMs = Number.parseInt(process.env.SITE_WATCHDOG_CHECK_MS ?? '120000', 10);
  private checkTimer?: NodeJS.Timeout;
  private readonly startedAt = Date.now();

  constructor(
    private readonly config: ConfigService,
    private readonly system: SystemService,
    private readonly alerts: AlertService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  onModuleInit(): void {
    if (this.sendUrl) {
      // 启动 30s 后先报一次 (让服务先起稳), 之后按周期
      setTimeout(() => void this.sendOnce(), 30_000).unref?.();
      this.sendTimer = setInterval(() => void this.sendOnce(), this.sendIntervalMs);
      this.sendTimer.unref?.();
      this.logger.info(`站点心跳上报已启用 → ${this.sendUrl} (每 ${this.sendIntervalMs / 1000}s)`, {
        context: 'SiteHeartbeatService',
      });
    }

    if (this.expectHosts.length > 0) {
      this.checkTimer = setInterval(() => void this.checkStale(), this.checkMs);
      this.checkTimer.unref?.();
      this.logger.info(
        `站点离线监控已启用: 期望在线 [${this.expectHosts.join(', ')}], 超 ${this.staleMs / 60000} 分钟没心跳即告警`,
        { context: 'SiteHeartbeatService' },
      );
    }
  }

  onModuleDestroy(): void {
    if (this.sendTimer) clearInterval(this.sendTimer);
    if (this.checkTimer) clearInterval(this.checkTimer);
  }

  // ============ 发送方 ============

  /** 上报一次心跳。失败只记日志 —— 上报不通往往正是网络出问题, 不能反过来把自己搞崩 */
  async sendOnce(): Promise<void> {
    if (!this.sendUrl) return;
    try {
      const app = this.config.getOrThrow<AppConfig>('app');
      const meta = this.system.meta();
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 8000);
      try {
        const resp = await fetch(this.sendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            host: app.hostMachine || 'unknown',
            commit: meta.commit ?? undefined,
            ref: meta.ref ?? undefined,
            version: meta.version,
            buildAt: meta.buildTime,
            updatedAt: new Date().toISOString(),
            diagnostics: { uptimeSec: this.system.uptimeSec() },
          }),
          signal: ctrl.signal,
        });
        if (!resp.ok) {
          this.logger.warn(`站点心跳上报失败: HTTP ${resp.status}`, {
            context: 'SiteHeartbeatService',
          });
        }
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      this.logger.warn(`站点心跳上报异常: ${(err as Error).message}`, {
        context: 'SiteHeartbeatService',
      });
    }
  }

  // ============ 监控方 ============

  /** 检查期望在线的站点是否失联; 失联报警, 恢复自动消警 */
  async checkStale(): Promise<void> {
    try {
      // 启动宽限期: 刚起来时还没来得及收心跳, 别误报
      if (Date.now() - this.startedAt < this.staleMs) return;

      const all = this.system.listSiteHeartbeats();
      for (const host of this.expectHosts) {
        const hb = all.find((h) => h.host === host);
        const lastAt = hb?.receivedAt ? Date.parse(hb.receivedAt) : NaN;
        const ageMs = Number.isFinite(lastAt) ? Date.now() - lastAt : Number.POSITIVE_INFINITY;
        const offline = ageMs > this.staleMs;

        if (offline) {
          const ageText = Number.isFinite(ageMs)
            ? `${Math.round(ageMs / 60000)} 分钟`
            : '从未收到过心跳';
          await this.alerts.create({
            level: 'critical',
            type: 'site_offline',
            sourceType: 'site',
            sourceId: host,
            title: `现场主机失联: ${host}`,
            message: `已 ${ageText}没有收到心跳 (阈值 ${Math.round(this.staleMs / 60000)} 分钟)。可能原因: 断电 / 断网 / 主机死机 / WireGuard 隧道断开。`,
            dedupe: true,
          });
        } else {
          // 恢复了就自动消警 (只消这一类, 不动别的告警)
          await this.alerts.autoResolveBySource('site', host, 'site_offline');
        }
      }
    } catch (err) {
      this.logger.warn(`站点离线检查异常: ${(err as Error).message}`, {
        context: 'SiteHeartbeatService',
      });
    }
  }
}
