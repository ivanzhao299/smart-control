#!/usr/bin/env node
/**
 * 把初始基线迁移标记为"已执行" —— 不执行它。
 *
 * 【为什么需要这个】
 * 生产库是靠 DB_SYNCHRONIZE=true 一路自动同步出来的, 表和数据都已经在了。
 * 基线迁移(InitialBaseline)里是 33 条 CREATE TABLE —— 如果直接 migration:run,
 * TypeORM 会真的去建表, 轻则报表已存在而中断, 重则在某些路径上重建表把数据冲掉。
 *
 * 正确做法: 往 migrations 表插一条记录, 告诉 TypeORM"这个基线已经生效了",
 * 之后 migration:run 就会从基线之后的迁移开始跑。这等价于其它框架里的
 * `migrate --fake` / `baseline`, 但 TypeORM 没有内置该命令, 所以自己写。
 *
 * 【前置条件(务必先确认)】
 * 在生产上跑过 `npm run schema:log`, 输出必须是 "schema is up to date"。
 * 那代表实体定义与真实库结构零 drift, 基线才真的等于当前生产 schema。
 * 有 drift 却标记基线 = 后续所有迁移都建立在错误的起点上。
 *
 * 【安全性】
 * - 幂等: 已标记过就跳过, 重复执行无副作用
 * - 只 INSERT 一行元数据, 不碰任何业务表
 * - 执行前自动复制一份 DB 快照, 出问题可以直接还原
 *
 * 用法: node scripts/mark-migration-baseline.js
 */
const fs = require('fs');
const path = require('path');

function loadEnvFile(cwd) {
  const p = path.resolve(cwd, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf-8').split('\n')) {
    if (line.trim().startsWith('#')) continue;
    const m = /^\s*([\w.-]+)\s*=\s*(.*)?\s*$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = (m[2] ?? '').trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

function main() {
  const cwd = process.cwd();
  loadEnvFile(cwd);

  const rawPath = process.env.DB_PATH || './database/smart-control.db';
  const dbPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);

  // 诊断: 这几行是必要的 —— 之前有一次 .env 没被解析到, 脚本悄悄退到默认路径
  // ./database/... 于是在 backend/ 下**新建了一个空库**并在里面标记, 而真正的
  // 生产库什么也没发生。路径这种东西必须打出来, 不能靠事后从备份文件名反推。
  console.log(`[baseline] cwd      = ${cwd}`);
  console.log(`[baseline] .env     = ${fs.existsSync(path.resolve(cwd, '.env')) ? '已找到' : '**未找到**'}`);
  console.log(`[baseline] DB_PATH  = ${process.env.DB_PATH ?? '(未解析到, 用默认值)'}`);
  console.log(`[baseline] 实际库    = ${dbPath}`);

  if (!fs.existsSync(dbPath)) {
    console.error(`[baseline] 数据库不存在: ${dbPath}`);
    console.error('[baseline] 拒绝在不存在的库上建表 —— 那只会凭空造出一个空库。');
    console.error('[baseline] 请检查 cwd 是否为 backend/, 或显式指定 DB_PATH 环境变量。');
    process.exit(1);
  }

  // 找基线迁移: migrations 目录里 timestamp 最小的那个
  const dirs = [path.resolve(cwd, 'dist/migrations'), path.resolve(cwd, 'src/migrations')];
  const dir = dirs.find((d) => fs.existsSync(d));
  if (!dir) {
    console.error('[baseline] 找不到 migrations 目录');
    process.exit(1);
  }
  const found = fs
    .readdirSync(dir)
    // 必须排掉 .d.ts: 贪婪匹配会把 "1784561601801-InitialBaseline.d.ts" 里的
    // "InitialBaseline.d" 当成类名, 标出来的记录跟 TypeORM 实际认的名字对不上,
    // migration:show 依旧显示未执行 —— 这个坑本地跑一次就暴露了
    .filter((f) => !f.endsWith('.d.ts') && !f.endsWith('.js.map'))
    .map((f) => /^(\d+)-(.+)\.(js|ts)$/.exec(f))
    .filter(Boolean)
    .map((m) => ({ timestamp: Number(m[1]), name: `${m[2]}${m[1]}` }))
    .sort((a, b) => a.timestamp - b.timestamp);
  if (found.length === 0) {
    console.error(`[baseline] ${dir} 下没有迁移文件`);
    process.exit(1);
  }
  const baseline = found[0];

  const Database = require('better-sqlite3');
  const db = new Database(dbPath);

  db.exec(
    'CREATE TABLE IF NOT EXISTS "migrations" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "timestamp" bigint NOT NULL, "name" varchar NOT NULL)',
  );

  const existing = db
    .prepare('SELECT id FROM "migrations" WHERE "name" = ?')
    .get(baseline.name);
  if (existing) {
    console.log(`[baseline] 已标记过, 跳过: ${baseline.name}`);
    db.close();
    return;
  }

  // 动元数据之前先留一份快照 —— 这一步理论上无害, 但生产库不赌"理论上"
  const snap = `${dbPath}.pre-baseline-${Date.now()}.bak`;
  fs.copyFileSync(dbPath, snap);
  console.log(`[baseline] 已备份: ${snap}`);

  db.prepare('INSERT INTO "migrations" ("timestamp", "name") VALUES (?, ?)').run(
    baseline.timestamp,
    baseline.name,
  );
  console.log(`[baseline] 已标记为已执行: ${baseline.name} (timestamp=${baseline.timestamp})`);

  const rows = db.prepare('SELECT "timestamp", "name" FROM "migrations" ORDER BY "timestamp"').all();
  console.log(`[baseline] migrations 表当前 ${rows.length} 条:`);
  for (const r of rows) console.log(`  ${r.timestamp}  ${r.name}`);
  db.close();
  console.log('[baseline] 完成。下一步: 把 .env 的 DB_SYNCHRONIZE 改成 false 并重启后端。');
}

main();
