import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../../entities/user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { ProtectLastAdministrator1788618007000 } from '../../migrations/1788618007000-ProtectLastAdministrator';

describe('user management attribution and retention', () => {
  let db: DataSource, service: UsersService, controller: UsersController, log: any;
  const req = { actor: { kind: 'user', userId: 99, username: 'named-manager', role: 'admin' } } as any;
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [User], synchronize: true }).initialize();
    await db.query('CREATE TABLE retained_fixture (id INTEGER PRIMARY KEY, owner_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT)');
    await db.query('CREATE TABLE playback_channels (id INTEGER PRIMARY KEY, initiator_user_id INTEGER)');
    await new ProtectLastAdministrator1788618007000().up(db.createQueryRunner());
    log = { record: jest.fn(async () => undefined) };
    service = new UsersService(db.getRepository(User), log, { info: jest.fn() } as any);
    controller = new UsersController(service);
  });
  afterEach(async () => { await db.destroy(); });
  async function create() {
    return (await controller.create({ username: 'alice', password: 'synthetic-password', role: 'operator' }, req)).data;
  }
  it('rejects disabling, demoting or deleting the last enabled administrator without a success audit', async () => {
    const admin = (await controller.create({ username: 'manager', password: 'synthetic-password', role: 'admin' }, req)).data;
    await controller.create({ username: 'disabled-admin', password: 'synthetic-password', role: 'admin', enabled: false }, req);
    log.record.mockClear();
    await expect(controller.update(admin.id, { enabled: false }, req)).rejects.toThrow('至少保留一个');
    await expect(controller.update(admin.id, { role: 'operator' }, req)).rejects.toThrow('至少保留一个');
    await expect(controller.remove(admin.id, req)).rejects.toThrow('至少保留一个');
    expect(await service.findOne(admin.id)).toMatchObject({ enabled: true, role: 'admin' });
    expect(log.record).not.toHaveBeenCalled();
    // Password and username changes remain available; the invariant is ID-based.
    await controller.update(admin.id, { username: 'renamed-manager', password: 'new-synthetic-password' }, req);
    await expect(controller.update(admin.id, { enabled: false }, req)).rejects.toThrow('至少保留一个');
  });
  it('permits administrator handover but rejects bulk removal of all enabled administrators atomically', async () => {
    const first = (await controller.create({ username: 'first-manager', password: 'synthetic-password', role: 'admin' }, req)).data;
    const second = (await controller.create({ username: 'second-manager', password: 'synthetic-password', role: 'admin' }, req)).data;
    await expect(db.query("UPDATE users SET enabled = 0 WHERE role = 'admin'")).rejects.toThrow('LAST_ENABLED_ADMIN_REQUIRED');
    expect(await db.getRepository(User).countBy({ enabled: true, role: 'admin' })).toBe(2);
    await controller.update(first.id, { role: 'operator' }, req);
    await expect(controller.remove(second.id, req)).rejects.toThrow('至少保留一个');
    await controller.remove(first.id, req);
    expect(await db.getRepository(User).countBy({ enabled: true, role: 'admin' })).toBe(1);
  });
  it('attributes create, password change and delete to the verified named administrator', async () => {
    const user = await create();
    expect(user).not.toHaveProperty('password');
    const result = await controller.update(user.id, { password: 'new-synthetic-password' }, req);
    expect(result.data).not.toHaveProperty('password');
    await controller.remove(user.id, req);
    expect(log.record.mock.calls.map(([entry]: any[]) => [entry.operator, entry.action])).toEqual([
      ['named-manager', 'user.create'], ['named-manager', 'user.update'], ['named-manager', 'user.delete'],
    ]);
    expect(JSON.stringify(log.record.mock.calls)).not.toContain('synthetic-password');
  });
  it('retains user and owned rows on restricted delete; disabling retains ownership', async () => {
    const user = await create();
    await db.query('INSERT INTO retained_fixture VALUES (1, ?)', [user.id]);
    await expect(controller.remove(user.id, req)).rejects.toThrow('请停用账户以保留资料');
    expect(await db.getRepository(User).count()).toBe(1);
    expect(log.record.mock.calls.some(([entry]: any[]) => entry.action === 'user.delete')).toBe(false);
    await controller.update(user.id, { enabled: false }, req);
    expect((await service.findOne(user.id)).enabled).toBe(false);
    expect(await db.query('SELECT owner_user_id FROM retained_fixture')).toEqual([{ owner_user_id: user.id }]);
  });
  it.each(['operator', 'viewer'])('rejects %s directly before user mutation', async role => {
    const unprivileged = { actor: { ...req.actor, role } } as any;
    await expect(controller.create({ username: 'denied', password: 'synthetic-password', role: 'admin' }, unprivileged)).rejects.toThrow();
    await expect(controller.update(1, { role: 'admin' }, unprivileged)).rejects.toThrow();
    await expect(controller.remove(1, unprivileged)).rejects.toThrow();
    expect(await db.getRepository(User).count()).toBe(0);
    expect(log.record).not.toHaveBeenCalled();
  });
  it('does not relabel unrelated storage failures as ownership conflicts', async () => {
    const user = await create();
    const repo = db.getRepository(User);
    jest.spyOn(repo, 'createQueryBuilder').mockImplementationOnce(() => { throw new Error('disk unavailable'); });
    await expect(service.remove(user.id, 'named-manager')).rejects.toThrow('disk unavailable');
  });
  it('does not recreate a user deleted between lookup and update', async () => {
    const user = await create();
    const repo = db.getRepository(User), update = repo.update.bind(repo);
    jest.spyOn(repo, 'update').mockImplementationOnce(async (id, changes) => {
      await repo.delete(user.id);
      return update(id, changes);
    });
    await expect(service.update(user.id, { enabled: false }, 'named-manager')).rejects.toThrow('用户不存在');
    expect(await repo.count()).toBe(0);
    expect(log.record.mock.calls.some(([entry]: any[]) => entry.action === 'user.update')).toBe(false);
  });
  it('a concurrent password update cannot restore stale role, enabled state or quota', async () => {
    const user = await create();
    const repo = db.getRepository(User), update = repo.update.bind(repo);
    jest.spyOn(repo, 'update').mockImplementationOnce(async (id, changes) => {
      await db.query('UPDATE users SET enabled = 0, role = ?, storage_quota_bytes = 123 WHERE id = ?', ['viewer', user.id]);
      expect(Object.keys(changes)).toEqual(['password']);
      return update(id, changes);
    });
    const result = await service.update(user.id, { password: 'new-synthetic-password' }, 'named-manager');
    expect(result).toMatchObject({ enabled: false, role: 'viewer', storageQuotaBytes: 123 });
    expect(result).not.toHaveProperty('password');
  });
  it('retains accounts referenced by any playback channel until the reference is cleared', async () => {
    const user = await create();
    await db.query('INSERT INTO playback_channels VALUES (3, ?)', [user.id]);
    await expect(controller.remove(user.id, req)).rejects.toThrow('播放通道关联');
    expect(await db.getRepository(User).count()).toBe(1);
    expect(log.record.mock.calls.some(([entry]: any[]) => entry.action === 'user.delete')).toBe(false);
    await db.query('UPDATE playback_channels SET initiator_user_id = NULL WHERE id = 3');
    await controller.remove(user.id, req);
    expect(await db.getRepository(User).count()).toBe(0);
  });
  it('checks channel references at deletion time even when absent in the initial user lookup', async () => {
    const user = await create();
    const repo = db.getRepository(User), findOne = repo.findOne.bind(repo);
    jest.spyOn(repo, 'findOne').mockImplementationOnce(async options => {
      const snapshot = await findOne(options);
      await db.query('INSERT INTO playback_channels VALUES (1, ?)', [user.id]);
      return snapshot;
    });
    await expect(controller.remove(user.id, req)).rejects.toThrow('播放通道关联');
    expect(await repo.count()).toBe(1);
  });
});
