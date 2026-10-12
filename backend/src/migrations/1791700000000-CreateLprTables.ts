import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Create LPR (臻识车牌识别一体机 / 道闸) tables (2026-10-12).
 *
 * Purely additive: lpr_device / lpr_pass_record / lpr_whitelist / lpr_gate_event.
 * Idempotent (IF NOT EXISTS) so every site converges without touching existing data.
 */
export class CreateLprTables1791700000000 implements MigrationInterface {
  name = 'CreateLprTables1791700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TABLE IF NOT EXISTS lpr_device (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serialno VARCHAR(64) NOT NULL,
      device_name VARCHAR(128) NOT NULL,
      model VARCHAR(64),
      ip VARCHAR(64),
      channel INTEGER,
      location VARCHAR(128),
      gate_io INTEGER NOT NULL DEFAULT 0,
      pass_direction VARCHAR(8),
      online INTEGER NOT NULL DEFAULT 0,
      last_heartbeat DATETIME,
      config TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lpr_device_serialno ON lpr_device (serialno)`);

    await q.query(`CREATE TABLE IF NOT EXISTS lpr_pass_record (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate_id VARCHAR(64) NOT NULL,
      serialno VARCHAR(64) NOT NULL,
      channel INTEGER,
      license VARCHAR(32) NOT NULL,
      plate_type INTEGER,
      plate_color INTEGER,
      car_color INTEGER,
      car_type INTEGER,
      brand VARCHAR(64),
      direction INTEGER,
      confidence INTEGER,
      trigger_type INTEGER,
      is_fake INTEGER,
      is_danger INTEGER,
      isoffline INTEGER NOT NULL DEFAULT 0,
      pass_direction VARCHAR(8),
      release_result VARCHAR(16) NOT NULL DEFAULT 'none',
      pic_small VARCHAR(255),
      pic_big VARCHAR(255),
      event_time DATETIME,
      raw TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lpr_pass_plateid ON lpr_pass_record (plate_id)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_lpr_pass_serialno ON lpr_pass_record (serialno)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_lpr_pass_license ON lpr_pass_record (license)`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_lpr_pass_eventtime ON lpr_pass_record (event_time)`);

    await q.query(`CREATE TABLE IF NOT EXISTS lpr_whitelist (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate VARCHAR(32) NOT NULL,
      group_name VARCHAR(16) NOT NULL DEFAULT 'staff',
      is_black INTEGER NOT NULL DEFAULT 0,
      enable INTEGER NOT NULL DEFAULT 1,
      enable_time DATETIME,
      overdue_time DATETIME,
      remark VARCHAR(128),
      sync_state VARCHAR(16) NOT NULL DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lpr_wl_plate ON lpr_whitelist (plate)`);

    await q.query(`CREATE TABLE IF NOT EXISTS lpr_gate_event (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      serialno VARCHAR(64) NOT NULL,
      gate_status INTEGER NOT NULL,
      connect_status INTEGER,
      enabled INTEGER,
      event_time DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    await q.query(`CREATE INDEX IF NOT EXISTS idx_lpr_gate_serialno ON lpr_gate_event (serialno)`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS lpr_gate_event`);
    await q.query(`DROP TABLE IF EXISTS lpr_whitelist`);
    await q.query(`DROP TABLE IF EXISTS lpr_pass_record`);
    await q.query(`DROP TABLE IF EXISTS lpr_device`);
  }
}
