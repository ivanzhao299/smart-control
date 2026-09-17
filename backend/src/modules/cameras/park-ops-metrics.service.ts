import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import {
  normalizeParkOpsMetrics,
  PARK_OPS_METRICS_CONFIG_KEY,
  PARK_OPS_METRICS_SCHEMA_VERSION,
  ParkOpsMetricsDocument,
} from './park-ops-metrics-config';

@Injectable()
export class ParkOpsMetricsService implements OnModuleInit {
  private current: ParkOpsMetricsDocument | null = null;
  private cachedRevision = 0;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: RuntimeConfigStore) {}

  async onModuleInit(): Promise<void> {
    await this.getSnapshot();
  }

  get(): ParkOpsMetricsDocument | null {
    return this.current ? structuredClone(this.current) : null;
  }

  async getSnapshot() {
    const stored = await this.store.read(PARK_OPS_METRICS_CONFIG_KEY, normalizeParkOpsMetrics);
    if ((stored?.revision ?? 0) >= this.cachedRevision) {
      this.current = stored?.value ?? null;
      this.cachedRevision = stored?.revision ?? 0;
    }
    return {
      document: stored ? structuredClone(stored.value) : null,
      revision: stored?.revision ?? 0,
      checksum: stored?.checksum ?? null,
      updatedAt: stored?.updatedAt ?? null,
    };
  }

  /** Compatibility bridge for already-open old PWA editors. */
  async update(
    input: unknown,
    context: { expectedRevision?: number; actor?: string } = {},
  ): Promise<ParkOpsMetricsDocument> {
    return (await this.updateSnapshot(input, context)).document;
  }

  updateSnapshot(input: unknown, context: { expectedRevision?: number; actor?: string } = {}) {
    const normalized = normalizeParkOpsMetrics(input);
    const boundContext = { ...context };
    const operation = this.mutationQueue.then(() => this.save(normalized, boundContext));
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async save(
    value: ParkOpsMetricsDocument,
    context: { expectedRevision?: number; actor?: string },
  ) {
    try {
      const current = await this.getSnapshot();
      if (context.expectedRevision !== undefined && context.expectedRevision !== current.revision) {
        throw new ConflictException({
          code: 'PARK_OPS_METRICS_REVISION_CONFLICT',
          expectedRevision: context.expectedRevision,
          actualRevision: current.revision,
        });
      }
      const options = {
        key: PARK_OPS_METRICS_CONFIG_KEY,
        schemaVersion: PARK_OPS_METRICS_SCHEMA_VERSION,
        value,
        normalize: normalizeParkOpsMetrics,
        actor: context.actor ?? 'admin-api',
        source:
          context.expectedRevision === undefined
            ? 'PUT /api/park-ops-metrics'
            : 'PUT /api/park-ops-metrics/editor',
      };
      const saved =
        current.revision === 0
          ? await this.store.initialize({ ...options, expectedRevision: 0 })
          : await this.store.update({ ...options, expectedRevision: current.revision });
      this.current = saved.value;
      this.cachedRevision = saved.revision;
      return {
        document: structuredClone(saved.value),
        revision: saved.revision,
        checksum: saved.checksum,
        updatedAt: saved.updatedAt,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        const latest = await this.getSnapshot();
        throw new ConflictException({
          code: 'PARK_OPS_METRICS_REVISION_CONFLICT',
          message: '运营数据已被其他管理员更新，请重新载入后再保存；当前编辑内容未覆盖服务端。',
          expectedRevision: context.expectedRevision,
          actualRevision: latest.revision,
        });
      }
      throw error;
    }
  }
}
