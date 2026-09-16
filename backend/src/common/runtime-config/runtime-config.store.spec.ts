import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { RuntimeConfigDocument } from '../../entities/runtime-config-document.entity';
import { RuntimeConfigRevision } from '../../entities/runtime-config-revision.entity';
import { RuntimeConfigStore } from './runtime-config.store';

interface TestConfig {
  enabled: boolean;
  label: string;
}

const normalize = (input: unknown): TestConfig => {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('config must be an object');
  const value = input as Record<string, unknown>;
  if (typeof value.enabled !== 'boolean') throw new Error('enabled must be boolean');
  if (typeof value.label !== 'string' || value.label.length > 40) throw new Error('invalid label');
  return { enabled: value.enabled, label: value.label };
};

describe('RuntimeConfigStore', () => {
  let dataSource: DataSource;
  let store: RuntimeConfigStore;

  beforeEach(async () => {
    dataSource = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [RuntimeConfigDocument, RuntimeConfigRevision],
      synchronize: true,
    }).initialize();
    store = new RuntimeConfigStore(dataSource);
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('initializes once and preserves the existing authoritative document', async () => {
    const first = await store.initialize({
      key: 'test.config',
      schemaVersion: 1,
      value: { enabled: true, label: 'first' },
      normalize,
      source: 'legacy-json-import',
    });
    const repeated = await store.initialize({
      key: 'test.config',
      schemaVersion: 1,
      value: { enabled: false, label: 'must-not-overwrite' },
      normalize,
    });

    expect(first).toMatchObject({ revision: 1, value: { enabled: true, label: 'first' } });
    expect(repeated).toEqual(first);
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(1);
  });

  it('writes the current value and immutable history in one revision', async () => {
    const initial = await store.initialize({
      key: 'test.config',
      schemaVersion: 1,
      value: { enabled: true, label: 'v1' },
      normalize,
    });
    const updated = await store.update({
      key: 'test.config',
      schemaVersion: 1,
      expectedRevision: initial.revision,
      value: { enabled: false, label: 'v2' },
      normalize,
      actor: 'administrator',
      source: 'PUT /api/test-config',
    });

    expect(updated).toMatchObject({ revision: 2, value: { enabled: false, label: 'v2' } });
    expect(await store.read('test.config', normalize)).toEqual(updated);
    const history = await store.history('test.config', normalize);
    expect(history.map((item) => item.revision)).toEqual([2, 1]);
    expect(history[0].checksum).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects stale writes instead of losing a newer edit', async () => {
    const initial = await store.initialize({
      key: 'test.config',
      schemaVersion: 1,
      value: { enabled: true, label: 'v1' },
      normalize,
    });
    await store.update({
      key: 'test.config',
      schemaVersion: 1,
      expectedRevision: initial.revision,
      value: { enabled: true, label: 'newer' },
      normalize,
    });

    await expect(
      store.update({
        key: 'test.config',
        schemaVersion: 1,
        expectedRevision: initial.revision,
        value: { enabled: false, label: 'stale' },
        normalize,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await store.read('test.config', normalize))?.value.label).toBe('newer');
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(2);
  });

  it('serializes simultaneous writers and commits exactly one revision', async () => {
    const initial = await store.initialize({
      key: 'test.config',
      schemaVersion: 1,
      value: { enabled: true, label: 'v1' },
      normalize,
    });
    const writes = await Promise.allSettled([
      store.update({
        key: 'test.config',
        schemaVersion: 1,
        expectedRevision: initial.revision,
        value: { enabled: true, label: 'writer-a' },
        normalize,
      }),
      store.update({
        key: 'test.config',
        schemaVersion: 1,
        expectedRevision: initial.revision,
        value: { enabled: true, label: 'writer-b' },
        normalize,
      }),
    ]);

    expect(writes.map((result) => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect((await store.read('test.config', normalize))?.revision).toBe(2);
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(2);
  });

  it('does not create a new revision for an identical document', async () => {
    const initial = await store.initialize({
      key: 'test.config',
      schemaVersion: 1,
      value: { enabled: true, label: 'same' },
      normalize,
    });
    const same = await store.update({
      key: 'test.config',
      schemaVersion: 1,
      expectedRevision: initial.revision,
      value: { enabled: true, label: 'same' },
      normalize,
    });

    expect(same.revision).toBe(1);
    expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(1);
  });

  it('rolls back the current document when history persistence fails', async () => {
    const initial = await store.initialize({
      key: 'test.config',
      schemaVersion: 1,
      value: { enabled: true, label: 'v1' },
      normalize,
    });
    await dataSource.getRepository(RuntimeConfigRevision).save({
      key: 'test.config',
      schemaVersion: 1,
      revision: 2,
      document: JSON.stringify(initial.value),
      documentSha256: initial.checksum,
      actor: 'test',
      source: 'forced-conflict',
    });

    await expect(
      store.update({
        key: 'test.config',
        schemaVersion: 1,
        expectedRevision: 1,
        value: { enabled: false, label: 'must-roll-back' },
        normalize,
      }),
    ).rejects.toThrow();
    expect(await store.read('test.config', normalize)).toEqual(initial);
  });

  it('detects corruption before returning configuration', async () => {
    await store.initialize({
      key: 'test.config',
      schemaVersion: 1,
      value: { enabled: true, label: 'valid' },
      normalize,
    });
    await dataSource
      .getRepository(RuntimeConfigDocument)
      .update(
        { key: 'test.config' },
        { document: JSON.stringify({ enabled: false, label: 'tampered' }) },
      );

    await expect(store.read('test.config', normalize)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('validates keys, versions and document size before writing', async () => {
    await expect(
      store.initialize({
        key: '../invalid',
        schemaVersion: 1,
        value: { enabled: true, label: 'x' },
        normalize,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      store.initialize({
        key: 'test.config',
        schemaVersion: 0,
        value: { enabled: true, label: 'x' },
        normalize,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      store.initialize({
        key: 'test.config',
        schemaVersion: 1,
        value: { enabled: true, label: 'x'.repeat(41) },
        normalize,
      }),
    ).rejects.toThrow('invalid label');
    await expect(
      store.initialize({
        key: 'test.large',
        schemaVersion: 1,
        value: { payload: 'x'.repeat(1024 * 1024) },
        normalize: (input) => input as { payload: string },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
