import { Injectable, Logger } from '@nestjs/common';
import { VideoBindingService } from './video-binding.service';

/**
 * AI 检测配置热下发。
 *
 * 后台「视频绑定」里配置的每路计数线 / ROI 区域 / 是否分析，先持久化到
 * RuntimeConfigStore，再由本服务 POST 给独立运行的 AI Python（/api/config）做内存热更新，
 * 全程不重启 AI、不触碰拉子码流 / 转码链路。AI 暂不可达时不阻断保存，只返回告警，
 * 后台可在 AI 恢复后手动「重新下发」。
 */
const AI_BASE = (process.env.AI_ANALYZER_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');

export interface AiPushResult {
  ok: boolean;
  message: string;
  cameras?: number;
}

@Injectable()
export class AiConfigPusher {
  private readonly logger = new Logger(AiConfigPusher.name);

  constructor(private readonly binding: VideoBindingService) {}

  async pushAll(): Promise<AiPushResult> {
    const payload = this.binding.buildAiPayload();
    const count = Object.keys(payload.cameras).length;
    try {
      const r = await fetch(`${AI_BASE}/api/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });
      const text = await r.text().catch(() => '');
      if (!r.ok) {
        this.logger.warn(`AI config 下发失败 HTTP ${r.status}: ${text.slice(0, 200)}`);
        return {
          ok: false,
          message: `AI 服务返回 ${r.status}，配置已保存但未热生效`,
          cameras: count,
        };
      }
      return { ok: true, message: '已热下发到 AI 分析服务', cameras: count };
    } catch (e: any) {
      this.logger.warn(`AI config 下发异常 -> ${AI_BASE}: ${e?.message || e}`);
      return {
        ok: false,
        message: 'AI 服务暂不可达，配置已保存，待其在线后可手动重新下发',
        cameras: count,
      };
    }
  }
}
