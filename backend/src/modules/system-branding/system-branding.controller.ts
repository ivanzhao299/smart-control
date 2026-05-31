import { BadRequestException, Body, Controller, Get, Put, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { SystemBrandingDto, SystemBrandingService } from './system-branding.service';
import { AdminGuard } from '../admin-auth/admin-auth.guard';

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
  @Get('manifest.webmanifest')
  async manifest(@Res() res: Response): Promise<void> {
    const b = await this.service.get();
    const logoUrl = b.logoUrl ?? '/control/icons/pwa-512x512.png';
    const manifest = {
      name: b.systemName ?? '金湖展贸中心智能控制系统',
      short_name: b.logoText ?? b.systemName ?? '金湖中控',
      description: b.systemSubtitle ?? '智慧展厅中控',
      theme_color: '#0A0E1F',
      background_color: '#060818',
      display: 'fullscreen',
      orientation: 'landscape',
      start_url: '/control/',
      scope: '/control/',
      icons: [
        { src: logoUrl, sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
        { src: logoUrl, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        { src: logoUrl, sizes: 'any', type: 'image/png', purpose: 'any maskable' },
      ],
    };
    // 用 res.send() 自己控制 — 绕开 ResponseInterceptor 的 {success, data} 包装,
    // 因为 manifest 必须是裸 JSON. Cache-Control no-cache 让浏览器/SW 总取最新.
    res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(JSON.stringify(manifest));
  }
}
