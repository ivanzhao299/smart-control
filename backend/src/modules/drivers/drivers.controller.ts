import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post } from '@nestjs/common';
import type { DriverDescriptor } from '../../adapters/driver-descriptor';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { DriverRegistryService } from './driver-registry.service';

/**
 * 驱动模板浏览 + 管理. P2 收尾 = 只有 list / detail; P4 加 create / delete.
 */
@Controller('drivers')
export class DriversController {
  constructor(private readonly registry: DriverRegistryService) {}

  @Get()
  async list() {
    const rows = await this.registry.list();
    return { message: '查询成功', data: rows.map(toViewModel) };
  }

  @Get(':kind')
  async detail(@Param('kind') kind: string) {
    const row = await this.registry.detail(kind);
    if (!row) throw new NotFoundException(`driver kind=${kind} 不存在`);
    return { message: '查询成功', data: toViewModel(row) };
  }

  /** P4 — UI 创建非 builtin 模板 */
  @Post()
  async create(@Body() body: DriverDescriptor) {
    const row = await this.registry.createNonBuiltin(body);
    return { message: '创建成功', data: toViewModel(row) };
  }

  @Delete(':kind')
  @HttpCode(200)
  async remove(@Param('kind') kind: string) {
    await this.registry.deleteNonBuiltin(kind);
    return { message: '删除成功', data: null };
  }
}

/** DB row → 给前端的格式 (JSON 字段反序列化好) */
function toViewModel(row: DriverTemplate) {
  return {
    kind: row.kind,
    displayName: row.displayName,
    vendor: row.vendor,
    category: row.category,
    protocol: row.protocol,
    capabilities: safeJson<string[]>(row.capabilitiesJson, []),
    defaultAddressing: row.defaultAddressingJson ? safeJson<Record<string, unknown>>(row.defaultAddressingJson, {}) : null,
    paramSchema: row.paramSchemaJson ? safeJson<Record<string, unknown>>(row.paramSchemaJson, {}) : null,
    remark: row.remark,
    builtin: row.builtin,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function safeJson<T>(raw: string | null | undefined, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
