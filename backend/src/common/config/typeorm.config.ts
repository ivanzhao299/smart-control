import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions, TypeOrmOptionsFactory } from '@nestjs/typeorm';
import { dirname } from 'path';
import { mkdirSync } from 'fs';
import { DatabaseConfig } from './configuration';
import { assertSchemaReady } from './schema-readiness';

@Injectable()
export class TypeOrmConfigService implements TypeOrmOptionsFactory {
  constructor(private readonly config: ConfigService) {}

  createTypeOrmOptions(): TypeOrmModuleOptions {
    const cfg = this.config.getOrThrow<DatabaseConfig>('database');
    if (cfg.synchronize) {
      throw new Error('Multiuser schema requires explicit migrations. Set DB_SYNCHRONIZE=false and run migration:run against the backed-up target database.');
    }
    mkdirSync(dirname(cfg.path), { recursive: true });

    return {
      type: 'better-sqlite3',
      database: cfg.path,
      synchronize: cfg.synchronize,
      logging: cfg.logging,
      autoLoadEntities: true,
      entities: [__dirname + '/../../entities/*.entity{.ts,.js}'],
      // SQLite tuning (PERFORMANCE_AUDIT P1-#11):
      // - WAL: read 不被 write 阻塞, 配置查询从 ~8ms → 1-2ms
      // - synchronous=NORMAL: 比 FULL 快 ~3×, 还有 fsync, 崩溃丢最后 1ms 内事务可接受
      // - cache_size=-64000: 64 MB page cache (默认 2 MB), 热表全装下
      // - busy_timeout=5000: 写冲突自动等 5s, 不立即抛错
      prepareDatabase: (db: { pragma: (sql: string) => void; prepare: (sql: string) => { all(...args: unknown[]): any[] } }) => {
        assertSchemaReady(db);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = -64000');
        db.pragma('busy_timeout = 5000');
      },
    } as TypeOrmModuleOptions;
  }
}
