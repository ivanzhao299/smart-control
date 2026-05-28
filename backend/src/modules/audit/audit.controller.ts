import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AuditLog } from '../../entities/audit-log.entity';
import { AuditService } from './audit.service';

@Controller('audit-log')
export class AuditController {
  constructor(private readonly service: AuditService) {}

  @Get()
  async list(
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('operator') operator?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const data = await this.service.list({
      entityType,
      entityId,
      action,
      operator,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
    });
    return { message: '查询成功', data: { ...data, list: data.list.map(toViewModel) } };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const row = await this.service.detail(id);
    if (!row) throw new NotFoundException(`audit#${id} 不存在`);
    return { message: '查询成功', data: toViewModel(row) };
  }

  /** 回滚到这条 audit 的 snapshotBefore */
  @Post(':id/rollback')
  async rollback(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.rollback(id);
    return { message: '回滚成功', data };
  }
}

function toViewModel(row: AuditLog) {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    action: row.action,
    operator: row.operator,
    snapshotBefore: row.snapshotBefore ? safeJson(row.snapshotBefore) : null,
    snapshotAfter: row.snapshotAfter ? safeJson(row.snapshotAfter) : null,
    remark: row.remark,
    createdAt: row.createdAt,
  };
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}
