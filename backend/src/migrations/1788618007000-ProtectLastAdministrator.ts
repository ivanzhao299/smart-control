import { MigrationInterface, QueryRunner } from 'typeorm';

// Enforce at the statement boundary, including writers on other connections.
// A service-level count followed by UPDATE would allow two admins to remove
// each other's access concurrently. Existing zero-admin databases can bootstrap.
export class ProtectLastAdministrator1788618007000 implements MigrationInterface {
  async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE TRIGGER protect_last_administrator_update
      BEFORE UPDATE OF role, enabled ON users
      WHEN OLD.role = 'admin' AND OLD.enabled = 1
        AND (NEW.role != 'admin' OR NEW.enabled != 1)
        AND NOT EXISTS (SELECT 1 FROM users WHERE id != OLD.id AND role = 'admin' AND enabled = 1)
      BEGIN SELECT RAISE(ABORT, 'LAST_ENABLED_ADMIN_REQUIRED'); END`);
    await q.query(`CREATE TRIGGER protect_last_administrator_delete
      BEFORE DELETE ON users
      WHEN OLD.role = 'admin' AND OLD.enabled = 1
        AND NOT EXISTS (SELECT 1 FROM users WHERE id != OLD.id AND role = 'admin' AND enabled = 1)
      BEGIN SELECT RAISE(ABORT, 'LAST_ENABLED_ADMIN_REQUIRED'); END`);
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query('DROP TRIGGER protect_last_administrator_delete');
    await q.query('DROP TRIGGER protect_last_administrator_update');
  }
}
