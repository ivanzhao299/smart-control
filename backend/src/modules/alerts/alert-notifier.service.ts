import { Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { AlertLevel } from '../../entities/alert.entity';

/**
 * 告警外发 —— 把告警推到人眼前。
 *
 * 为什么必须有: 在此之前告警只写进 SQLite、在后台界面上显示。**没人盯着界面,
 * 就等于没有告警**。2026-07-19 GK9000 掉线 14 小时无人知晓、7-17 服务死 11 小时
 * 才被发现, 根因都不是"没检测到", 而是"检测到了送不出去"。
 *
 * 配置 (全部可选, 不配 = 静默关闭, 不影响任何主流程):
 *   ALERT_WEBHOOK_URL        接收地址。企业微信/钉钉群机器人、Server酱、自建接口都行
 *   ALERT_WEBHOOK_FORMAT     wecom(默认, 企业微信 markdown) | dingtalk | raw(结构化 JSON)
 *   ALERT_WEBHOOK_MIN_LEVEL  最低推送级别, 默认 warning (info 级不推, 免得刷屏)
 *   ALERT_WEBHOOK_THROTTLE_MS 同一来源同一类型的最短推送间隔, 默认 10 分钟
 *   ALERT_WEBHOOK_SITE       站点名, 多场馆时区分是哪个展厅报的
 *
 * 设计约束:
 *   - fire-and-forget: 推送失败**绝不能**影响告警落库和主流程 (推送是附加能力)
 *   - 节流: 同一故障反复触发时不刷屏, 但级别升高会突破节流
 *   - 超时: 5s 掐断, 不能让一个卡住的 webhook 拖住告警写入
 */

const LEVEL_RANK: Record<AlertLevel, number> = {
  info: 0,
  warning: 1,
  critical: 2,
  emergency: 3,
};

export interface NotifyPayload {
  level: AlertLevel;
  type: string;
  sourceType: string;
  sourceId?: string | null;
  title: string;
  message?: string | null;
  at?: string;
}

@Injectable()
export class AlertNotifierService {
  private readonly url = (process.env.ALERT_WEBHOOK_URL ?? '').trim();
  private readonly format = (process.env.ALERT_WEBHOOK_FORMAT ?? 'wecom').trim().toLowerCase();
  private readonly site = (process.env.ALERT_WEBHOOK_SITE ?? '金湖展贸中心').trim();
  private readonly minLevel = this.parseLevel(process.env.ALERT_WEBHOOK_MIN_LEVEL, 'warning');
  private readonly throttleMs = Number.parseInt(
    process.env.ALERT_WEBHOOK_THROTTLE_MS ?? '600000',
    10,
  );
  private readonly timeoutMs = 5000;

  /** key = sourceType|sourceId|type → { at, level } 上次推送时刻与级别 */
  private readonly lastSent = new Map<string, { at: number; level: AlertLevel }>();

  constructor(@Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger) {
    if (this.url) {
      this.logger.info(
        `告警外发已启用 (format=${this.format} minLevel=${this.minLevel} throttle=${this.throttleMs}ms)`,
        { context: 'AlertNotifierService' },
      );
    } else {
      this.logger.warn(
        '告警外发未配置 (ALERT_WEBHOOK_URL 为空) —— 告警只会留在后台界面, 没人看就等于没有',
        { context: 'AlertNotifierService' },
      );
    }
  }

  get enabled(): boolean {
    return this.url.length > 0;
  }

  /**
   * 推送一条告警。**不 await 也可以** —— 内部自己吞异常, 绝不向上抛。
   */
  async notify(payload: NotifyPayload): Promise<void> {
    try {
      if (!this.url) return;
      if (LEVEL_RANK[payload.level] < LEVEL_RANK[this.minLevel]) return;
      if (this.isThrottled(payload)) return;

      const body = this.buildBody(payload);
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
      try {
        const resp = await fetch(this.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });
        if (!resp.ok) {
          this.logger.warn(`告警外发失败: HTTP ${resp.status}`, {
            context: 'AlertNotifierService',
          });
          return;
        }
        this.markSent(payload);
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      // 推送失败绝不能影响告警本身 —— 只记一行日志
      this.logger.warn(`告警外发异常: ${(err as Error).message}`, {
        context: 'AlertNotifierService',
      });
    }
  }

  // ============ 内部 ============

  private parseLevel(v: string | undefined, fallback: AlertLevel): AlertLevel {
    const s = (v ?? '').trim().toLowerCase();
    return (['info', 'warning', 'critical', 'emergency'] as AlertLevel[]).includes(s as AlertLevel)
      ? (s as AlertLevel)
      : fallback;
  }

  private keyOf(p: NotifyPayload): string {
    return `${p.sourceType}|${p.sourceId ?? '-'}|${p.type}`;
  }

  /** 同一故障短时间内反复触发不刷屏; 但级别升高 (warning→critical) 立即放行 */
  private isThrottled(p: NotifyPayload): boolean {
    if (!Number.isFinite(this.throttleMs) || this.throttleMs <= 0) return false;
    const prev = this.lastSent.get(this.keyOf(p));
    if (!prev) return false;
    if (LEVEL_RANK[p.level] > LEVEL_RANK[prev.level]) return false; // 恶化了, 必须报
    return Date.now() - prev.at < this.throttleMs;
  }

  private markSent(p: NotifyPayload): void {
    this.lastSent.set(this.keyOf(p), { at: Date.now(), level: p.level });
    // 防止长期运行后 map 无限增长 (来源基数本来就有限, 保险起见设上限)
    if (this.lastSent.size > 500) {
      const oldest = [...this.lastSent.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (oldest) this.lastSent.delete(oldest[0]);
    }
  }

  private levelIcon(level: AlertLevel): string {
    switch (level) {
      case 'emergency': return '🚨';
      case 'critical': return '🔴';
      case 'warning': return '🟠';
      default: return 'ℹ️';
    }
  }

  private buildBody(p: NotifyPayload): unknown {
    const at = p.at ?? new Date().toISOString();
    const localTime = new Date(at).toLocaleString('zh-CN', { hour12: false });
    const icon = this.levelIcon(p.level);
    const source = p.sourceId ? `${p.sourceType}/${p.sourceId}` : p.sourceType;

    if (this.format === 'raw') {
      return { site: this.site, ...p, at };
    }

    const text = [
      `${icon} **${this.site} · ${p.title}**`,
      `> 级别: ${p.level}`,
      `> 来源: ${source}`,
      `> 类型: ${p.type}`,
      p.message ? `> 详情: ${p.message}` : '',
      `> 时间: ${localTime}`,
    ]
      .filter(Boolean)
      .join('\n');

    if (this.format === 'dingtalk') {
      return { msgtype: 'markdown', markdown: { title: `${this.site} 告警`, text } };
    }
    // 默认企业微信群机器人
    return { msgtype: 'markdown', markdown: { content: text } };
  }
}
