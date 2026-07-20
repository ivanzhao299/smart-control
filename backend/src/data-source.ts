import 'reflect-metadata';
import { existsSync, readFileSync } from 'fs';
import { isAbsolute, resolve } from 'path';
import { DataSource } from 'typeorm';

/**
 * TypeORM CLI 专用 DataSource —— 只给 migration:generate / migration:run 用,
 * 运行时走的是 app.module 里的 TypeOrmConfigService。
 *
 * 【为什么要有迁移】
 * 生产一直开着 DB_SYNCHRONIZE=true: TypeORM 每次启动按实体自动改表。加表、加列
 * 是安全的(playMode、hvac 排序字段都是这么加上去的), 但**改列类型、改关系、删列
 * 会 DROP 重建 —— 数据静默消失, 而且没有任何记录可审**。
 * 系统要做成能复制到多场馆的产品, 设备模型迟早要重构(device_instances 那一层),
 * 那时候必须有可审、可回滚的迁移, 不能再靠 synchronize 猜。
 *
 * 【两边必须完全一致】
 * database / entities 的解析规则跟 configuration.ts 保持逐字一致(相对路径基于
 * process.cwd())—— 一旦 CLI 和运行时指到不同的库, 生成的迁移就是错的。
 *
 * synchronize 在这里**永远是 false**: CLI 的职责是产出迁移, 不是改库。
 */
/**
 * 极简 .env 读取 —— 刻意不引 dotenv: 它不是本项目的依赖(运行时用 @nestjs/config),
 * 为一个 CLI 入口新增一个生产依赖不划算。已存在的环境变量优先, 所以
 * `DB_PATH=xxx npm run migration:run` 这种显式覆盖始终有效。
 */
function loadEnvFile(): void {
  const envPath = resolve(process.cwd(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const key = m[1];
    if (process.env[key] !== undefined) continue;
    let val = (m[2] ?? '').trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    process.env[key] = val;
  }
}

loadEnvFile();

const resolvePath = (raw: string | undefined, fallback: string): string => {
  const p = raw ?? fallback;
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
};

export default new DataSource({
  type: 'better-sqlite3',
  database: resolvePath(process.env.DB_PATH, './database/smart-control.db'),
  entities: [resolve(__dirname, 'entities/*.entity{.ts,.js}')],
  migrations: [resolve(__dirname, 'migrations/*{.ts,.js}')],
  migrationsTableName: 'migrations',
  synchronize: false,
  logging: false,
});
