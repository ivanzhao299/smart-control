import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { DataSource } from 'typeorm';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { User } from '../../entities/user.entity';
import type { Actor, AuthenticatedRequest } from '../../common/auth/actor';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import { PowerCircuitsService } from './power-circuits.service';
import { PowerCircuitsController } from './power-circuits.controller';
import {
  CreatePowerConfigDto,
  UpdatePowerConfigDto,
  LegacyUpdatePowerConfigDto,
  PowerConfigRevisionQueryDto,
} from './power-config.dto';

const admin: Actor = { kind: 'admin', userId: null, username: 'power-admin', role: 'admin' };
const input = {
  code: 'synthetic',
  name: 'Test circuit',
  floor: '1F',
  gatewayCode: 'unused-hardware',
};
describe('Power configuration DTO', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const parse = (payload: unknown, metatype = UpdatePowerConfigDto) =>
    pipe.transform(payload, { type: 'body', metatype });
  it.each([
    { expectedRevision: undefined },
    { expectedRevision: null },
    { expectedRevision: '1' },
    { expectedRevision: 0 },
    { expectedRevision: Number.MAX_SAFE_INTEGER + 1 },
    { enabled: 'false' },
    { enabled: null },
    { relayChannel: 0 },
    { relayChannel: 33 },
    { relayChannel: 1.5 },
    { relayChannel: '1' },
    { meterAddress: 248 },
    { meterAddress: 0 },
    { ratedVoltage: null },
    { ratedVoltage: -1 },
    { ratedCurrent: 201 },
    { ratedPower: Infinity },
    { name: '  ' },
    { name: null },
    { name: 'x'.repeat(129) },
    { code: null },
    { reading: { on: true } },
    { configRevision: 10 },
    { actor: 'forged' },
  ])('rejects malformed or read-only input %p', async (patch) => {
    await expect(parse({ expectedRevision: 1, ...patch })).rejects.toMatchObject({ status: 400 });
  });
  it('retains explicit nulls, false and zero; strict creation cannot accept a version', async () => {
    await expect(
      parse({
        expectedRevision: 1,
        relayChannel: null,
        meterAddress: null,
        icon: null,
        enabled: false,
        ratedPower: 0,
      }),
    ).resolves.toMatchObject({ enabled: false, relayChannel: null, ratedPower: 0 });
    await expect(
      pipe.transform(
        { ...input, expectedRevision: 1 },
        { type: 'body', metatype: CreatePowerConfigDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform({ name: 'legacy' }, { type: 'body', metatype: LegacyUpdatePowerConfigDto }),
    ).resolves.toMatchObject({ name: 'legacy' });
    await expect(
      pipe.transform(
        { expectedRevision: '2' },
        { type: 'query', metatype: PowerConfigRevisionQueryDto },
      ),
    ).resolves.toMatchObject({ expectedRevision: 2 });
  });
});

describe('Power configuration atomic persistence and hardware isolation', () => {
  let db: DataSource, service: PowerCircuitsService, hardwareCall: jest.Mock;
  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [PowerCircuit, AuditLog, User],
      synchronize: true,
    }).initialize();
    hardwareCall = jest.fn(() => {
      throw new Error('Configuration must not access hardware');
    });
    const adapter = new Proxy({}, { get: () => hardwareCall });
    service = new PowerCircuitsService(
      db.getRepository(PowerCircuit),
      { findOne: hardwareCall } as never,
      adapter as never,
      adapter as never,
      adapter as never,
      { info: jest.fn() } as never,
      adapter as never,
    );
  });
  afterEach(async () => {
    await db.destroy();
  });
  it('creates, reads, changes and deletes metadata without any hardware read or command', async () => {
    const created = await service.saveConfiguration(null, input, admin);
    expect(created).toMatchObject({ configRevision: 1, relayChannel: null, name: input.name });
    expect(created).not.toHaveProperty('reading');
    expect(await service.listConfiguration()).toHaveLength(1);
    expect(await service.configuration(created.id)).toEqual(created);
    const updated = await service.saveConfiguration(
      created.id,
      { name: 'renamed', expectedRevision: 1 },
      admin,
    );
    expect(updated.configRevision).toBe(2);
    await service.remove(created.id, 2, admin);
    expect(await service.listConfiguration()).toEqual([]);
    expect(hardwareCall).not.toHaveBeenCalled();
    const history = await db.getRepository(AuditLog).find({ order: { id: 'ASC' } });
    expect(history.map((row) => row.action)).toEqual(['create', 'update', 'delete']);
    expect(
      history.every((row) => row.operator === admin.username && row.entityType === 'power_circuit'),
    ).toBe(true);
    expect(JSON.parse(history[1].snapshotBefore!)).toMatchObject({
      configRevision: 1,
      name: input.name,
    });
  });
  it('one concurrent edit wins, stale deletes fail, and no-op edits do not create history', async () => {
    const row = await service.saveConfiguration(null, input, admin);
    await service.saveConfiguration(row.id, { name: row.name, expectedRevision: 1 }, admin);
    expect(await db.getRepository(AuditLog).count()).toBe(1);
    const results = await Promise.allSettled(
      ['one', 'two'].map((name) =>
        service.saveConfiguration(row.id, { name, expectedRevision: 1 }, admin),
      ),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((result) => result.status === 'rejected')).toMatchObject({
      reason: { response: { code: 'POWER_CONFIG_REVISION_CONFLICT' } },
    });
    await expect(service.remove(row.id, 1, admin)).rejects.toMatchObject({ status: 409 });
    expect(await db.getRepository(AuditLog).count()).toBe(2);
  });
  it('rolls back configuration and revision if its audit insertion fails', async () => {
    const row = await service.saveConfiguration(null, input, admin);
    await db.query(
      "CREATE TRIGGER reject_power_audit BEFORE INSERT ON audit_logs WHEN NEW.entityType = 'power_circuit' BEGIN SELECT RAISE(ABORT, 'synthetic audit failure'); END",
    );
    await expect(
      service.saveConfiguration(row.id, { name: 'lost', expectedRevision: 1 }, admin),
    ).rejects.toThrow('synthetic audit failure');
    await expect(service.remove(row.id, 1, admin)).rejects.toThrow('synthetic audit failure');
    expect(await service.configuration(row.id)).toEqual(row);
    expect(await db.getRepository(AuditLog).count()).toBe(1);
  });
  it('returns stable duplicate/not-found errors and does not allow an invalid service-level payload', async () => {
    await service.saveConfiguration(null, input, admin);
    await expect(service.saveConfiguration(null, input, admin)).rejects.toMatchObject({
      response: { code: 'POWER_CONFIG_KEY_CONFLICT' },
    });
    await expect(
      service.saveConfiguration(999, { name: 'missing', expectedRevision: 1 }, admin),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.saveConfiguration(null, { ...input, ratedCurrent: -1 }, admin),
    ).rejects.toMatchObject({ status: 400 });
    expect(await db.getRepository(PowerCircuit).count()).toBe(1);
  });
  it('rechecks named administrator state inside the write transaction', async () => {
    const user = await db
      .getRepository(User)
      .save({ username: 'named', password: 'synthetic', role: 'admin', enabled: true });
    const actor: Actor = { ...admin, kind: 'user', userId: user.id, username: user.username };
    const row = await service.saveConfiguration(null, input, actor);
    await db.getRepository(User).update(user.id, { role: 'viewer' });
    await expect(
      service.saveConfiguration(row.id, { name: 'denied', expectedRevision: 1 }, actor),
    ).rejects.toMatchObject({ status: 403 });
    expect((await service.configuration(row.id)).name).toBe(input.name);
  });
  it('legacy writes still increase revision and audit, making stale modern writes fail', async () => {
    const row = await service.saveConfiguration(null, input, admin);
    await service.saveConfiguration(row.id, { name: 'legacy name' }, admin);
    await expect(
      service.saveConfiguration(row.id, { name: 'stale', expectedRevision: 1 }, admin),
    ).rejects.toMatchObject({ status: 409 });
    expect((await service.configuration(row.id)).configRevision).toBe(2);
  });
  it('all metadata endpoints verify actor and never accept a client-supplied actor', async () => {
    const controller = new PowerCircuitsController(service);
    for (const method of [
      controller.createConfiguration,
      controller.updateConfiguration,
      controller.removeConfiguration,
      controller.configuration,
      controller.configurationList,
      controller.create,
      controller.update,
      controller.remove,
      controller.rename,
    ]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, method)).toContain(AdminGuard);
    }
    await expect(
      controller.createConfiguration({} as AuthenticatedRequest, input),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      controller.createConfiguration(
        { actor: { ...admin, role: 'operator' } } as AuthenticatedRequest,
        input,
      ),
    ).rejects.toMatchObject({ status: 403 });
    expect(await db.getRepository(PowerCircuit).count()).toBe(0);
  });
});
