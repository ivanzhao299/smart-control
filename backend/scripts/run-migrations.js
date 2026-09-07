#!/usr/bin/env node
/**
 * 部署时执行数据库迁移 —— 用编译后的 dist, 不依赖 ts-node。
 *
 * synchronize 关掉之后, schema 变更全靠迁移。这个脚本挂在 deploy-from-ci.ps1 的
 * build 之后、重启之前跑, 所以每次部署新代码时未执行的迁移会自动应用。
 *
 * 设计要点:
 *   - 只有存在未执行迁移时才动手; 没有就直接跳过, 不留任何垃圾
 *   - 需要部署控制方提供持续停写核验，建立数据库/媒体配套包并隔离恢复演练
 *   - 普通CLI无停写控制方：有待执行迁移时拒绝，不用数据库单独备份放行
 *   - 不自动清理迁移备份; 保留策略需在确认不再需要恢复证据后单独执行
 *   - 每个迁移单独事务(SQLite DDL 支持事务): 中途失败只回滚那一个, 不留半吊子状态
 *   - 走 dist/data-source.js: 生产没有 ts-node, 也不该在部署热路径上依赖它
 *
 * 迁移尝试后部署失败必须停服务并保全现场, 禁止只回滚代码。即便只加列,
 * 旧版公开接口也可能泄露新版本私人资料。此数据库快照不能替代媒体文件备份,
 * 恢复必须配套停机期间取得的数据库/媒体/代码版本和迁移后的新增资料归档。
 */
const fs = require('fs');
const path = require('path');
const { migrateWithRecovery } = require('./migrate-with-recovery.cjs');

function loadEnvFile(cwd) {
  const p = path.resolve(cwd, '.env');
  if (!fs.existsSync(p)) return;
  const buf = fs.readFileSync(p);
  let raw;
  if (buf[0] === 0xff && buf[1] === 0xfe) raw = buf.toString('utf16le');
  else if (buf[0] === 0xfe && buf[1] === 0xff) raw = buf.swap16().toString('utf16le');
  else raw = buf.toString('utf-8');
  if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
  for (const line of raw.split(/\r\n|\r|\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = /^\s*([\w.-]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    if (process.env[m[1]] !== undefined) continue;
    let v = m[2] ?? '';
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[m[1]] = v;
  }
}

async function main(recovery) {
  const cwd = process.cwd();
  loadEnvFile(cwd);

  const rawPath = process.env.DB_PATH || '../database/smart-control.db';
  const dbPath = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
  console.log(`[migrate] cwd=${cwd}  库=${dbPath}`);
  if (!fs.existsSync(dbPath)) {
    console.error(`[migrate] 数据库不存在: ${dbPath} —— 拒绝执行(避免凭空造空库)`);
    process.exit(1);
  }

  const dsPath = path.resolve(cwd, 'dist/data-source.js');
  if (!fs.existsSync(dsPath)) {
    console.error(`[migrate] 找不到 ${dsPath} —— 先 build`);
    process.exit(1);
  }
  const ds = require(dsPath).default;

  await ds.initialize();
  try {
    const hasPending = await ds.showMigrations();
    if (!hasPending) {
      console.log('[migrate] 无未执行迁移, 跳过');
      return;
    }
    // A database-only snapshot cannot restore private media safely. The deployment
    // controller must supply and continuously hold a real writer fence.
    const result = await migrateWithRecovery({ ...recovery, dataSource: ds, databasePath: dbPath });
    const ran = result.migrations;
    console.log(`[migrate] 已验证配套恢复包及隔离恢复演练: ${result.bundleDirectory}`);
    console.log(`[migrate] 已执行 ${ran.length} 个迁移:`);
    for (const m of ran) console.log(`  - ${m.name}`);
  } finally {
    await ds.destroy();
  }
  console.log('[migrate] 完成');
}

if (require.main === module) main().catch((err) => {
  if (err?.bundleDirectory) console.error(`[migrate] 保留恢复包: ${err.bundleDirectory}`);
  if (err?.rehearsalDirectory) console.error(`[migrate] 保留恢复演练: ${err.rehearsalDirectory}`);
  console.error(`[migrate] 失败: ${err && err.message ? err.message : err}`);
  console.error(err && err.stack ? err.stack : '');
  process.exit(1);
});

module.exports = { main };
