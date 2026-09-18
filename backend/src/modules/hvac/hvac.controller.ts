import { ActorAdminGuard } from '../../common/guards/actor-admin.guard';
import {
  BadRequestException,
  ConflictException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { HvacAdapter } from '../../adapters/hvac/hvac.adapter';
import { ModbusHvacAdapter } from '../../adapters/hvac/modbus-hvac.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import {
  HvacAssignDto,
  HvacBatchFanDto,
  HvacBatchModeDto,
  HvacBatchTargetDto,
  HvacBatchTempDto,
  HvacFanDto,
  HvacIndoorUpdateDto,
  HvacModeDto,
  HvacTempDto,
  HvacZoneCreateDto,
  HvacReorderDto,
  HvacZoneRevisionQueryDto,
  HvacZoneRenameDto,
} from './dto/hvac.dto';
import { AdapterResult } from '../../adapters/adapter.types';
import { HvacZone } from '../../entities/hvac-zone.entity';
import { HvacIndoor } from '../../entities/hvac-indoor.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import type { Actor, AuthenticatedRequest } from '../../common/auth/actor';
import { requireAdmin } from '../../common/auth/actor';
import { serializedTransaction } from '../../common/utils/serialized-transaction';

// 温度按 +/- 步进调, 6 次/秒/客户端
@Controller('hvac')
@UseGuards(RateLimitGuard)
@RateLimit({ max: 6, windowMs: 1000 })
export class HvacController {
  constructor(
    private readonly hvac: HvacAdapter,
    private readonly modbusHvac: ModbusHvacAdapter,
    private readonly logService: OperationLogService,
    @InjectRepository(HvacZone) private readonly zoneRepo: Repository<HvacZone>,
    @InjectRepository(HvacIndoor) private readonly indoorRepo: Repository<HvacIndoor>,
  ) {}

  // ============ 内机 (一等公民: 单机测试 + 改名 + 编组) ============

  /**
   * 列出所有内机 — PWA 空调页的主数据.
   *
   * 每台内机带自己的名字和归属组。前端据此既能单机控制, 也能按组/楼层/全部
   * 批量控制 (选中集合 → 同一条控制条下发)。
   */
  @Get('indoors')
  async listIndoors() {
    const rows = await this.listEnabledIndoors();
    return {
      message: 'OK',
      data: rows.map((i) => ({
        idx: i.idx,
        configRevision: i.configRevision,
        name: i.name,
        floor: i.floor,
        zoneCode: i.zoneCode,
        model: i.model ?? undefined,
      })),
    };
  }

  /**
   * 所有内机的**真实状态** — PWA 空调页轮询这个.
   *
   * 不合并进 GET /indoors: 那边是配置 (名字/归属, 很少变), 这边是每几秒要刷的
   * 实时量, 合在一起会让每次轮询都白读一遍配置。
   *
   * 读不到的内机**不出现在结果里**, 前端显示"未知" —— 不能拿"读不到"当"关机",
   * 那会让人以为空调是关的而实际在跑。
   */
  @Get('states')
  async listStates() {
    const rows = await this.listEnabledIndoors();
    const states = await this.hvac.readAllStates(rows.map((r) => r.idx));
    return {
      message: 'OK',
      data: rows.map((r) => {
        const s = states.get(r.idx);
        return s
          ? {
              idx: r.idx,
              known: true,
              on: s.on,
              mode: s.mode,
              temperature: s.temperature,
              fan: s.fan,
              roomTemp: s.roomTemp,
              online: s.online,
              faultCode: s.faultCode ?? 0,
            }
          : { idx: r.idx, known: false };
      }),
    };
  }

  /**
   * 内机拖动排序 (业主: "空调内机的位置可以拖动")。传全量有序 idx 列表, 按顺序写
   * sortOrder (只动显示顺序, 不碰 idx —— idx 是场景/下发的口径, 不能变)。
   *
   * **必须声明在 @Put('indoors/:idx') 之前** —— Nest 按声明顺序匹配, 放后面的话
   * 'reorder' 会先落到 :idx 上被 ParseIntPipe 拒掉 400 (light-zones / playlist 都
   * 踩过这个坑)。排序存后端: 现场主控机+平板+手机, 只存前端每台顺序都不一样。
   */
  @Put('indoors/reorder')
  @UseGuards(ActorAdminGuard)
  @RateLimit({ max: 20, windowMs: 5000 })
  async reorderIndoors(@Body() dto: HvacReorderDto, @Req() req: AuthenticatedRequest) {
    const actor = requireAdmin(req);
    const count = await serializedTransaction(this.indoorRepo.manager.connection, async (manager) => {
      const repo = manager.getRepository(HvacIndoor);
      const ids = Array.from(new Set(dto.idxs));
      const rows = await repo.find({ where: { idx: In(ids) } });
      if (rows.length !== ids.length) throw new NotFoundException('部分选中的内机不存在');
      for (const row of rows) this.assertRevision(row.configRevision, dto.expectedRevisions[String(row.idx)], 'HVAC_INDOOR_REVISION_CONFLICT');
      const byIdx = new Map(rows.map((r) => [r.idx, r]));
      let changed = 0;
      for (let i = 0; i < dto.idxs.length; i += 1) {
        const row = byIdx.get(dto.idxs[i]);
        if (!row) continue;
        const nextOrder = (i + 1) * 10;
        if (row.sortOrder === nextOrder) continue;
        const before = { ...row };
        const result = await repo.update({ id: row.id, configRevision: row.configRevision }, { sortOrder: nextOrder, configRevision: row.configRevision + 1 });
        if (result.affected !== 1) throw this.revisionConflict('HVAC_INDOOR_REVISION_CONFLICT');
        const saved = await repo.findOneByOrFail({ id: row.id });
        await this.writeAudit(manager, 'hvac_indoor', row.id, 'update', before, saved, actor, 'hvac-indoor:reorder');
        changed += 1;
      }
      return changed;
    });
    return { message: '顺序已保存', data: { count } };
  }

  /**
   * 改内机的名字 / 归属组 — 业主在 PWA 直接改, 不用进后台, 更不用改代码.
   * PUT /api/hvac/indoors/:idx  { name?, zoneCode? }
   */
  @Put('indoors/:idx')
  @UseGuards(ActorAdminGuard)
  @RateLimit({ max: 20, windowMs: 5000 })
  async updateIndoor(@Param('idx', ParseIntPipe) idx: number, @Body() dto: HvacIndoorUpdateDto, @Req() req: AuthenticatedRequest) {
    const actor = requireAdmin(req);
    const saved = await serializedTransaction(this.indoorRepo.manager.connection, async (manager) => {
      const repo = manager.getRepository(HvacIndoor);
      const indoor = await repo.findOne({ where: { idx } });
      if (!indoor) throw new NotFoundException(`内机序号 ${idx} 不存在`);
      this.assertRevision(indoor.configRevision, dto.expectedRevision, 'HVAC_INDOOR_REVISION_CONFLICT');
      const before = { ...indoor };
      if (dto.name !== undefined) indoor.name = dto.name.trim();
      if (dto.zoneCode !== undefined) indoor.zoneCode = await this.normalizeZoneCode(dto.zoneCode, manager);
      if (JSON.stringify(before) === JSON.stringify(indoor)) return indoor;
      const result = await repo.update(
        { id: indoor.id, configRevision: dto.expectedRevision },
        { name: indoor.name, zoneCode: indoor.zoneCode, configRevision: dto.expectedRevision + 1 },
      );
      if (result.affected !== 1) throw this.revisionConflict('HVAC_INDOOR_REVISION_CONFLICT');
      const next = await repo.findOneByOrFail({ id: indoor.id });
      await this.writeAudit(manager, 'hvac_indoor', indoor.id, 'update', before, next, actor, 'hvac-indoor:update');
      return next;
    });

    await this.logService.record({
      operator: actor.username,
      action: 'hvac.indoor.update',
      targetType: 'hvac-indoor',
      targetId: String(idx),
      result: 'success',
      message: JSON.stringify({ to: { name: saved.name, zoneCode: saved.zoneCode } }),
    });
    return {
      message: '已保存',
      data: {
        idx: saved.idx,
        configRevision: saved.configRevision,
        name: saved.name,
        floor: saved.floor,
        zoneCode: saved.zoneCode,
        model: saved.model ?? undefined,
      },
    };
  }

  /**
   * 批量改归属: 选中的几台一次划进某个组 (zoneCode 传空 = 移出分组).
   * POST /api/hvac/indoors/assign  { indoors: [1,2,3], zoneCode: 'meeting_room' }
   */
  @Post('indoors/assign')
  @UseGuards(ActorAdminGuard)
  @RateLimit({ max: 20, windowMs: 5000 })
  async assignIndoors(@Body() dto: HvacAssignDto, @Req() req: AuthenticatedRequest) {
    const actor = requireAdmin(req);
    const { zoneCode, count } = await serializedTransaction(this.indoorRepo.manager.connection, async (manager) => {
      const repo = manager.getRepository(HvacIndoor);
      const zoneCode = await this.normalizeZoneCode(dto.zoneCode, manager);
      const ids = Array.from(new Set(dto.indoors));
      const rows = await repo.find({ where: { idx: In(ids) } });
      if (rows.length !== ids.length) throw new NotFoundException('部分选中的内机不存在');
      for (const row of rows) this.assertRevision(row.configRevision, dto.expectedRevisions[String(row.idx)], 'HVAC_INDOOR_REVISION_CONFLICT');
      let changed = 0;
      for (const row of rows) {
        if (row.zoneCode === zoneCode) continue;
        const before = { ...row };
        const result = await repo.update({ id: row.id, configRevision: row.configRevision }, { zoneCode, configRevision: row.configRevision + 1 });
        if (result.affected !== 1) throw this.revisionConflict('HVAC_INDOOR_REVISION_CONFLICT');
        const next = await repo.findOneByOrFail({ id: row.id });
        await this.writeAudit(manager, 'hvac_indoor', row.id, 'update', before, next, actor, 'hvac-indoor:assign-zone');
        changed += 1;
      }
      return { zoneCode, count: changed };
    });

    await this.logService.record({
      operator: actor.username,
      action: 'hvac.indoor.assign',
      targetType: 'hvac-indoor',
      targetId: dto.indoors.join(','),
      result: 'success',
      message: JSON.stringify({ indoors: dto.indoors, zoneCode, count }),
    });
    return { message: zoneCode ? '已归组' : '已移出分组', data: { count, zoneCode } };
  }

  /** 组 code 校验: 空 → null (未分组); 非空必须是已存在的组, 否则会造出指向虚空的孤儿 */
  private async normalizeZoneCode(raw: string | null | undefined, manager?: EntityManager): Promise<string | null> {
    const code = (raw ?? '').trim();
    if (!code) return null;
    const zone = await (manager?.getRepository(HvacZone) ?? this.zoneRepo).findOne({ where: { code } });
    if (!zone) throw new NotFoundException(`功能区 "${code}" 不存在`);
    return zone.code;
  }

  private assertRevision(actual: number, expected: number, code: string): void {
    if (!Number.isSafeInteger(expected) || expected < 1 || actual !== expected) throw this.revisionConflict(code);
  }

  private revisionConflict(code: string): ConflictException {
    return new ConflictException({ code, message: '空调配置已被其他管理员修改，请重新读取后再保存' });
  }

  private async writeAudit(
    manager: EntityManager, entityType: 'hvac_zone' | 'hvac_indoor', entityId: number,
    action: 'create' | 'update' | 'delete', before: unknown, after: unknown, actor: Actor, remark: string,
  ): Promise<void> {
    await manager.insert(AuditLog, {
      entityType, entityId: String(entityId), action, operator: actor.username,
      snapshotBefore: before == null ? null : JSON.stringify(before),
      snapshotAfter: after == null ? null : JSON.stringify(after), remark,
    });
  }

  /** 运行时只读权威目录；新安装默认值由版本化迁移建立。 */
  private listEnabledIndoors(): Promise<HvacIndoor[]> {
    return this.indoorRepo.find({
      where: { enabled: true },
      order: { floor: 'ASC', sortOrder: 'ASC', idx: 'ASC' },
    });
  }

  // ============ 功能区 (只是个名字 + 楼层; 成员关系存在内机那边) ============

  /**
   * 列出所有功能区. indoors 成员**从 hvac_indoor.zoneCode 反查**, 不再读
   * hvac_zone.indoors 那个 JSON 列 —— 那列是老设计的遗留, 已不参与任何逻辑.
   */
  @Get('zones')
  async listZones() {
    const [rows, indoors] = await Promise.all([
      this.listEnabledZones(),
      this.listEnabledIndoors(),
    ]);
    return {
      message: 'OK',
      data: rows.map((z) => ({
        code: z.code,
        configRevision: z.configRevision,
        name: z.name,
        floor: z.floor as '1F' | '2F',
        indoors: indoors.filter((i) => i.zoneCode === z.code).map((i) => i.idx),
        desc: z.description ?? undefined,
      })),
    };
  }

  /**
   * 新建功能区 — 业主在 PWA 直接建.
   * POST /api/hvac/zones  { name, floor }
   */
  @Post('zones')
  @UseGuards(ActorAdminGuard)
  @RateLimit({ max: 10, windowMs: 5000 })
  async createZone(@Body() dto: HvacZoneCreateDto, @Req() req: AuthenticatedRequest) {
    const actor = requireAdmin(req);
    const name = dto.name.trim();
    const zone = await serializedTransaction(this.zoneRepo.manager.connection, async (manager) => {
      const repo = manager.getRepository(HvacZone);
      const code = `zone_${Date.now().toString(36)}`;
      const maxSort = await repo.createQueryBuilder('z').select('MAX(z.sortOrder)', 'max')
        .where('z.floor = :floor', { floor: dto.floor }).getRawOne<{ max: number | null }>();
      const row = await repo.save(repo.create({
        code, configRevision: 1, name, floor: dto.floor, indoors: '[]',
        sortOrder: (maxSort?.max ?? 0) + 10, enabled: true,
      }));
      await this.writeAudit(manager, 'hvac_zone', row.id, 'create', null, row, actor, 'hvac-zone:create');
      return row;
    });
    await this.logService.record({
      operator: actor.username,
      action: 'hvac.zone.create',
      targetType: 'hvac-zone',
      targetId: zone.code,
      result: 'success',
      message: JSON.stringify({ name, floor: dto.floor }),
    });
    return {
      message: '已新建',
      data: { code: zone.code, configRevision: zone.configRevision, name: zone.name, floor: zone.floor, indoors: [] },
    };
  }

  /**
   * 删除功能区 — 组内内机不删, 只是变回"未分组".
   * DELETE /api/hvac/zones/:code
   */
  @Delete('zones/:code')
  @UseGuards(ActorAdminGuard)
  @RateLimit({ max: 10, windowMs: 5000 })
  async deleteZone(@Param('code') code: string, @Query() query: HvacZoneRevisionQueryDto, @Req() req: AuthenticatedRequest) {
    const actor = requireAdmin(req);
    const result = await serializedTransaction(this.zoneRepo.manager.connection, async (manager) => {
      const zones = manager.getRepository(HvacZone);
      const indoors = manager.getRepository(HvacIndoor);
      const zone = await zones.findOne({ where: { code } });
      if (!zone) throw new NotFoundException(`功能区 "${code}" 不存在`);
      this.assertRevision(zone.configRevision, query.expectedRevision, 'HVAC_ZONE_REVISION_CONFLICT');
      const members = await indoors.find({ where: { zoneCode: code } });
      const before = { ...zone };
      for (const member of members) {
        const updated = await indoors.update({ id: member.id, configRevision: member.configRevision }, { zoneCode: null, configRevision: member.configRevision + 1 });
        if (updated.affected !== 1) throw this.revisionConflict('HVAC_INDOOR_REVISION_CONFLICT');
        const next = await indoors.findOneByOrFail({ id: member.id });
        await this.writeAudit(manager, 'hvac_indoor', member.id, 'update', { ...member }, next, actor, 'hvac-indoor:release-zone');
      }
      const deleted = await zones.delete({ id: zone.id, configRevision: query.expectedRevision });
      if (deleted.affected !== 1) throw this.revisionConflict('HVAC_ZONE_REVISION_CONFLICT');
      await this.writeAudit(manager, 'hvac_zone', zone.id, 'delete', before, null, actor, 'hvac-zone:delete');
      return { code, releasedIndoors: members.map((member) => member.idx) };
    });

    await this.logService.record({
      operator: actor.username,
      action: 'hvac.zone.delete',
      targetType: 'hvac-zone',
      targetId: code,
      result: 'success',
      message: JSON.stringify({ releasedIndoors: result.releasedIndoors }),
    });
    return { message: '已删除', data: result };
  }

  /**
   * 改功能区名字 — 业主在 PWA 空调页直接点区名改, 不用进后台。
   * PUT /api/hvac/zones/:code  { name: "新名字" }
   */
  @Put('zones/:code')
  @UseGuards(ActorAdminGuard)
  @RateLimit({ max: 10, windowMs: 5000 })
  async renameZone(@Param('code') code: string, @Body() dto: HvacZoneRenameDto, @Req() req: AuthenticatedRequest) {
    const actor = requireAdmin(req);
    const saved = await serializedTransaction(this.zoneRepo.manager.connection, async (manager) => {
      const repo = manager.getRepository(HvacZone);
      const zone = await repo.findOne({ where: { code } });
      if (!zone) throw new NotFoundException(`hvac zone "${code}" 不存在`);
      this.assertRevision(zone.configRevision, dto.expectedRevision, 'HVAC_ZONE_REVISION_CONFLICT');
      const before = { ...zone };
      const nextName = dto.name.trim();
      if (zone.name === nextName) return zone;
      const result = await repo.update({ id: zone.id, configRevision: dto.expectedRevision }, { name: nextName, configRevision: dto.expectedRevision + 1 });
      if (result.affected !== 1) throw this.revisionConflict('HVAC_ZONE_REVISION_CONFLICT');
      const next = await repo.findOneByOrFail({ id: zone.id });
      await this.writeAudit(manager, 'hvac_zone', zone.id, 'update', before, next, actor, 'hvac-zone:rename');
      return next;
    });
    await this.logService.record({
      operator: actor.username,
      action: 'hvac.zone.rename',
      targetType: 'hvac-zone',
      targetId: code,
      result: 'success',
      message: JSON.stringify({ to: saved.name }),
    });
    const members = await this.indoorRepo.find({
      where: { zoneCode: code, enabled: true },
      order: { idx: 'ASC' },
    });
    return {
      message: '已更名',
      data: {
        code: saved.code,
        configRevision: saved.configRevision,
        name: saved.name,
        floor: saved.floor,
        indoors: members.map((m) => m.idx),
      },
    };
  }

  /** 运行时只读权威目录；新安装默认值由版本化迁移建立。 */
  private listEnabledZones(): Promise<HvacZone[]> {
    return this.zoneRepo.find({
      where: { enabled: true },
      order: { floor: 'ASC', sortOrder: 'ASC' },
    });
  }

  /**
   * 扫描网关实际挂载的内机 — 现场调试 / 校准配置用.
   *
   * 中弘网关单客户端, 后端占着连接时外部工具连不进去, 所以扫描必须走后端。
   * 返回每台网关自报的内机数量 + 真实在线的内机号 (现场编号可能不从 0 开始)。
   * 用来核对 devices 表里配的 n 跟现场是否一致。
   *
   * GET /api/hvac/gateways/scan?maxIndoor=16
   */
  @Get('gateways/scan')
  @UseGuards(ActorAdminGuard)
  async scanGateways(@Query('maxIndoor') maxIndoor?: string) {
    const max = Math.min(Math.max(Number.parseInt(maxIndoor ?? '16', 10) || 16, 1), 63);
    const data = await this.modbusHvac.scanAllGateways(max);
    return { message: 'OK', data };
  }

  // ============ 批量控制 (任意选中集合 — 单机/组/楼层/全部 都走这里) ============

  // 开/关走**错峰串行** (staggerMs): 22 台同时启动对外机负载申请和配电都是冲击,
  // 厂家建议逐台间隔下发。0.4s x 22 ≈ 9s, 前端有"逐台下发中"提示。
  // 温度/模式/风速不动负载, 保持并发, 按下即达。
  @Post('batch/on')
  batchOn(@Body() dto: HvacBatchTargetDto) {
    return this.fanOut(dto.indoors, 'on', (id) => this.hvac.turnOn(id), {}, 'hvac-batch', undefined, 400);
  }

  @Post('batch/off')
  batchOff(@Body() dto: HvacBatchTargetDto) {
    return this.fanOut(dto.indoors, 'off', (id) => this.hvac.turnOff(id), {}, 'hvac-batch', undefined, 400);
  }

  @Post('batch/temperature')
  batchTemperature(@Body() dto: HvacBatchTempDto) {
    return this.fanOut(
      dto.indoors,
      'temperature',
      (id) => this.hvac.setTemperature(id, { value: dto.value }),
      { value: dto.value },
    );
  }

  @Post('batch/mode')
  batchMode(@Body() dto: HvacBatchModeDto) {
    return this.fanOut(dto.indoors, 'mode', (id) => this.hvac.setMode(id, { mode: dto.mode }), {
      mode: dto.mode,
    });
  }

  @Post('batch/fan-speed')
  batchFan(@Body() dto: HvacBatchFanDto) {
    return this.fanOut(
      dto.indoors,
      'fan-speed',
      (id) => this.hvac.setFanSpeed(id, { speed: dto.speed }),
      { speed: dto.speed },
    );
  }

  // ⚠️ 顺序要紧: batch/* 必须声明在 :id/* **之前**.
  //    两者都是两段路径, NestJS 按声明顺序匹配 —— :id/on 在前的话,
  //    POST /api/hvac/batch/on 会被它吃掉, id 解析成字符串 "batch".
  // ============ 单内机控制 (id 是 indoorIdx 字符串, 例 "1".."22") ============
  @Post(':id/on')
  on(@Param('id') id: string) {
    return this.wrap(id, 'on', () => this.hvac.turnOn(id));
  }

  @Post(':id/off')
  off(@Param('id') id: string) {
    return this.wrap(id, 'off', () => this.hvac.turnOff(id));
  }

  @Post(':id/temperature')
  temperature(@Param('id') id: string, @Body() dto: HvacTempDto) {
    return this.wrap(id, 'temperature', () => this.hvac.setTemperature(id, { value: dto.value }), {
      value: dto.value,
    });
  }

  @Post(':id/mode')
  mode(@Param('id') id: string, @Body() dto: HvacModeDto) {
    return this.wrap(id, 'mode', () => this.hvac.setMode(id, { mode: dto.mode }), {
      mode: dto.mode,
    });
  }

  @Post(':id/fan-speed')
  fan(@Param('id') id: string, @Body() dto: HvacFanDto) {
    return this.wrap(id, 'fan-speed', () => this.hvac.setFanSpeed(id, { speed: dto.speed }), {
      speed: dto.speed,
    });
  }

  // ============ 功能区批量控制 (扇出到该区所有内机) ============
  @Post('zone/:code/on')
  zoneOn(@Param('code') code: string) {
    return this.zoneFanOut(code, 'on', (id) => this.hvac.turnOn(id));
  }

  @Post('zone/:code/off')
  zoneOff(@Param('code') code: string) {
    return this.zoneFanOut(code, 'off', (id) => this.hvac.turnOff(id));
  }

  @Post('zone/:code/temperature')
  zoneTemperature(@Param('code') code: string, @Body() dto: HvacTempDto) {
    return this.zoneFanOut(
      code,
      'temperature',
      (id) => this.hvac.setTemperature(id, { value: dto.value }),
      { value: dto.value },
    );
  }

  @Post('zone/:code/mode')
  zoneMode(@Param('code') code: string, @Body() dto: HvacModeDto) {
    return this.zoneFanOut(code, 'mode', (id) => this.hvac.setMode(id, { mode: dto.mode }), {
      mode: dto.mode,
    });
  }

  @Post('zone/:code/fan-speed')
  zoneFan(@Param('code') code: string, @Body() dto: HvacFanDto) {
    return this.zoneFanOut(
      code,
      'fan-speed',
      (id) => this.hvac.setFanSpeed(id, { speed: dto.speed }),
      { speed: dto.speed },
    );
  }

  // ============ 内部: 扇出 + 聚合日志 ============

  /** 区扇出 = 查出该区成员后走通用扇出. 成员来自 hvac_indoor.zoneCode */
  private async zoneFanOut(
    code: string,
    cmd: string,
    fn: (indoorId: string) => Promise<AdapterResult>,
    extra: Record<string, unknown> = {},
  ) {
    const zone = await this.zoneRepo.findOne({ where: { code } });
    if (!zone) throw new NotFoundException(`hvac zone "${code}" 不存在`);
    const members = await this.indoorRepo.find({
      where: { zoneCode: code, enabled: true },
      order: { idx: 'ASC' },
    });
    const indoors = members.map((m) => m.idx);
    if (indoors.length === 0) {
      // 空组不是错误 (业主可能刚建了组还没往里放内机), 但也别假装执行成功
      return {
        message: '该区暂无内机',
        data: {
          zone: code,
          zoneName: zone.name,
          floor: zone.floor,
          total: 0,
          okCount: 0,
          failCount: 0,
          results: [],
        },
      };
    }
    const r = await this.fanOut(indoors, cmd, fn, { ...extra, zone: code }, 'hvac-zone', code);
    return {
      message: r.message,
      data: { zone: code, zoneName: zone.name, floor: zone.floor, ...r.data },
    };
  }

  /**
   * 通用扇出: 对一组内机并发下发同一条命令, 聚合成功/失败.
   *
   * 单机 / 一个组 / 一整层 / 全部 22 台 —— 对后端都只是"内机序号集合"的大小
   * 不同而已, 所以只有这一条路径。前端选中什么就传什么。
   */
  private async fanOut(
    indoors: number[],
    cmd: string,
    fn: (indoorId: string) => Promise<AdapterResult>,
    extra: Record<string, unknown> = {},
    targetType = 'hvac-batch',
    targetId?: string,
    staggerMs = 0,
  ) {
    const runOne = async (idx: number) => {
      try {
        const r = await fn(String(idx));
        return { indoorIdx: idx, ok: r.ok, error: r.error, durationMs: r.durationMs };
      } catch (err) {
        return { indoorIdx: idx, ok: false, error: (err as Error).message, durationMs: 0 };
      }
    };
    let results: Array<{ indoorIdx: number; ok: boolean; error?: string; durationMs: number }>;
    if (staggerMs > 0) {
      // 错峰: 逐台串行 + 固定间隔 (开/关机保护外机, 见 batchOn 注释)
      results = [];
      for (let i = 0; i < indoors.length; i += 1) {
        results.push(await runOne(indoors[i]));
        if (i < indoors.length - 1) await new Promise((res) => setTimeout(res, staggerMs));
      }
    } else {
      results = await Promise.all(indoors.map(runOne));
    }
    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    const ok = failCount === 0;

    await this.logService.record({
      operator: 'system',
      action: `${targetType === 'hvac-zone' ? 'hvac.zone' : 'hvac.batch'}.${cmd}`,
      targetType,
      targetId: targetId ?? indoors.join(','),
      result: ok ? 'success' : 'failure',
      message: JSON.stringify({
        cmd,
        ...extra,
        okCount,
        failCount,
        partial: okCount > 0 && failCount > 0,
        results,
      }),
    });

    return {
      message: ok
        ? '执行成功'
        : okCount > 0
          ? `部分成功 (${okCount}/${results.length})`
          : '执行失败',
      data: { total: results.length, okCount, failCount, results },
    };
  }

  private async wrap(
    id: string,
    cmd: string,
    fn: () => Promise<AdapterResult>,
    extra: Record<string, unknown> = {},
  ) {
    const result = await fn();
    await this.logService.record({
      operator: 'system',
      action: `hvac.${cmd}`,
      targetType: 'hvac',
      targetId: id,
      result: result.ok ? 'success' : 'failure',
      message: JSON.stringify({
        id,
        cmd,
        ...extra,
        ok: result.ok,
        error: result.error,
        durationMs: result.durationMs,
        mock: result.mock,
      }),
    });
    return { message: result.ok ? '执行成功' : '执行失败', data: result };
  }
}
