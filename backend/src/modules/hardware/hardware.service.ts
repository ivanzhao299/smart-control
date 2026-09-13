import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { FindOptionsWhere, Like, Repository } from 'typeorm';
import { Logger } from 'winston';
import { Device } from '../../entities/device.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { OperationLogService } from '../logs/operation-log.service';
import { PagedResult } from '../devices/devices.service';
import {
  CreateHardwareDto,
  QueryHardwareDto,
  UpdateHardwareDto,
} from './dto/hardware.dto';

@Injectable()
export class HardwareService {
  constructor(
    @InjectRepository(HardwareUnit) private readonly repo: Repository<HardwareUnit>,
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
    private readonly logService: OperationLogService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async findAll(q: QueryHardwareDto): Promise<PagedResult<HardwareUnit>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 100;
    const where: FindOptionsWhere<HardwareUnit> = {};
    if (q.category) where.category = q.category;
    if (q.floor) where.floor = q.floor;
    if (q.status) where.status = q.status;
    if (q.enabled !== undefined) where.enabled = q.enabled;
    if (q.keyword) where.name = Like(`%${q.keyword}%`);

    const [list, total] = await this.repo.findAndCount({
      where,
      order: { category: 'ASC', code: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async summary(): Promise<{
    total: number;
    enabled: number;
    fault: number;
    offline: number;
    byCategory: Record<string, number>;
  }> {
    const all = await this.repo.find();
    const byCategory: Record<string, number> = {};
    let enabled = 0;
    let fault = 0;
    let offline = 0;
    for (const h of all) {
      byCategory[h.category] = (byCategory[h.category] ?? 0) + 1;
      if (h.enabled) enabled += 1;
      if (h.status === 'fault') fault += 1;
      if (h.status === 'offline') offline += 1;
    }
    return { total: all.length, enabled, fault, offline, byCategory };
  }

  async findOne(id: number): Promise<HardwareUnit> {
    const h = await this.repo.findOne({ where: { id } });
    if (!h) throw new NotFoundException(`硬件不存在: id=${id}`);
    return h;
  }

  async create(dto: CreateHardwareDto, operator = 'admin'): Promise<HardwareUnit> {
    const exists = await this.repo.findOne({ where: { code: dto.code } });
    if (exists) throw new ConflictException(`硬件编号已存在: ${dto.code}`);

    const entity = this.repo.create({
      code: dto.code,
      name: dto.name,
      category: dto.category,
      vendor: dto.vendor,
      model: dto.model,
      driverKind: dto.driverKind ?? null,
      serialNo: dto.serialNo ?? null,
      firmwareVersion: dto.firmwareVersion ?? null,
      location: dto.location ?? null,
      floor: dto.floor ?? null,
      ip: dto.ip ?? null,
      macAddress: dto.macAddress ?? null,
      addressing: dto.addressing ?? null,
      channels: dto.channels ?? null,
      status: dto.status ?? 'normal',
      enabled: dto.enabled ?? true,
      remark: dto.remark ?? null,
      installedAt: dto.installedAt ?? null,
    });
    const saved = await this.repo.save(entity);
    this.logger.info(`Hardware created: ${saved.code} ${saved.model}`, {
      context: 'HardwareService',
    });
    await this.logService.record({
      operator,
      action: 'hardware.create',
      targetType: 'hardware',
      targetId: String(saved.id),
      message: `${saved.code} (${saved.vendor} ${saved.model})`,
    });
    return saved;
  }

  async update(id: number, dto: UpdateHardwareDto, operator = 'admin'): Promise<HardwareUnit> {
    const h = await this.findOne(id);
    if (dto.code && dto.code !== h.code) {
      const dup = await this.repo.findOne({ where: { code: dto.code } });
      if (dup && dup.id !== id) throw new ConflictException(`硬件编号已存在: ${dto.code}`);
    }
    const oldIp = h.ip;
    Object.assign(h, {
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.category !== undefined && { category: dto.category }),
      ...(dto.vendor !== undefined && { vendor: dto.vendor }),
      ...(dto.model !== undefined && { model: dto.model }),
      ...(dto.driverKind !== undefined && { driverKind: dto.driverKind }),
      ...(dto.serialNo !== undefined && { serialNo: dto.serialNo }),
      ...(dto.firmwareVersion !== undefined && { firmwareVersion: dto.firmwareVersion }),
      ...(dto.location !== undefined && { location: dto.location }),
      ...(dto.floor !== undefined && { floor: dto.floor }),
      ...(dto.ip !== undefined && { ip: dto.ip }),
      ...(dto.macAddress !== undefined && { macAddress: dto.macAddress }),
      ...(dto.addressing !== undefined && { addressing: dto.addressing }),
      ...(dto.channels !== undefined && { channels: dto.channels }),
      ...(dto.status !== undefined && { status: dto.status }),
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
      ...(dto.remark !== undefined && { remark: dto.remark }),
      ...(dto.installedAt !== undefined && { installedAt: dto.installedAt }),
    });
    const saved = await this.repo.save(h);
    this.logger.info(`Hardware updated: #${id} ${saved.code}`, { context: 'HardwareService' });
    await this.logService.record({
      operator,
      action: 'hardware.update',
      targetType: 'hardware',
      targetId: String(id),
      message: `${saved.code} status=${saved.status} enabled=${saved.enabled}`,
    });
    await this.propagateHvacGatewayIp(saved, oldIp);
    return saved;
  }

  /**
   * 空调网关换 IP 时, 把 devices 表里指向旧网关的内机 gwHost 一起改掉.
   *
   * 背景: HVAC 逐台内机控制读的是 devices.address JSON 里的 gwHost
   * ({"gwHost":"x.x.x.x","n":0}), 不是 hardware_units.ip. 只改 hardware
   * 行的话, 后台设备网络页看着改成功了, 空调实际还在连旧 IP.
   */
  private async propagateHvacGatewayIp(saved: HardwareUnit, oldIp: string | null): Promise<void> {
    const ipRe = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (saved.category !== 'hvac-gateway') return;
    if (!oldIp || !saved.ip || saved.ip === oldIp) return;
    if (!ipRe.test(oldIp) || !ipRe.test(saved.ip)) return;
    const result = await this.deviceRepo
      .createQueryBuilder()
      .update(Device)
      .set({
        address: () => `REPLACE(address, '"gwHost":"${oldIp}"', '"gwHost":"${saved.ip}"')`,
      })
      .where('address LIKE :pat', { pat: `%"gwHost":"${oldIp}"%` })
      .execute();
    if (result.affected) {
      this.logger.info(
        `HVAC gateway IP propagated: ${oldIp} → ${saved.ip}, ${result.affected} 台内机 gwHost 已同步`,
        { context: 'HardwareService' },
      );
    }
  }

  async remove(id: number, operator = 'admin'): Promise<void> {
    const h = await this.findOne(id);
    await this.repo.remove(h);
    this.logger.info(`Hardware removed: #${id} ${h.code}`, { context: 'HardwareService' });
    await this.logService.record({
      operator,
      action: 'hardware.delete',
      targetType: 'hardware',
      targetId: String(id),
      message: h.code,
    });
  }
}
