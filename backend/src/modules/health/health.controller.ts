import { Controller, Get, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { AppConfig } from '../../common/config/configuration';

interface HealthResponse {
  success: true;
  status: 'running';
  app: string;
  env: string;
  uptime: number;
  database: 'connected' | 'disconnected';
  timestamp: string;
}

@Controller('system')
export class HealthController {
  private readonly startedAt = Date.now();

  constructor(
    private readonly config: ConfigService,
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  @Get('health')
  async health(): Promise<HealthResponse> {
    const app = this.config.getOrThrow<AppConfig>('app');
    const dbStatus = await this.checkDatabase();

    this.logger.debug('Health check requested', { context: 'HealthController' });

    return {
      success: true,
      status: 'running',
      app: app.appName,
      env: app.nodeEnv,
      uptime: Math.floor((Date.now() - this.startedAt) / 1000),
      database: dbStatus,
      timestamp: new Date().toISOString(),
    };
  }

  private async checkDatabase(): Promise<'connected' | 'disconnected'> {
    try {
      if (!this.dataSource.isInitialized) return 'disconnected';
      await this.dataSource.query('SELECT 1');
      return 'connected';
    } catch (err) {
      this.logger.warn(`Database health probe failed: ${(err as Error).message}`, {
        context: 'HealthController',
      });
      return 'disconnected';
    }
  }
}
