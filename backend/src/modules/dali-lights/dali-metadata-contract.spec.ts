import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DaliLight } from '../../entities/dali-light.entity';
import { LightScene } from '../../entities/light-scene.entity';
import { LightSceneItem } from '../../entities/light-scene-item.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { DaliLightsService } from './dali-lights.service';
import {
  AssignDaliLightZoneDto,
  CreateDaliSceneDto,
  UpdateDaliSceneDto,
} from './dto/dali-metadata.dto';

describe('DALI metadata runtime contract', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const body = (metatype: new () => unknown, value: unknown) =>
    pipe.transform(value, { type: 'body', metatype });

  it('requires a revision for existing metadata and keeps scene items bounded', async () => {
    await expect(body(AssignDaliLightZoneDto, { zoneCode: 'foyer' })).rejects.toThrow();
    await expect(body(UpdateDaliSceneDto, { name: 'x' })).rejects.toThrow();
    await expect(body(CreateDaliSceneDto, {
      name: '接待', unknown: true,
    })).rejects.toThrow();
    await expect(body(CreateDaliSceneDto, {
      name: '接待', items: [{ targetType: 'zone', targetRef: 'foyer', on: true, brightness: 80 }],
    })).resolves.toMatchObject({ name: '接待' });
  });
});

describe('DALI metadata CAS and audit boundary', () => {
  let db: DataSource;
  afterEach(async () => { if (db?.isInitialized) await db.destroy(); });

  it('protects light and scene edits without invoking the lighting adapter', async () => {
    db = await new DataSource({
      type: 'better-sqlite3', database: ':memory:', synchronize: true,
      entities: [DaliLight, LightScene, LightSceneItem, HardwareUnit, AuditLog],
    }).initialize();
    const service = new DaliLightsService(
      {} as any,
      db.getRepository(DaliLight), db.getRepository(LightScene), db.getRepository(LightSceneItem),
      db.getRepository(HardwareUnit), db.getRepository(AuditLog), { info: jest.fn(), warn: jest.fn() } as any,
    );
    const actor = { kind: 'user', userId: 1, username: 'named-admin', role: 'admin' } as const;
    const light = await db.getRepository(DaliLight).save(db.getRepository(DaliLight).create({
      configRevision: 1, gatewayCode: 'GW-1', shortAddr: 1, name: null, zoneCode: null,
      online: true, fault: false, lastSeenAt: null, sortOrder: 1, enabled: true,
    }));
    const renamed = await service.rename(light.id, '前厅灯', 1, actor);
    expect(renamed.configRevision).toBe(2);
    await expect(service.rename(light.id, '过期编辑', 1, actor)).rejects.toMatchObject({
      response: { code: 'DALI_LIGHT_REVISION_CONFLICT' },
    });
    const scene = await service.createScene({ name: '接待', items: [{ targetType: 'light', targetRef: 'GW-1:1' }] }, actor);
    expect(scene.configRevision).toBe(1);
    const edited = await service.updateScene(scene.code, { name: '接待模式' }, 1, actor);
    expect(edited.configRevision).toBe(2);
    await expect(service.deleteScene(scene.code, 1, actor)).rejects.toMatchObject({
      response: { code: 'LIGHT_SCENE_REVISION_CONFLICT' },
    });
    expect(await db.getRepository(AuditLog).count()).toBe(3);
  });
});
