import { Controller, Get, Param, Res, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';

/**
 * AI 视频分析服务同源代理。
 *
 * 背景：AI 分析器是独立 Python 服务（FastAPI，默认 127.0.0.1:8000）。此前运营大屏把
 * AI_API_BASE 写死成 http://localhost:8000，导致：① 只有在 GK9000 本机打开大屏才取得到，
 * 本地开发 / 其它主机访问时检测数据与框线为空；② 浏览器直连第二源，不利于统一链路。
 *
 * 这里在后端把 /api/ai/{health,stats,detections} 同源反代到分析器的 /api/*。
 * 目标地址可用环境变量 AI_ANALYZER_URL 覆盖：本地开发时经 SSH 隧道把 GK 的 8000
 * 转到本机，再让该变量指向隧道口，即可在本地看到实时检测框。
 */
const AI_BASE = (process.env.AI_ANALYZER_URL || 'http://127.0.0.1:8000').replace(/\/+$/, '');
const ALLOWED = new Set(['health', 'stats', 'detections']);

@Public() // 大屏匿名可读（仅三个只读接口，且控制器内另有白名单限定）
@Controller('ai')
export class AiProxyController {
  private readonly logger = new Logger(AiProxyController.name);

  @Get(':name')
  async proxy(@Param('name') name: string, @Res() res: Response): Promise<void> {
    // 白名单：只反代这三个只读接口，避免变成开放代理
    if (!ALLOWED.has(name)) {
      res.status(404).json({ error: 'ai_endpoint_not_found' });
      return;
    }
    const url = `${AI_BASE}/api/${name}`;
    try {
      const upstream = await fetch(url, { signal: AbortSignal.timeout(6000) });
      const text = await upstream.text();
      res.status(upstream.status);
      res.type('application/json; charset=utf-8');
      res.send(text);
    } catch (e) {
      this.logger.warn(`AI 代理 /${name} 失败 -> ${url}: ${(e as Error).message}`);
      res.status(502).json({ error: 'ai_unreachable', path: name });
    }
  }
}
