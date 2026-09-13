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
import { CreateDeviceDto } from './dto/create-device.dto';
import { UpdateDeviceDto } from './dto/update-device.dto';
import { QueryDeviceDto } from './dto/query-device.dto';
import { OperationLogService } from '../logs/operation-log.service';

export interface PagedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class DevicesService {
  constructor(
    @InjectRepository(Device) private readonly repo: Repository<Device>,
    private readonly logService: OperationLogService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async findAll(query: QueryDeviceDto): Promise<PagedResult<Device>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const where: FindOptionsWhere<Device> | FindOptionsWhere<Device>[] = {};
    if (query.category) where.category = query.category;
    if (query.status) where.status = query.status;
    if (query.floor) where.floor = query.floor;
    if (query.zone) where.zone = query.zone;
    if (query.enabled !== undefined) where.enabled = query.enabled;
    if (query.keyword) where.name = Like(`%${query.keyword}%`);

    const [list, total] = await this.repo.findAndCount({
      where,
      order: { id: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async findOne(id: number): Promise<Device> {
    const device = await this.repo.findOne({ where: { id } });
    if (!device) throw new NotFoundException(`设备不存在: id=${id}`);
    return device;
  }

  async create(dto: CreateDeviceDto, operator = 'system'): Promise<Device> {
    const exists = await this.repo.findOne({ where: { name: dto.name } });
    if (exists) throw new ConflictException(`设备名称已存在: ${dto.name}`);

    const entity = this.repo.create({
      name: dto.name,
      category: dto.category,
      protocol: dto.protocol ?? 'tcp',
      adapter: dto.adapter ?? 'mock',
      ip: dto.ip ?? null,
      address: dto.address ?? null,
      floor: dto.floor ?? null,
      zone: dto.zone ?? null,
      enabled: dto.enabled ?? true,
      status: dto.status ?? 'offline',
    });
    const saved = await this.repo.save(entity);
    this.logger.info(`Device created: #${saved.id} ${saved.name}`, { context: 'DevicesService' });
    await this.logService.record({
      operator,
      action: 'device.create',
      targetType: 'device',
      targetId: String(saved.id),
      message: saved.name,
    });
    return saved;
  }

  async update(id: number, dto: UpdateDeviceDto, operator = 'system'): Promise<Device> {
    const device = await this.findOne(id);

    if (dto.name && dto.name !== device.name) {
      const dup = await this.repo.findOne({ where: { name: dto.name } });
      if (dup && dup.id !== id) throw new ConflictException(`设备名称已存在: ${dto.name}`);
    }

    Object.assign(device, dto);
    const saved = await this.repo.save(device);
    this.logger.info(`Device updated: #${id}`, { context: 'DevicesService' });
    await this.logService.record({
      operator,
      action: 'device.update',
      targetType: 'device',
      targetId: String(id),
      message: saved.name,
    });
    return saved;
  }

  async remove(id: number, operator = 'system'): Promise<void> {
    const device = await this.findOne(id);
    await this.repo.remove(device);
    this.logger.info(`Device removed: #${id}`, { context: 'DevicesService' });
    await this.logService.record({
      operator,
      action: 'device.delete',
      targetType: 'device',
      targetId: String(id),
      message: device.name,
    });
  }
}
