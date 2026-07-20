#!/usr/bin/env node
/**
 * 部署时执行数据库迁移 —— 用编译后的 dist, 不依赖 ts-node。
 *
 * synchronize 关掉之后, schema 变更全靠迁移。这个脚本挂在 deploy-from-ci.ps1 的
 * build 之后、重启之前跑, 所以每次部署新代码时未执行的迁移会自动应用。
 *
 * 设计要点:
 *   - 只有存在未执行迁移时才动手; 没有就直接跳过, 不留任何垃圾
 *   - 跑之前先备份整库(生产库不赌"迁移一定不出错"); 只留最近几个备份, 不无限堆
 *   - 每个迁移单独事务(SQLite DDL 支持事务): 中途失败只回滚那一个, 不留半吊子状态
 *   - 走 dist/data-source.js: 生产没有 ts-node, 也不该在部署热路径上依赖它
 *
 * 退出码非 0 时, deploy-from-ci.ps1 会当作部署失败并触发回滚。这也是我们坚持
 * "迁移只做加法(加表/加可空列)"的原因: 万一迁移成功但后续步骤失败、代码被回滚到
 * 旧版, 旧代码遇到多出来的表/列也不会崩, 数据不丢。
 */
const fs = require('fs');
const path = require('path');

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

function backupDb(dbPath) {
  const dir = path.dirname(dbPath);
  const base = path.basename(dbPath);
  const bak = path.join(dir, `${base}.pre-migrate-${Date.now()}.bak`);
  fs.copyFileSync(dbPath, bak);
  console.log(`[migrate] 已备份: ${bak}`);
  // 只留最近 3 个 pre-migrate 备份, 生产库几十 MB, 不能无限堆
  const olds = fs
    .readdirSync(dir)
    .filter((f) => f.startsWith(`${base}.pre-migrate-`))
    .sort()
    .reverse()
    .slice(3);
  for (const f of olds) {
    try {
      fs.unlinkSync(path.join(dir, f));
    } catch {
      /* 删不掉不影响主流程 */
    }
  }
}

async function main() {
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
    backupDb(dbPath);
    const ran = await ds.runMigrations({ transaction: 'each' });
    console.log(`[migrate] 已执行 ${ran.length} 个迁移:`);
    for (const m of ran) console.log(`  - ${m.name}`);
  } finally {
    await ds.destroy();
  }
  console.log('[migrate] 完成');
}

main().catch((err) => {
  console.error(`[migrate] 失败: ${err && err.message ? err.message : err}`);
  console.error(err && err.stack ? err.stack : '');
  process.exit(1);
});
