import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { Actor } from '../../common/auth/actor';
import { PermissionService } from '../rbac/permission.service';

export type PublicUser = Omit<User, 'password'>;

function rethrowAdministratorConstraint(error: unknown): never {
  const failure = error as { driverError?: { code?: unknown; message?: unknown }; code?: unknown; message?: unknown } | null;
  const cause = failure?.driverError ?? failure;
  if (cause?.code === 'SQLITE_CONSTRAINT_TRIGGER' && cause.message === 'LAST_ENABLED_ADMIN_REQUIRED') {
    throw new ConflictException('至少保留一个启用的管理员账户，请先创建或启用其他管理员');
  }
  throw error;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    private readonly logService: OperationLogService,
    private readonly permissions: PermissionService,
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
    return { list: list.map(({ password: _pw, ...user }) => user), total, page, pageSize };
  }

  async findOne(id: number): Promise<PublicUser> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException(`用户不存在: id=${id}`);
    const { password: _pw, ...publicUser } = u;
    return publicUser;
  }

  private async currentAdministrator(actor: Actor): Promise<string> {
    if (actor.role !== 'admin') throw new ForbiddenException('仅管理员可管理用户');
    if (actor.kind === 'admin' && actor.userId === null) return actor.username;
    if (actor.kind === 'user' && actor.userId !== null) {
      const current = await this.repo.findOneBy({ id: actor.userId, enabled: true, role: 'admin' });
      if (current) return current.username;
    }
    throw new ForbiddenException('管理员权限已失效');
  }

  async create(dto: CreateUserDto, actor: Actor): Promise<PublicUser> {
    // 动态角色校验：role 必须是存在且启用的角色 code。
    if (!(await this.permissions.roleExistsEnabled(dto.role))) {
      throw new BadRequestException(`角色不存在或已停用：${dto.role}`);
    }
    return serializedTransaction(this.repo.manager.connection, async () => this.createInTransaction(dto, await this.currentAdministrator(actor)));
  }

  private async createInTransaction(dto: CreateUserDto, operator: string): Promise<PublicUser> {
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

  async update(id: number, dto: UpdateUserDto, actor: Actor): Promise<PublicUser> {
    return serializedTransaction(this.repo.manager.connection, async () => this.updateInTransaction(id, dto, await this.currentAdministrator(actor)));
  }

  private async updateInTransaction(id: number, dto: UpdateUserDto, operator: string): Promise<PublicUser> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`用户不存在: id=${id}`);

    // 动态角色校验：改派的角色必须存在且启用。
    if (dto.role !== undefined && dto.role !== user.role &&
        !(await this.permissions.roleExistsEnabled(dto.role))) {
      throw new BadRequestException(`角色不存在或已停用：${dto.role}`);
    }

    const changes: Partial<User> = {};
    if (dto.username && dto.username !== user.username) {
      const dup = await this.repo.findOne({ where: { username: dto.username } });
      if (dup && dup.id !== id) throw new ConflictException(`用户名已存在: ${dto.username}`);
      changes.username = dto.username;
    }
    if (dto.role) changes.role = dto.role;
    if (dto.enabled !== undefined) changes.enabled = dto.enabled;
    if (dto.password) changes.password = hashPassword(dto.password);

    if (!Object.keys(changes).length) return this.findOne(id);
    // UPDATE only submitted fields. save(staleEntity) could restore an old role /
    // enabled flag or insert a user deleted while this request was awaiting I/O.
    const result = await this.repo.update(id, changes).catch(rethrowAdministratorConstraint);
    if (!result.affected) throw new NotFoundException(`用户不存在: id=${id}`);
    const current = await this.findOne(id);
    this.logger.info(`User updated: #${id}`, { context: 'UsersService' });
    await this.logService.record({
      operator,
      action: 'user.update',
      targetType: 'user',
      targetId: String(id),
      message: `username=${current.username} role=${current.role} enabled=${current.enabled}`,
    });
    return current;
  }

  async remove(id: number, actor: Actor): Promise<void> {
    return serializedTransaction(this.repo.manager.connection, async () => this.removeInTransaction(id, await this.currentAdministrator(actor)));
  }

  private async removeInTransaction(id: number, operator: string): Promise<void> {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`用户不存在: id=${id}`);
    if (user.username === 'admin') {
      throw new ConflictException('默认 admin 账户不可删除');
    }
    try {
      // Check inside DELETE, not in an earlier read: a channel or protected name
      // may have changed while the user lookup was awaiting completion.
      const result = await this.repo.createQueryBuilder().delete().from(User)
        .where('id = :id', { id })
        .andWhere('username != :protectedName', { protectedName: 'admin' })
        .andWhere('NOT EXISTS (SELECT 1 FROM playback_channels WHERE initiator_user_id = :id)', { id })
        .execute();
      if (!result.affected) throw new ConflictException('账户状态已变化或仍有播放通道关联，请停止播放后刷新重试');
    }
    catch (error) {
      // RESTRICT retains private media, playlists, history and upload reservations.
      // Never clear ownership or cascade files to make account deletion succeed.
      const failure = error as { driverError?: { code?: unknown; message?: unknown }; code?: unknown; message?: unknown } | null;
      const cause = failure?.driverError ?? failure;
      // SQLite reports ON DELETE RESTRICT as CONSTRAINT_TRIGGER on some versions.
      if (cause?.code === 'SQLITE_CONSTRAINT_FOREIGNKEY' ||
        (cause?.code === 'SQLITE_CONSTRAINT_TRIGGER' && cause.message === 'FOREIGN KEY constraint failed')) {
        throw new ConflictException('该用户仍有关联资料、播放记录或上传任务，请停用账户以保留资料');
      }
      rethrowAdministratorConstraint(error);
    }
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
