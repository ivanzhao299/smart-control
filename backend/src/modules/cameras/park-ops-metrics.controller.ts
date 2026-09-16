import { BadRequestException, Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { readFileSync, writeFileSync, existsSync, renameSync, copyFileSync, rmSync } from 'fs';
import { join } from 'path';
import { Public } from '../../common/decorators/public.decorator';
import { ensureRuntimeDataDir } from '../../common/storage/runtime-data-path';
import { AdminGuard } from '../admin-auth/admin-auth.guard';

/**
 * 运营大屏「业务数字文档」共享存储 —— 刻意用 JSON 文件而非数据库表,
 * 不新增 TypeORM 迁移, 从而绕开受控迁移门禁 (本字段是纯展示层业务数据)。
 *
 * 文档结构与 frontend/public/park-ops/ops-data-model.mjs 对齐:
 *   { version:1, source, updatedAt(ISO), placeholderKeys:string[],
 *     metrics:{ [key]: number|null }, content:{ [key]: string|string[] } }
 *
 * - GET  /api/park-ops-metrics   @Public  大屏/校准器轮询读取; 从未保存时 data:null, 前端回退内置默认
 * - PUT  /api/park-ops-metrics   AdminGuard 仅 PWA 后台管理员可写 (手机端"运营数据"卡片)
 *
 * 写入为原子写 (tmp → rename), 覆盖前在同目录留一份 .bak; 后端只做结构与边界的
 * 安全校验, 业务强校验 (整数/百分比/产业结构合计=100 等) 由前端共用的 validate 负责。
 */
@Controller('park-ops-metrics')
export class ParkOpsMetricsController {
  private readonly filePath: string;
  private readonly bakPath: string;
  private static readonly MAX_BYTES = 256 * 1024;
  private static readonly KEY_RE = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

  constructor() {
    const dataDir = ensureRuntimeDataDir();
    this.filePath = join(dataDir, 'park-ops-metrics.json');
    this.bakPath = `${this.filePath}.bak`;
  }

  @Public()
  @Get()
  get(): { success: boolean; data: unknown } {
    return { success: true, data: this.read() };
  }

  @Put()
  @UseGuards(AdminGuard)
  update(@Body() body: unknown): { success: boolean; message: string; data: unknown } {
    let doc: Record<string, unknown>;
    try {
      doc = this.normalize(body);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
    this.writeAtomic(doc);
    return { success: true, message: '运营数据已保存并发布到运营大屏', data: doc };
  }

  private read(): unknown {
    for (const candidate of [this.filePath, this.bakPath]) {
      if (!existsSync(candidate)) continue;
      try {
        return JSON.parse(readFileSync(candidate, 'utf-8'));
      } catch {
        // Try the verified previous copy before falling back to built-in data.
      }
    }
    return null;
  }

  private writeAtomic(doc: Record<string, unknown>): void {
    const payload = JSON.stringify(doc);
    if (existsSync(this.filePath)) {
      try {
        JSON.parse(readFileSync(this.filePath, 'utf-8'));
        copyFileSync(this.filePath, this.bakPath);
      } catch {
        // Never replace a valid backup with a corrupt primary.
      }
    }
    const tmp = `${this.filePath}.tmp`;
    try {
      writeFileSync(tmp, payload, { encoding: 'utf-8', flush: true });
      renameSync(tmp, this.filePath);
    } finally {
      rmSync(tmp, { force: true });
    }
  }

  private asRecord(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`${name} 必须是对象`);
    }
    return value as Record<string, unknown>;
  }

  private normalize(input: unknown): Record<string, unknown> {
    const raw = this.asRecord(input, '文档');
    if (raw.version !== 1) throw new Error('仅支持 version=1 的运营数据文档');

    const serialized = JSON.stringify(input);
    if (Buffer.byteLength(serialized, 'utf8') > ParkOpsMetricsController.MAX_BYTES) {
      throw new Error('运营数据不能超过 256 KB');
    }
    // 深拷贝剥离原型链
    const cloned = JSON.parse(serialized) as Record<string, unknown>;

    const source = cloned.source;
    if (typeof source !== 'string' || !source.trim() || source.length > 200) {
      throw new Error('数据来源必填且不超过 200 字');
    }
    const updatedAt = cloned.updatedAt;
    if (typeof updatedAt !== 'string' || !Number.isFinite(Date.parse(updatedAt))) {
      throw new Error('数据日期无效');
    }

    const placeholderRaw = cloned.placeholderKeys;
    if (!Array.isArray(placeholderRaw) || placeholderRaw.length > 200) {
      throw new Error('占位标记必须是不超过 200 项的列表');
    }
    const placeholderKeys = placeholderRaw.map((key) => {
      if (typeof key !== 'string' || !ParkOpsMetricsController.KEY_RE.test(key)) {
        throw new Error('占位标记含非法字段名');
      }
      return key;
    });

    const metricsRaw = this.asRecord(cloned.metrics, 'metrics');
    const metricKeys = Object.keys(metricsRaw);
    if (metricKeys.length > 200) throw new Error('指标数量不能超过 200');
    const metrics: Record<string, number | null> = {};
    for (const key of metricKeys) {
      if (!ParkOpsMetricsController.KEY_RE.test(key)) throw new Error(`非法指标名: ${key}`);
      const value = metricsRaw[key];
      if (value === null) {
        metrics[key] = null;
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e9) {
        throw new Error(`指标 ${key} 必须是 0–1e9 的非负数字或留空`);
      }
      metrics[key] = value;
    }

    const contentRaw = this.asRecord(cloned.content, 'content');
    const contentKeys = Object.keys(contentRaw);
    if (contentKeys.length > 100) throw new Error('文案数量不能超过 100');
    const content: Record<string, string | string[]> = {};
    for (const key of contentKeys) {
      if (!ParkOpsMetricsController.KEY_RE.test(key)) throw new Error(`非法文案名: ${key}`);
      const value = contentRaw[key];
      if (typeof value === 'string') {
        if (value.length > 2000) throw new Error(`文案 ${key} 不能超过 2000 字`);
        content[key] = value;
      } else if (Array.isArray(value) && value.length <= 100 && value.every((x) => typeof x === 'string' && x.length <= 200)) {
        content[key] = value as string[];
      } else {
        throw new Error(`文案 ${key} 必须是文字或文字列表`);
      }
    }

    return { version: 1, source: source.trim(), updatedAt, placeholderKeys, metrics, content };
  }
}
