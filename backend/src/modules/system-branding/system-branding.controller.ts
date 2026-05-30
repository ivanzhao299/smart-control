import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { SystemBrandingDto, SystemBrandingService } from './system-branding.service';

/**
 * /api/system-branding
 *
 * - GET: 公开 (前台所有 layout 都要读, 不能走鉴权), 返回当前品牌配置
 * - PUT: 后台调用 (现阶段没有 admin auth 中间件, 跟其他 admin 接口一个粒度)
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
}
