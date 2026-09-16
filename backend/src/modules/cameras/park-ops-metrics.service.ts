import { ConflictException, Injectable, OnModuleInit } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import { ensureRuntimeDataDir } from '../../common/storage/runtime-data-path';
import {
  normalizeParkOpsMetrics,
  PARK_OPS_METRICS_CONFIG_KEY,
  PARK_OPS_METRICS_SCHEMA_VERSION,
  ParkOpsMetricsDocument,
} from './park-ops-metrics-config';

interface LegacyMetrics {
  value: ParkOpsMetricsDocument;
  source: string;
}

@Injectable()
export class ParkOpsMetricsService implements OnModuleInit {
  private readonly filePath: string;
  private readonly backupPath: string;
  private current: ParkOpsMetricsDocument | null = null;
  private revision = 0;
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(private readonly store: RuntimeConfigStore) {
    const dataDir = ensureRuntimeDataDir();
    this.filePath = join(dataDir, 'park-ops-metrics.json');
    this.backupPath = `${this.filePath}.bak`;
  }

  async onModuleInit(): Promise<void> {
    const stored = await this.store.read(PARK_OPS_METRICS_CONFIG_KEY, normalizeParkOpsMetrics);
    if (stored) {
      this.current = stored.value;
      this.revision = stored.revision;
      return;
    }

    const legacy = this.readLegacy();
    if (!legacy) return;
    const initialized = await this.store.initialize({
      key: PARK_OPS_METRICS_CONFIG_KEY,
      schemaVersion: PARK_OPS_METRICS_SCHEMA_VERSION,
      value: legacy.value,
      normalize: normalizeParkOpsMetrics,
      actor: 'migration',
      source: legacy.source,
    });
    this.current = initialized.value;
    this.revision = initialized.revision;
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

  private readLegacy(): LegacyMetrics | null {
    let found = false;
    let lastError: unknown;
    for (const candidate of [this.filePath, this.backupPath]) {
      if (!existsSync(candidate)) continue;
      found = true;
      try {
        return {
          value: normalizeParkOpsMetrics(JSON.parse(readFileSync(candidate, 'utf8'))),
          source:
            candidate === this.backupPath
              ? 'legacy-json:park-ops-metrics.json.bak'
              : 'legacy-json:park-ops-metrics.json',
        };
      } catch (error) {
        lastError = error;
      }
    }
    if (found) throw new Error(`PARK_OPS_METRICS_IMPORT_FAILED: ${String(lastError)}`);
    return null;
  }
}
