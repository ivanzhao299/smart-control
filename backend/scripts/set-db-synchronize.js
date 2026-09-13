#!/usr/bin/env node
/**
 * 切换 .env 里的 DB_SYNCHRONIZE —— 迁移体系接管 schema 的最后一步。
 *
 * 【为什么要关】
 * synchronize=true 时 TypeORM 每次启动按实体自动改表。加表加列安全, 但改列类型、
 * 改关系、删列会 DROP 重建, 数据静默消失且没有任何记录可审。系统要做成能复制到
 * 多场馆的产品, 设备模型迟早要重构, 那时候必须靠可审、可回滚的迁移, 而不是让
 * 框架在启动瞬间自己猜该怎么改表。
 *
 * 【关掉之前必须已经做完】
 *   1. npm run schema:log            → 输出 "schema is up to date"(零 drift)
 *   2. node scripts/mark-migration-baseline.js  → 基线标记为已执行
 * 顺序错了会出事: 没标基线就关 synchronize, 后续 migration:run 会试图从头建表。
 *
 * 【可逆】
 * 出问题就把值改回 true 再重启, 立刻恢复原来的行为。改动前自动备份 .env。
 *
 * 用法:
 *   node scripts/set-db-synchronize.js false   # 关闭(交给迁移)
 *   node scripts/set-db-synchronize.js true    # 回滚
 */
const fs = require('fs');
const path = require('path');

function main() {
  const arg = (process.argv[2] || '').toLowerCase();
  if (arg !== 'true' && arg !== 'false') {
    console.error('用法: node scripts/set-db-synchronize.js <true|false>');
    process.exit(1);
  }

  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`[sync] 找不到 .env: ${envPath}`);
    process.exit(1);
  }

  const before = fs.readFileSync(envPath, 'utf-8');
  const current = /^\s*DB_SYNCHRONIZE\s*=\s*(\S+)\s*$/m.exec(before);
  console.log(`[sync] 当前: DB_SYNCHRONIZE=${current ? current[1] : '(未设置)'}`);

  if (current && current[1].toLowerCase() === arg) {
    console.log('[sync] 已经是目标值, 无需改动');
    return;
  }

  let after;
  if (current) {
    after = before.replace(/^\s*DB_SYNCHRONIZE\s*=.*$/m, `DB_SYNCHRONIZE=${arg}`);
  } else {
    // 原本没写这一行: 补上(默认值是 true, 不显式写死会继续走默认)
    after = `${before.replace(/\s*$/, '')}\nDB_SYNCHRONIZE=${arg}\n`;
  }

  const bak = `${envPath}.bak-${Date.now()}`;
  fs.copyFileSync(envPath, bak);
  fs.writeFileSync(envPath, after, 'utf-8');

  console.log(`[sync] 已备份原文件: ${bak}`);
  console.log(`[sync] 已改为: DB_SYNCHRONIZE=${arg}`);
  console.log('[sync] 需要重启后端才生效: pm2 restart smart-control-backend --update-env');
}

main();
