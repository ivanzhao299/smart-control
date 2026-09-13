import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { AdapterConfig } from '../common/config/configuration';
import { AbortedError, AdapterContext, AdapterResult, sleep } from './adapter.types';

@Injectable()
export abstract class BaseAdapter {
  protected readonly adapterCfg: AdapterConfig;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) protected readonly logger: Logger,
  ) {
    this.adapterCfg = config.getOrThrow<AdapterConfig>('adapter');
  }

  abstract get deviceType(): string;

  protected isMock(): boolean {
    return this.adapterCfg.mock;
  }

  protected async run<T>(
    deviceId: string,
    command: string,
    ctx: AdapterContext | undefined,
    impl: () => Promise<T>,
  ): Promise<AdapterResult<T>> {
    const startedAt = Date.now();
    const signal = ctx?.signal;
    if (signal?.aborted) {
      return {
        ok: false,
        deviceId,
        command,
        error: 'aborted',
        mock: this.isMock(),
        durationMs: 0,
      };
    }

    try {
      if (this.isMock()) {
        await sleep(this.adapterCfg.mockLatencyMs, signal);
      }
      const data = await impl();
      return {
        ok: true,
        deviceId,
        command,
        data,
        mock: this.isMock(),
        durationMs: Date.now() - startedAt,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!(err instanceof AbortedError)) {
        this.logger.warn(
          `[${this.deviceType}] ${command} on ${deviceId} failed: ${message}`,
          { context: this.constructor.name },
        );
      }
      return {
        ok: false,
        deviceId,
        command,
        error: message,
        mock: this.isMock(),
        durationMs: Date.now() - startedAt,
      };
    }
  }

  protected ensureMockOrThrow(command: string): void {
    if (!this.isMock()) {
      throw new Error(
        `${this.constructor.name}.${command} 真实协议尚未实现 (Sprint-03 仅 mock)`,
      );
    }
  }
}
