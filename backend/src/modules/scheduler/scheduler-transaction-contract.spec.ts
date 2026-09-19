import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { OperationLog } from '../../entities/operation-log.entity';
import { SchedulerTask } from '../../entities/scheduler-task.entity';
import { OperationLogService } from '../logs/operation-log.service';
import { SchedulerService } from './scheduler.service';

const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;

describe('SchedulerService transaction contract', () => {
  let db: DataSource;
  let service: SchedulerService;

  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3', database: ':memory:',
      entities: [SchedulerTask, AuditLog, OperationLog], synchronize: true,
    }).initialize();
    service = new SchedulerService(
      db.getRepository(SchedulerTask), { execute: jest.fn() } as any,
      new OperationLogService(db.getRepository(OperationLog), logger), db, logger,
    );
  });

  afterEach(async () => {
    service.onModuleDestroy();
    if (db?.isInitialized) await db.destroy();
  });

  it('uses scheduler configRevision for update/delete and writes both records', async () => {
    const created = await service.create({ name: 'Open', code: 'OPEN', cron: '0 9 * * *', sceneCode: 'OPEN', enabled: false }, 'fixture-admin');
    expect(created.configRevision).toBe(1);
    const updated = await service.update(created.id, { expectedRevision: 1, description: 'morning open' }, 'fixture-admin');
    expect(updated.configRevision).toBe(2);
    await expect(service.update(created.id, { expectedRevision: 1, name: 'stale' }, 'fixture-admin'))
      .rejects.toBeInstanceOf(ConflictException);
    await service.remove(created.id, 2, 'fixture-admin');

    expect(await db.getRepository(SchedulerTask).count()).toBe(0);
    expect((await db.getRepository(AuditLog).find({ order: { id: 'ASC' } })).map(row => row.action))
      .toEqual(['create', 'update', 'delete']);
    expect((await db.getRepository(OperationLog).find({ order: { id: 'ASC' } })).map(row => row.action))
      .toEqual(['scheduler.create', 'scheduler.update', 'scheduler.delete']);
  });

  it('rolls back scheduler configuration when operation log persistence fails', async () => {
    await db.query("CREATE TRIGGER fail_scheduler_log BEFORE INSERT ON operation_logs WHEN NEW.action LIKE 'scheduler.%' BEGIN SELECT RAISE(ABORT, 'operation log unavailable'); END");
    await expect(service.create({ name: 'Open', cron: '0 9 * * *', sceneCode: 'OPEN', enabled: false }, 'fixture-admin'))
      .rejects.toThrow('operation log unavailable');
    expect(await db.getRepository(SchedulerTask).count()).toBe(0);
    expect(await db.getRepository(AuditLog).count()).toBe(0);
  });
});
