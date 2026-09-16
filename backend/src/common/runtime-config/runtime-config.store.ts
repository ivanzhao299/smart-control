import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import { RuntimeConfigDocument } from '../../entities/runtime-config-document.entity';
import { RuntimeConfigRevision } from '../../entities/runtime-config-revision.entity';
import { serializedTransaction } from '../utils/serialized-transaction';

export type RuntimeConfigNormalizer<T> = (input: unknown) => T;

export interface RuntimeConfigSnapshot<T> {
  key: string;
  schemaVersion: number;
  revision: number;
  value: T;
  checksum: string;
  updatedAt: string;
}

export interface RuntimeConfigWriteOptions<T> {
  key: string;
  schemaVersion: number;
  value: unknown;
  normalize: RuntimeConfigNormalizer<T>;
  actor?: string;
  source?: string;
}

export interface RuntimeConfigUpdateOptions<T> extends RuntimeConfigWriteOptions<T> {
  expectedRevision: number;
}

interface EncodedDocument<T> {
  value: T;
  document: string;
  checksum: string;
}

const MAX_DOCUMENT_BYTES = 1024 * 1024;
const KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,99}$/;

@Injectable()
export class RuntimeConfigStore {
  private readonly logger = new Logger(RuntimeConfigStore.name);

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  async read<T>(
    key: string,
    normalize: RuntimeConfigNormalizer<T>,
  ): Promise<RuntimeConfigSnapshot<T> | null> {
    this.assertKey(key);
    const row = await this.dataSource
      .getRepository(RuntimeConfigDocument)
      .findOne({ where: { key } });
    return row ? this.decode(row, normalize) : null;
  }

  /** Creates revision 1 once. Existing data always wins, making legacy imports repeatable. */
  async initialize<T>(options: RuntimeConfigWriteOptions<T>): Promise<RuntimeConfigSnapshot<T>> {
    this.assertOptions(options);
    const encoded = this.encode(options.value, options.normalize);
    return serializedTransaction(this.dataSource, async (manager) => {
      const existing = await manager.findOne(RuntimeConfigDocument, {
        where: { key: options.key },
      });
      if (existing) return this.decode(existing, options.normalize);

      const now = new Date();
      const row = manager.create(RuntimeConfigDocument, {
        key: options.key,
        schemaVersion: options.schemaVersion,
        revision: 1,
        document: encoded.document,
        documentSha256: encoded.checksum,
        createdAt: now,
        updatedAt: now,
      });
      await manager.save(row);
      await this.appendRevision(manager, row, options.actor, options.source);
      this.logger.log(`Initialized ${options.key} at revision 1`);
      return this.toSnapshot(row, encoded.value);
    });
  }

  /** Compare-and-swap update; a stale editor receives HTTP 409 instead of overwriting newer data. */
  async update<T>(options: RuntimeConfigUpdateOptions<T>): Promise<RuntimeConfigSnapshot<T>> {
    this.assertOptions(options);
    if (!Number.isInteger(options.expectedRevision) || options.expectedRevision < 1) {
      throw new BadRequestException('expectedRevision must be a positive integer');
    }
    const encoded = this.encode(options.value, options.normalize);
    return serializedTransaction(this.dataSource, async (manager) => {
      const current = await manager.findOne(RuntimeConfigDocument, { where: { key: options.key } });
      if (!current)
        throw new NotFoundException(`Runtime configuration ${options.key} does not exist`);
      this.verifyChecksum(current.key, current.document, current.documentSha256);
      if (current.revision !== options.expectedRevision) {
        throw new ConflictException({
          code: 'RUNTIME_CONFIG_REVISION_CONFLICT',
          key: options.key,
          expectedRevision: options.expectedRevision,
          actualRevision: current.revision,
        });
      }
      if (
        current.documentSha256 === encoded.checksum &&
        current.schemaVersion === options.schemaVersion
      ) {
        return this.toSnapshot(current, encoded.value);
      }

      const nextRevision = current.revision + 1;
      const updatedAt = new Date();
      const result = await manager.update(
        RuntimeConfigDocument,
        { key: options.key, revision: options.expectedRevision },
        {
          schemaVersion: options.schemaVersion,
          revision: nextRevision,
          document: encoded.document,
          documentSha256: encoded.checksum,
          updatedAt,
        },
      );
      if (result.affected !== 1) {
        const latest = await manager.findOne(RuntimeConfigDocument, {
          where: { key: options.key },
        });
        throw new ConflictException({
          code: 'RUNTIME_CONFIG_REVISION_CONFLICT',
          key: options.key,
          expectedRevision: options.expectedRevision,
          actualRevision: latest?.revision ?? null,
        });
      }

      const next = manager.create(RuntimeConfigDocument, {
        ...current,
        schemaVersion: options.schemaVersion,
        revision: nextRevision,
        document: encoded.document,
        documentSha256: encoded.checksum,
        updatedAt,
      });
      await this.appendRevision(manager, next, options.actor, options.source);
      return this.toSnapshot(next, encoded.value);
    });
  }

  async history<T>(
    key: string,
    normalize: RuntimeConfigNormalizer<T>,
    limit = 20,
  ): Promise<RuntimeConfigSnapshot<T>[]> {
    this.assertKey(key);
    const safeLimit = Math.min(200, Math.max(1, Math.trunc(limit)));
    const rows = await this.dataSource.getRepository(RuntimeConfigRevision).find({
      where: { key },
      order: { revision: 'DESC' },
      take: safeLimit,
    });
    return rows.map((row) => {
      this.verifyChecksum(row.key, row.document, row.documentSha256);
      return {
        key: row.key,
        schemaVersion: row.schemaVersion,
        revision: row.revision,
        value: normalize(this.parse(row.key, row.document)),
        checksum: row.documentSha256,
        updatedAt: row.createdAt.toISOString(),
      };
    });
  }

  private async appendRevision(
    manager: EntityManager,
    row: RuntimeConfigDocument,
    actor?: string,
    source?: string,
  ): Promise<void> {
    await manager.save(
      manager.create(RuntimeConfigRevision, {
        key: row.key,
        schemaVersion: row.schemaVersion,
        revision: row.revision,
        document: row.document,
        documentSha256: row.documentSha256,
        actor: this.safeLabel(actor, 64, 'system'),
        source: this.safeLabel(source, 160, 'runtime-config-store'),
      }),
    );
  }

  private decode<T>(
    row: RuntimeConfigDocument,
    normalize: RuntimeConfigNormalizer<T>,
  ): RuntimeConfigSnapshot<T> {
    this.verifyChecksum(row.key, row.document, row.documentSha256);
    return this.toSnapshot(row, normalize(this.parse(row.key, row.document)));
  }

  private toSnapshot<T>(row: RuntimeConfigDocument, value: T): RuntimeConfigSnapshot<T> {
    return {
      key: row.key,
      schemaVersion: row.schemaVersion,
      revision: row.revision,
      value,
      checksum: row.documentSha256,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private encode<T>(value: unknown, normalize: RuntimeConfigNormalizer<T>): EncodedDocument<T> {
    const normalized = normalize(value);
    const document = JSON.stringify(normalized);
    if (document === undefined)
      throw new BadRequestException('Runtime configuration is not serializable');
    if (Buffer.byteLength(document, 'utf8') > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException(`Runtime configuration exceeds ${MAX_DOCUMENT_BYTES} bytes`);
    }
    return { value: normalized, document, checksum: this.checksum(document) };
  }

  private parse(key: string, document: string): unknown {
    try {
      return JSON.parse(document);
    } catch {
      throw new ServiceUnavailableException({ code: 'RUNTIME_CONFIG_CORRUPT', key });
    }
  }

  private verifyChecksum(key: string, document: string, expected: string): void {
    if (this.checksum(document) !== expected) {
      throw new ServiceUnavailableException({ code: 'RUNTIME_CONFIG_CHECKSUM_MISMATCH', key });
    }
  }

  private checksum(document: string): string {
    return createHash('sha256').update(document, 'utf8').digest('hex');
  }

  private assertOptions(options: RuntimeConfigWriteOptions<unknown>): void {
    this.assertKey(options.key);
    if (!Number.isInteger(options.schemaVersion) || options.schemaVersion < 1) {
      throw new BadRequestException('schemaVersion must be a positive integer');
    }
  }

  private assertKey(key: string): void {
    if (!KEY_PATTERN.test(key)) throw new BadRequestException('Invalid runtime configuration key');
  }

  private safeLabel(value: string | undefined, maxLength: number, fallback: string): string {
    const trimmed = value?.trim();
    return (trimmed || fallback).slice(0, maxLength);
  }
}
