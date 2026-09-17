import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { resolve } from 'path';
import { AudioConfigService } from './audio-config.service';
import { AudioInputSource } from '../../entities/audio-input-source.entity';
import { AudioOutputZone } from '../../entities/audio-output-zone.entity';
import { AudioScene } from '../../entities/audio-scene.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { AudioController } from '../audio/audio.controller';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import {
  AudioDeleteQueryDto,
  AudioInputUpsertDto,
  AudioSceneUpsertDto,
  AudioZoneUpsertDto,
} from './dto/audio-config.dto';
import type { Actor } from '../../common/auth/actor';

const actor: Actor = { kind: 'admin', userId: null, username: 'contract-admin', role: 'admin' };
describe('audio config strict DTOs', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  it.each([
    [AudioInputUpsertDto, { channel: 0.5 }],
    [AudioInputUpsertDto, { channel: '0' }],
    [AudioInputUpsertDto, { channel: 8 }],
    [AudioInputUpsertDto, { enabled: 'false' }],
    [AudioInputUpsertDto, { enabled: null }],
    [AudioInputUpsertDto, { name: '  ' }],
    [AudioInputUpsertDto, { name: null }],
    [AudioZoneUpsertDto, { name: 'x'.repeat(65) }],
    [AudioZoneUpsertDto, { floor: 'x'.repeat(17) }],
    [AudioZoneUpsertDto, { ownerUserId: 9 }],
    [AudioInputUpsertDto, { desiredGainDb: 12 }],
    [AudioInputUpsertDto, { configRevision: 99 }],
    [AudioInputUpsertDto, { expectedRevision: null }],
    [AudioInputUpsertDto, { expectedRevision: 0 }],
    [AudioInputUpsertDto, { expectedRevision: Number.MAX_SAFE_INTEGER + 1 }],
    [AudioSceneUpsertDto, { presetNum: 13 }],
    [AudioSceneUpsertDto, { hint: 'x'.repeat(129) }],
    [AudioSceneUpsertDto, { content: { outputs: [{ ch: 0 }, { ch: 0 }] } }],
    [AudioSceneUpsertDto, { content: { outputs: [{ ch: 0, inputs: [1, 1] }] } }],
    [AudioSceneUpsertDto, { content: { outputs: [{ ch: 0, inputs: [8] }] } }],
    [AudioSceneUpsertDto, { content: { outputs: [{ ch: 0, volume: 101 }] } }],
    [AudioSceneUpsertDto, { content: { outputs: [{ ch: 0, muted: null }] } }],
    [AudioSceneUpsertDto, { content: { outputs: [{ ch: 0, arbitraryCommand: 'x' }] } }],
    [AudioSceneUpsertDto, { content: { outputs: Array(9).fill({ ch: 0 }) } }],
  ])('rejects invalid %p payload %p before reaching the service', async (metatype, payload) => {
    await expect(pipe.transform(payload, { type: 'body', metatype })).rejects.toMatchObject({
      status: 400,
    });
  });
  it('allows nullable fields, explicit empty routes and bounded valid values without coercing body types', async () => {
    const payload = {
      expectedRevision: 1,
      name: '场景',
      hint: null,
      content: { outputs: [{ ch: 7, inputs: [0, 7], volume: 0, muted: false }] },
    };
    expect(
      await pipe.transform(payload, { type: 'body', metatype: AudioSceneUpsertDto }),
    ).toMatchObject(payload);
    expect(
      await pipe.transform({ content: null }, { type: 'body', metatype: AudioSceneUpsertDto }),
    ).toMatchObject({ content: null });
    expect(
      await pipe.transform(
        { expectedRevision: '2' },
        { type: 'query', metatype: AudioDeleteQueryDto },
      ),
    ).toMatchObject({ expectedRevision: 2 });
  });
});

describe('audio config atomic revisions and audit', () => {
  let db: DataSource;
  let service: AudioConfigService;
  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: false,
      entities: [resolve(__dirname, '../../entities/*.entity.ts')],
      migrations: [resolve(__dirname, '../../migrations/*.ts')],
    }).initialize();
    await db.runMigrations();
    service = new AudioConfigService(
      db.getRepository(AudioOutputZone),
      db.getRepository(AudioInputSource),
      db.getRepository(AudioScene),
    );
  });
  afterEach(async () => {
    if (db?.isInitialized) await db.destroy();
  });
  it('increments both stereo rows and creates named audit entries in the same transaction', async () => {
    const before = await db.getRepository(AudioOutputZone).findOneByOrFail({ channel: 0 });
    const saved = await service.upsertZone(
      before.id,
      { name: '新名称', expectedRevision: 1 },
      actor,
    );
    expect(saved).toMatchObject({
      name: '新名称·左',
      configRevision: 2,
      pairedZone: { name: '新名称·右', configRevision: 2 },
    });
    const logs = await db.getRepository(AuditLog).findBy({ entityType: 'audio_output_zone' });
    expect(logs).toHaveLength(2);
    expect(logs.every((log) => log.operator === actor.username)).toBe(true);
    expect(JSON.parse(logs[0].snapshotBefore!)).toMatchObject({ configRevision: 1 });
    expect(JSON.parse(logs[0].snapshotAfter!)).toMatchObject({ configRevision: 2 });
    await expect(
      service.upsertZone(saved.pairedZone!.id, { name: 'old editor', expectedRevision: 1 }, actor),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('rejects stale input metadata and preserves live desired gain/mute', async () => {
    const input = await db.getRepository(AudioInputSource).findOneByOrFail({ channel: 0 });
    await db.query(
      'UPDATE audio_input_source SET desired_gain_db = 3.2, desired_muted = 1 WHERE id = ?',
      [input.id],
    );
    const saved = await service.upsertInput(
      input.id,
      { name: 'updated', expectedRevision: 1 },
      actor,
    );
    expect(saved).toMatchObject({ configRevision: 2, desiredGainDb: 3.2, desiredMuted: true });
    await expect(
      service.upsertInput(input.id, { name: 'stale', expectedRevision: 1 }, actor),
    ).rejects.toMatchObject({ response: { code: 'AUDIO_CONFIG_REVISION_CONFLICT' } });
  });
  it('one of two simultaneous writes wins; the other conflicts and leaves one audit', async () => {
    const scene = await db.getRepository(AudioScene).findOneByOrFail({ presetNum: 1 });
    const results = await Promise.allSettled(
      ['one', 'two'].map((name) =>
        service.upsertScene(scene.id, { name, expectedRevision: 1 }, actor),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect(await db.getRepository(AuditLog).countBy({ entityType: 'audio_scene' })).toBe(1);
  });
  it('no-op writes neither increment revisions nor create audit noise', async () => {
    const row = await db.getRepository(AudioInputSource).findOneByOrFail({ channel: 0 });
    const saved = await service.upsertInput(row.id, { name: row.name, expectedRevision: 1 }, actor);
    expect(saved.configRevision).toBe(1);
    expect(saved.updatedAt).toEqual(row.updatedAt);
    expect(await db.getRepository(AuditLog).count()).toBe(0);
  });
  it('normalizes scene ordering and supports explicit null without affecting omitted content', async () => {
    const row = await db.getRepository(AudioScene).findOneByOrFail({ presetNum: 1 });
    const saved = await service.upsertScene(
      row.id,
      {
        expectedRevision: 1,
        content: {
          outputs: [
            { ch: 3, inputs: [7, 0] },
            { ch: 1, volume: 10 },
          ],
        },
      },
      actor,
    );
    expect(JSON.parse(saved.content!)).toEqual({
      outputs: [
        { ch: 1, volume: 10 },
        { ch: 3, inputs: [0, 7] },
      ],
    });
    const renamed = await service.upsertScene(
      row.id,
      { expectedRevision: saved.configRevision, name: 'renamed' },
      actor,
    );
    expect(renamed.content).toBe(saved.content);
    expect(
      (
        await service.upsertScene(
          row.id,
          { expectedRevision: renamed.configRevision, content: null },
          actor,
        )
      ).content,
    ).toBeNull();
  });
  it('failed audit rolls back both sides of a stereo rename', async () => {
    const before = await db.getRepository(AudioOutputZone).find({ order: { id: 'ASC' } });
    await db.query(
      `CREATE TRIGGER fail_audio_audit BEFORE INSERT ON audit_logs WHEN NEW.entityType = 'audio_output_zone' AND NEW.entityId = '${before[1].id}' BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END`,
    );
    await expect(
      service.upsertZone(before[0].id, { name: 'must rollback', expectedRevision: 1 }, actor),
    ).rejects.toThrow('audit unavailable');
    expect(await db.getRepository(AudioOutputZone).find({ order: { id: 'ASC' } })).toEqual(before);
    expect(await db.getRepository(AuditLog).count()).toBe(0);
  });
  it('uses 409 for duplicate channels and 404 for deleted rows, not generic 500', async () => {
    await expect(service.upsertInput(null, { channel: 0 }, actor)).rejects.toMatchObject({
      response: { code: 'AUDIO_CONFIG_KEY_CONFLICT' },
    });
    await expect(service.upsertInput(99999, { name: 'missing' }, actor)).rejects.toMatchObject({
      status: 404,
    });
    await expect(service.upsertInput(null, {}, actor)).rejects.toMatchObject({ status: 400 });
    expect(await db.getRepository(AuditLog).count()).toBe(0);
  });
  it('guards deletes by revision, audits the old row and allows bounded legacy writes', async () => {
    const row = await db.getRepository(AudioInputSource).findOneByOrFail({ channel: 0 });
    const saved = await service.upsertInput(row.id, { name: 'legacy updated' }, actor);
    expect(saved.configRevision).toBe(2);
    await expect(service.deleteInput(row.id, 1, actor)).rejects.toMatchObject({ status: 409 });
    expect(await service.deleteInput(row.id, 2, actor)).toEqual({ removedId: row.id });
    expect(await db.getRepository(AudioInputSource).findOneBy({ id: row.id })).toBeNull();
    const audit = await db
      .getRepository(AuditLog)
      .findOneByOrFail({ entityType: 'audio_input_source', action: 'delete' });
    expect(JSON.parse(audit.snapshotBefore!)).toMatchObject({ id: row.id, configRevision: 2 });
  });
  it('rejects operators and revoked named administrators inside the transaction', async () => {
    await expect(
      service.upsertInput(null, { channel: 0 }, { ...actor, role: 'operator' }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.upsertInput(null, { channel: 0 }, { ...actor, kind: 'user', userId: 123 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('slow device capture cannot overwrite a concurrent input name or revision', async () => {
    const row = await db.getRepository(AudioInputSource).findOneByOrFail({ channel: 0 });
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const adapter = {
      readFullMatrix: async () => ({ ok: true, data: { matrix: [] } }),
      diagnoseInput: async (channel: number) => {
        if (channel !== 0) return { ok: false };
        started();
        await barrier;
        return { ok: true, data: { gainDb: 2.4, muted: true } };
      },
    };
    const controller = new AudioController(
      adapter as never,
      {} as never,
      service,
      { noteWrite() {} } as never,
      {} as never,
      db.getRepository(AudioInputSource),
    );
    const capture = controller.captureDesired();
    await waiting;
    await service.upsertInput(
      row.id,
      { name: 'edited during device read', expectedRevision: 1 },
      actor,
    );
    release();
    await capture;
    expect(await db.getRepository(AudioInputSource).findOneByOrFail({ id: row.id })).toMatchObject({
      name: 'edited during device read',
      configRevision: 2,
      desiredGainDb: 2.4,
      desiredMuted: true,
    });
  });

  it('gain intent waits for a failed catalog transaction and is not rolled back with it', async () => {
    let release!: () => void, started!: () => void;
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const failedConfig = serializedTransaction(db, async (manager) => {
      await manager.update(AudioInputSource, { channel: 0 }, { name: 'will rollback' });
      started();
      await barrier;
      throw new Error('synthetic catalog failure');
    });
    await waiting;
    const adapter = { setInputVolume: jest.fn().mockResolvedValue({ ok: true }) };
    const controller = new AudioController(
      adapter as never,
      { record: jest.fn() } as never,
      service,
      { noteWrite() {} } as never,
      {} as never,
      db.getRepository(AudioInputSource),
    );
    const gain = controller.setInputGain(0, { value: 50 });
    expect(adapter.setInputVolume).not.toHaveBeenCalled();
    const failure = expect(failedConfig).rejects.toThrow('synthetic catalog failure');
    release();
    await failure;
    await gain;
    const input = await db.getRepository(AudioInputSource).findOneByOrFail({ channel: 0 });
    expect(input.name).not.toBe('will rollback');
    expect(input.configRevision).toBe(1);
    expect(input.desiredGainDb).toBe(-10);
  });
});
