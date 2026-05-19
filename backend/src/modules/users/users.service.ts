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
import { User } from '../../entities/user.entity';
import { hashPassword } from '../../common/utils/password.util';
import { CreateUserDto, QueryUserDto, UpdateUserDto } from './dto/user.dto';
import { OperationLogService } from '../logs/operation-log.service';
import { PagedResult } from '../devices/devices.service';

export type PublicUser = Omit<User, 'password'>;

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly logService: OperationLogService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async findAll(q: QueryUserDto): Promise<PagedResult<PublicUser>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: FindOptionsWhere<User> = {};
    if (q.role) where.role = q.role;
    if (q.enabled !== undefined) where.enabled = q.enabled;
    if (q.keyword) where.username = Like(`%${q.keyword}%`);

    const [list, total] = await this.repo.findAndCount({
      where,
      order: { id: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      // 默认 select 不包含 password (entity 上配置了 select:false)
    });
    return { list, total, page, pageSize };
  }

  async findOne(id: number): Promise<PublicUser> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`用户不存在: id=${id}`);
    return u;
  }

  async create(dto: CreateUserDto, operator = 'admin'): Promise<PublicUser> {
    const exists = await this.repo.findOne({ where: { username: dto.username } });
    if (exists) throw new ConflictException(`用户名已存在: ${dto.username}`);

    const entity = this.repo.create({
      username: dto.username,
      password: hashPassword(dto.password),
      role: dto.role,
      enabled: dto.enabled ?? true,
    });
    const saved = await this.repo.save(entity);
    this.logger.info(`User created: ${saved.username} (${saved.role})`, {
      context: 'UsersService',
    });
    await this.logService.record({
      operator,
      action: 'user.create',
      targetType: 'user',
      targetId: String(saved.id),
      message: `${saved.username} role=${saved.role}`,
    });
    // 返回时手动剔除密码
    const { password: _pw, ...publicUser } = saved;
    return publicUser as PublicUser;
  }

  async update(id: number, dto: UpdateUserDto, operator = 'admin'): Promise<PublicUser> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`用户不存在: id=${id}`);

    if (dto.username && dto.username !== user.username) {
      const dup = await this.repo.findOne({ where: { username: dto.username } });
      if (dup && dup.id !== id) throw new ConflictException(`用户名已存在: ${dto.username}`);
      user.username = dto.username;
    }
    if (dto.role) user.role = dto.role;
    if (dto.enabled !== undefined) user.enabled = dto.enabled;
    if (dto.password) user.password = hashPassword(dto.password);

    await this.repo.save(user);
    this.logger.info(`User updated: #${id}`, { context: 'UsersService' });
    await this.logService.record({
      operator,
      action: 'user.update',
      targetType: 'user',
      targetId: String(id),
      message: `username=${user.username} role=${user.role} enabled=${user.enabled}`,
    });
    const { password: _pw, ...publicUser } = user;
    return publicUser as PublicUser;
  }

  async remove(id: number, operator = 'admin'): Promise<void> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`用户不存在: id=${id}`);
    if (user.username === 'admin') {
      throw new ConflictException('默认 admin 账户不可删除');
    }
    await this.repo.remove(user);
    this.logger.info(`User removed: #${id} ${user.username}`, { context: 'UsersService' });
    await this.logService.record({
      operator,
      action: 'user.delete',
      targetType: 'user',
      targetId: String(id),
      message: user.username,
    });
  }
}
