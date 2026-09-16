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
  private revision = 0;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: RuntimeConfigStore) {}

  async onModuleInit(): Promise<void> {
    const stored = await this.store.read(PARK_OPS_METRICS_CONFIG_KEY, normalizeParkOpsMetrics);
    this.current = stored?.value ?? null;
    this.revision = stored?.revision ?? 0;
  }

  get(): ParkOpsMetricsDocument | null {
    return this.current ? structuredClone(this.current) : null;
  }

  update(input: unknown): Promise<ParkOpsMetricsDocument> {
    const normalized = normalizeParkOpsMetrics(input);
    const operation = this.mutationQueue.then(() => this.save(normalized));
    this.mutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async save(value: ParkOpsMetricsDocument): Promise<ParkOpsMetricsDocument> {
    try {
      if (this.revision === 0) {
        const initialized = await this.store.initialize({
          key: PARK_OPS_METRICS_CONFIG_KEY,
          schemaVersion: PARK_OPS_METRICS_SCHEMA_VERSION,
          value,
          normalize: normalizeParkOpsMetrics,
          actor: 'admin-api',
          source: 'PUT /api/park-ops-metrics',
        });
        this.current = initialized.value;
        this.revision = initialized.revision;

        if (JSON.stringify(initialized.value) === JSON.stringify(value)) {
          return structuredClone(initialized.value);
        }
      }

      const saved = await this.store.update({
        key: PARK_OPS_METRICS_CONFIG_KEY,
        schemaVersion: PARK_OPS_METRICS_SCHEMA_VERSION,
        expectedRevision: this.revision,
        value,
        normalize: normalizeParkOpsMetrics,
        actor: 'admin-api',
        source: 'PUT /api/park-ops-metrics',
      });
      this.current = saved.value;
      this.revision = saved.revision;
      return structuredClone(saved.value);
    } catch (error) {
      if (error instanceof ConflictException) {
        const latest = await this.store.read(PARK_OPS_METRICS_CONFIG_KEY, normalizeParkOpsMetrics);
        if (latest) {
          this.current = latest.value;
          this.revision = latest.revision;
        }
      }
      throw error;
    }
  }
}
