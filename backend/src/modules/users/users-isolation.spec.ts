import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../../entities/user.entity';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';

describe('user management attribution and retention', () => {
  let db: DataSource, service: UsersService, controller: UsersController, log: any;
  const req = { actor: { kind: 'user', userId: 99, username: 'named-manager', role: 'admin' } } as any;
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [User], synchronize: true }).initialize();
    await db.query('CREATE TABLE retained_fixture (id INTEGER PRIMARY KEY, owner_user_id INTEGER REFERENCES users(id) ON DELETE RESTRICT)');
    log = { record: jest.fn(async () => undefined) };
    service = new UsersService(db.getRepository(User), log, { info: jest.fn() } as any);
    controller = new UsersController(service);
  });
  afterEach(async () => { await db.destroy(); });
  async function create() {
    return (await controller.create({ username: 'alice', password: 'synthetic-password', role: 'operator' }, req)).data;
  }
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
    jest.spyOn(repo, 'remove').mockRejectedValueOnce(new Error('disk unavailable'));
    await expect(service.remove(user.id, 'named-manager')).rejects.toThrow('disk unavailable');
  });
});
