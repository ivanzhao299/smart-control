#!/usr/bin/env node
/*
 * 一次性数据迁移（第三十五轮，易微联四路群组设备去重）
 * ----------------------------------------------------------------------------
 * 背景：西展厅 / 无纺布展厅 / 金特夫展厅三台四路设备 uiid=138、
 *   isSupportChannelSplit=false，官方 App 只显示 1 个总开关；旧台账误按物理
 *   通道拆成 4 个单元/回路（每台 4 卡，共 12 卡），且 floor 误为「户外」。
 *   后端新版 normalize/syncToCatalog 已按 isSupportChannelSplit 聚合为 1 个总开关
 *   （code 无通道后缀，floor=1F）。本脚本把旧的 12 条拆分记录收敛隐藏，让前端
 *   只呈现 3 个总开关并归入「展贸中心 1F」。
 *
 * 安全策略（遵循「宁可部署失败也不删数据」）：
 *   1) --apply 前先做整库一致性快照备份到 database/migration-backups/*.bak；
 *   2) 被停用的 unit/circuit 行导出为 JSON 存档（含受影响 id，便于回滚）；
 *   3) 对拆分记录只做软禁用（enabled=0），绝不物理 DELETE，数据可随时恢复；
 *   4) 幂等：已禁用的记录再次运行只统计、不再改动；
 *   5) 先校验每台的聚合（无后缀）记录已由 syncToCatalog 建好，否则整笔回滚，
 *      避免「先停用、聚合缺失」导致设备消失。
 *
 * 用法：
 *   预览（只读，不改库，默认）：node scripts/ewelink-merge-grouped-switches.cjs
 *   正式写库（生产）：           node scripts/ewelink-merge-grouped-switches.cjs --apply
 *   本地/只读库自检：            DB_PATH=/path/to.db node scripts/ewelink-merge-grouped-switches.cjs --allow-local
 *
 * 部署顺序（生产）：部署新版后端并重启 → 调用一次 POST /api/ewelink/sync 建立
 *   3 个聚合总开关 → 再运行本脚本 --apply 停用旧拆分卡。
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const TARGETS = [
  { short: '02cbf50b', name: '西展厅' },
  { short: '02cbf4ef', name: '无纺布展厅' },
  { short: '02cbf4eb', name: '金特夫展厅' },
];
const FLOOR = '1F';

function resolveDbPath(allowLocal) {
  if (process.env.DB_PATH) return path.resolve(process.env.DB_PATH);
  if (process.platform === 'win32' && os.hostname().toUpperCase() === 'GK9000') {
    return 'D:\\smart-control\\database\\smart-control.db';
  }
  if (allowLocal) {
    return path.resolve(__dirname, '..', '..', 'database', 'smart-control.db');
  }
  throw new Error('本迁移默认仅允许在 GK9000 生产机执行；本地只读自检请加 --allow-local 并可用 DB_PATH 指定库。');
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const allowLocal = process.argv.includes('--allow-local');
  const dbPath = resolveDbPath(allowLocal);

  if (!fs.existsSync(dbPath)) {
    throw new Error(`数据库不存在: ${dbPath}`);
  }
  if (!allowLocal && os.hostname().toUpperCase() !== 'GK9000') {
    throw new Error(`主机名 ${os.hostname()} 不是 GK9000，拒绝执行；如确需本地自检请加 --allow-local。`);
  }

  // 生产后端的 better-sqlite3 随 backend 安装；本地开发则从 backend/node_modules 解析。
  const Database = require(path.join(__dirname, '..', 'node_modules', 'better-sqlite3'));
  const db = new Database(dbPath, apply ? {} : { readonly: true });
  db.pragma('busy_timeout = 15000');

  const unitCodes = [];
  const circuitCodes = [];
  for (const t of TARGETS) {
    for (let n = 1; n <= 4; n += 1) {
      unitCodes.push(`EWE-${t.short}-${n}`);
      circuitCodes.push(`ewelink-${t.short}-${n}`);
    }
  }

  // ---- 预检：每台聚合（无后缀）记录必须已存在 ----
  const missing = [];
  for (const t of TARGETS) {
    const unit = db.prepare('SELECT id, code, enabled, floor FROM hardware_units WHERE code = ?')
      .get(`EWE-${t.short}`);
    const circuit = db.prepare('SELECT id, code, enabled, floor FROM power_circuit WHERE code = ?')
      .get(`ewelink-${t.short}`);
    if (!unit || !unit.enabled) missing.push(`${t.name} 聚合单元 EWE-${t.short}（请先调用 POST /api/ewelink/sync）`);
    if (!circuit || !circuit.enabled) missing.push(`${t.name} 聚合回路 ewelink-${t.short}（请先调用 POST /api/ewelink/sync）`);
  }

  // ---- 收集将停用的拆分记录（仅仍启用的）----
  const placeholders = (n) => Array.from({ length: n }, () => '?').join(',');
  const units = db.prepare(
    `SELECT id, code, name, floor, enabled FROM hardware_units WHERE code IN (${placeholders(unitCodes.length)}) ORDER BY code`,
  ).all(...unitCodes);
  const circuits = db.prepare(
    `SELECT id, code, name, floor, enabled FROM power_circuit WHERE code IN (${placeholders(circuitCodes.length)}) ORDER BY code`,
  ).all(...circuitCodes);

  const activeUnits = units.filter((u) => u.enabled);
  const activeCircuits = circuits.filter((c) => c.enabled);

  // ---- 定时任务是否引用了将停用的回路（软禁用不删除，仅提示核对）----
  let scheduleRefs = [];
  if (activeCircuits.length) {
    const ids = activeCircuits.map((c) => c.id);
    scheduleRefs = db.prepare(
      `SELECT id, circuit_id FROM power_schedule WHERE circuit_id IN (${placeholders(ids.length)})`,
    ).all(...ids);
  }

  console.log('==== 易微联四路群组设备收敛迁移 ====');
  console.log(`数据库: ${dbPath}`);
  console.log(`模式: ${apply ? '正式写入 (--apply)' : '只读预览 (dry-run，加 --apply 才写库)'}`);
  console.log(`拆分单元: 共 ${units.length} 条，其中仍启用 ${activeUnits.length} 条`);
  console.log(`拆分回路: 共 ${circuits.length} 条，其中仍启用 ${activeCircuits.length} 条`);
  if (scheduleRefs.length) {
    console.log(`⚠️  power_schedule 有 ${scheduleRefs.length} 条定时任务引用这些回路，停用后该定时不动作，请人工核对：`);
    scheduleRefs.forEach((s) => console.log(`   - power_schedule#${s.id} -> circuit_id=${s.circuit_id}`));
  } else {
    console.log('定时任务引用: 无');
  }

  if (missing.length) {
    console.log('\n❌ 预检失败，聚合总开关尚未就绪，拒绝做任何停用：');
    missing.forEach((m) => console.log(`   - ${m}`));
    console.log('\n请先部署新版后端并重启，调用一次 POST /api/ewelink/sync 后重试。');
    db.close();
    process.exitCode = 2;
    return;
  }
  console.log('预检通过：3 台聚合总开关(单元+回路)均已就绪。');

  if (!apply) {
    console.log('\n[dry-run] 正式执行时将：');
    console.log(`  1) 整库备份到 database/migration-backups/smart-control-<时间戳>.bak`);
    console.log(`  2) 导出被停用行 JSON 存档到同目录`);
    console.log(`  3) 软禁用 ${activeUnits.length} 个拆分单元 + ${activeCircuits.length} 条拆分回路（enabled=0，并把 floor 置为 1F）`);
    console.log('  （软禁用不物理删除，可经备份/存档恢复，前端将不再显示这 12 张旧卡）');
    db.close();
    return;
  }

  if (activeUnits.length === 0 && activeCircuits.length === 0) {
    console.log('\n✅ 无启用中的拆分记录，已是收敛状态，无需备份或改动（幂等结束）。');
    db.close();
    return;
  }

  // ---- 正式执行：备份 + 存档 + 事务内软禁用 ----
  const backupDir = path.join(path.dirname(dbPath), 'migration-backups');
  fs.mkdirSync(backupDir, { recursive: true });
  const stamp = timestamp();
  const backupPath = path.join(backupDir, `smart-control-${stamp}.bak`);
  const archivePath = path.join(backupDir, `ewelink-merge-${stamp}.json`);

  db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').run();
  await db.backup(backupPath); // better-sqlite3 的在线备份为异步，必须 await 完成再继续/关库
  fs.writeFileSync(archivePath, JSON.stringify({
    archivedAt: new Date().toISOString(),
    dbPath,
    units,
    circuits,
    scheduleRefs,
  }, null, 2) + '\n', { encoding: 'utf8' });

  const tx = db.transaction(() => {
    let unitRows = 0;
    let circuitRows = 0;
    for (const t of TARGETS) {
      // 软禁用拆分单元 + floor 兜底 1F
      for (let n = 1; n <= 4; n += 1) {
        const r = db.prepare(
          "UPDATE hardware_units SET enabled = 0, floor = ? WHERE code = ? AND enabled = 1",
        ).run(FLOOR, `EWE-${t.short}-${n}`);
        unitRows += r.changes;
      }
      // 聚合单元 floor 兜底 1F（sync 已置，幂等）
      db.prepare('UPDATE hardware_units SET floor = ? WHERE code = ? AND floor IS NOT ?')
        .run(FLOOR, `EWE-${t.short}`, FLOOR);
      // 软禁用拆分回路 + floor 兜底
      for (let n = 1; n <= 4; n += 1) {
        const r = db.prepare(
          "UPDATE power_circuit SET enabled = 0, floor = ? WHERE code = ? AND enabled = 1",
        ).run(FLOOR, `ewelink-${t.short}-${n}`);
        circuitRows += r.changes;
      }
      db.prepare('UPDATE power_circuit SET floor = ? WHERE code = ? AND floor IS NOT ?')
        .run(FLOOR, `ewelink-${t.short}`, FLOOR);
    }
    return { unitRows, circuitRows };
  });

  const res = tx();
  console.log('\n✅ 迁移完成：');
  console.log(`  停用拆分单元 ${res.unitRows} 个、拆分回路 ${res.circuitRows} 条（已含 floor=1F）`);
  console.log(`  整库备份: ${backupPath}`);
  console.log(`  存档:     ${archivePath}`);
  console.log('回滚：用备份 .bak 覆盖回库，或执行 UPDATE ... SET enabled=1 恢复拆分卡（存档含 id）。');
  db.close();
}

main().catch((err) => {
  console.error(`迁移失败: ${err && err.message ? err.message : err}`);
  process.exitCode = 1;
});
