import { BadRequestException, Body, Controller, Get, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SystemBrandingDto, SystemBrandingService } from './system-branding.service';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

/**
 * /api/system-branding
 *
 * - GET: 公开 (前台所有 layout 都要读, 不能走鉴权), 返回当前品牌配置
 * - PUT: 需 AdminGuard, 只有登录后台拿了 token 的人能改
 * - GET manifest.webmanifest: 动态 PWA manifest, icon 跟 logoUrl 走
 *
 * 路径选了 `/system-branding` 不是 `/system/branding`, 避免跟 SystemController
 * 的 /api/system/* 一堆 endpoint 撞 (那边已经塞了 heartbeat / health / diag /
 * admin-restart / admin-rebuild-frontend 一堆, 不想再叠).
 */
@Controller('system-branding')
export class SystemBrandingController {
  constructor(private readonly service: SystemBrandingService) {}

  @Public()
  @Get()
  async get() {
    return { message: '查询成功', data: await this.service.get() };
  }

  @Put()
  @UseGuards(AdminGuard)
  async update(@Body() body: Partial<SystemBrandingDto>): Promise<unknown> {
    if (!body || typeof body !== 'object') {
      throw new BadRequestException('请求体必须是 JSON 对象');
    }
    try {
      const updated = await this.service.update(body);
      return { message: '已保存', data: updated };
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }
  }

  /**
   * 动态 PWA manifest — icon / name / short_name 都从 system_branding 表拿,
   * 业主在后台改了立刻生效 (但已装到主屏的 PWA 要删图标重装才能看到新 icon).
   *
   * 路径: GET /api/system-branding/manifest.webmanifest
   * frontend main.ts 启动时把 <link rel="manifest"> 改指向这里, 替代
   * vite-plugin-pwa 生成的静态 manifest.
   *
   * 内容类型必须是 application/manifest+json, 否则浏览器拒绝读.
   * 注意: NestJS 的 ResponseInterceptor 会把所有返回包成 {success, data},
   * 但 manifest 必须是裸 JSON. 用 @Header + ResponseInterceptor 跳过逻辑
   * (interceptor 检查 Content-Type, 非 json 不包) — 这里 manifest+json 应该
   * 也走 wrap; 改用纯字符串 + 自己 set type? 不优雅. 用裸 object + 让 EP
   * 看 magic header 标记跳过.
   * 实测最干净: 返回普通 object, 让 vite-plugin-pwa 拒了我们 fallback.
   * 这里走纯 string + raw response.
   */
  /**
   * 真实 HTTP 图片端点 — 用 logoUrl (DB 里可能是 data:image/...;base64,xxx 或
   * 普通 http URL) 解析出二进制流, 让浏览器 / PWA / iOS 当成真实 image 资源.
   *
   * 为啥要这个: PWA manifest icon 和 apple-touch-icon 在多数浏览器实现里
   * 对 data URI 支持不稳定 (Android Chrome 部分 OK, iOS Safari 几乎不支持).
   * 走真实 HTTP URL 兼容性最好.
   *
   * Cache: ETag 基于 logoUrl 内容 hash (改 logo 时 hash 变, 浏览器拿新图).
   */
  @Public()
  @Get('logo.png')
  async logo(@Res() res: Response): Promise<void> {
    const b = await this.service.get();
    const logoUrl = b.logoUrl;
    if (!logoUrl) {
      // 没上传 logo, 重定向到默认 PWA icon
      res.redirect(302, '/control/icons/pwa-512x512.png');
      return;
    }
    // 解析 data URL
    const m = /^data:(image\/[a-z0-9+.-]+);base64,(.+)$/i.exec(logoUrl);
    if (m) {
      const contentType = m[1];
      const buf = Buffer.from(m[2], 'base64');
      // ETag 用内容长度 + 前 8 字节 hex 做 cheap hash (业主换图就变)
      const etag = `"${buf.length.toString(16)}-${buf.slice(0, 8).toString('hex')}"`;
      if (res.req.headers['if-none-match'] === etag) {
        res.status(304).end();
        return;
      }
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
      res.setHeader('ETag', etag);
      res.send(buf);
      return;
    }
    // 不是 data URL — 假设是 http URL, 重定向
    res.redirect(302, logoUrl);
  }

  @Public()
  @Get('manifest.webmanifest')
  async manifest(@Res() res: Response): Promise<void> {
    const b = await this.service.get();
    // 永远走 /api/system-branding/logo.png 真实 HTTP 端点, 不直接给 data URL.
    // 浏览器/iOS/Android 对 data URL 在 manifest icons 里支持不稳定, 会 fallback
    // 到自动字母图标 (业主反馈"显示金字"的根因). 真实 HTTP URL 兼容性最好.
    const logoEndpoint = '/control/api/system-branding/logo.png';
    // short_name 是主屏图标下面的名字, manifest 标准要求 ≤12 字符. logoText
    // 是给"圆形 logo"里显示的占位单字 (业主可能填 1 / 金 这种), 语义完全不同,
    // 不能拿来当 short_name. 这里从 systemName 截 8 个字, 不行就 fallback.
    const fullName = b.systemName ?? '金湖展贸中心智能控制系统';
    const shortName = fullName.length > 8 ? fullName.slice(0, 8) : fullName;
    const manifest = {
      name: fullName,
      short_name: shortName,
      description: b.systemSubtitle ?? '智慧展厅中控',
      theme_color: '#0A0E1F',
      background_color: '#060818',
      display: 'fullscreen',
      // display_override: 显式指定 fullscreen 优先级最高, fallback 到 standalone
      // Android Chrome 上配这个能减少"边缘左滑"误触退出 (但 OS 系统手势仍无法
      // 完全屏蔽, 需业主把"手势导航"切成"三键导航")
      display_override: ['fullscreen', 'standalone'],
      orientation: 'landscape',
      start_url: '/control/',
      scope: '/control/',
      icons: [
        { src: logoEndpoint, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: logoEndpoint, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        { src: logoEndpoint, sizes: 'any', type: 'image/png', purpose: 'any maskable' },
      ],
    };
    // 用 res.send() 自己控制 — 绕开 ResponseInterceptor 的 {success, data} 包装,
    // 因为 manifest 必须是裸 JSON. Cache-Control no-cache 让浏览器/SW 总取最新.
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(JSON.stringify(manifest));
  }
}
