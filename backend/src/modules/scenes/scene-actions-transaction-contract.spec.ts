import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { OperationLog } from '../../entities/operation-log.entity';
import { Scene } from '../../entities/scene.entity';
import { SceneAction } from '../../entities/scene-action.entity';
import { OperationLogService } from '../logs/operation-log.service';
import { SceneActionsService } from './scene-actions.service';

const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;
const action = (overrides: Record<string, unknown> = {}) => ({
  deviceType: 'lighting', deviceId: 'zone-a', command: 'turnOn', params: {}, ...overrides,
});

describe('SceneActionsService transaction contract', () => {
  let db: DataSource;
  let service: SceneActionsService;

  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3', database: ':memory:',
      entities: [Scene, SceneAction, AuditLog, OperationLog], synchronize: true,
    }).initialize();
    const scene = await db.getRepository(Scene).save({ code: 'OPEN', name: 'Open', description: null, enabled: true, configRevision: 1 });
    expect(scene.id).toBe(1);
    service = new SceneActionsService(
      db.getRepository(Scene), db.getRepository(SceneAction),
      new OperationLogService(db.getRepository(OperationLog), logger),
      { dispatch: jest.fn() } as any, db, logger,
    );
  });

  afterEach(async () => { if (db?.isInitialized) await db.destroy(); });

  it('creates, updates, and deletes with CAS and matching audit/operation records', async () => {
    const created = await service.create(1, action(), 'fixture-admin');
    expect(created.configRevision).toBe(1);
    const updated = await service.update(created.id, { expectedRevision: 1, enabled: false }, 'fixture-admin');
    expect(updated.configRevision).toBe(2);
    await expect(service.update(created.id, { expectedRevision: 1, enabled: true }, 'fixture-admin'))
      .rejects.toBeInstanceOf(ConflictException);
    await service.remove(created.id, 2, 'fixture-admin');

    expect(await db.getRepository(SceneAction).count()).toBe(0);
    expect((await db.getRepository(AuditLog).find({ order: { id: 'ASC' } })).map(row => row.action))
      .toEqual(['create', 'update', 'delete']);
    expect((await db.getRepository(OperationLog).find({ order: { id: 'ASC' } })).map(row => row.action))
      .toEqual(['scene-action.create', 'scene-action.update', 'scene-action.delete']);
  });

  it('rolls back action and audit when operation log persistence fails', async () => {
    await db.query("CREATE TRIGGER fail_scene_action_log BEFORE INSERT ON operation_logs WHEN NEW.action LIKE 'scene-action.%' BEGIN SELECT RAISE(ABORT, 'operation log unavailable'); END");
    await expect(service.create(1, action(), 'fixture-admin')).rejects.toThrow('operation log unavailable');
    expect(await db.getRepository(SceneAction).count()).toBe(0);
    expect(await db.getRepository(AuditLog).count()).toBe(0);
    expect(await db.getRepository(OperationLog).count()).toBe(0);
  });
});
