import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import { DatabaseConfig } from './configuration';

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  constructor(private readonly config: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const cfg = this.config.getOrThrow<DatabaseConfig>('database');
    mkdirSync(dirname(cfg.path), { recursive: true });

    return {
      type: 'better-sqlite3',
      database: cfg.path,
      synchronize: cfg.synchronize,
      logging: cfg.logging,
      autoLoadEntities: true,
      entities: [__dirname + '/../../entities/*.entity{.ts,.js}'],
    };
  }
}
