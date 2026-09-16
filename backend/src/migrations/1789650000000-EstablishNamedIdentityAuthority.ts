import { MigrationInterface, QueryRunner } from 'typeorm';

const RETIRED_PASSWORD = 'retired$named-account-required';

/**
 * Establish users as the only credential authority for new logins.
 *
 * The two historical singleton rows remain temporarily because their secrets
 * verify already-issued tokens. Existing rows and non-null secrets are never
 * replaced. Fresh databases receive non-login password markers and secrets at
 * migration time, so application startup stays read-only.
 */
export class EstablishNamedIdentityAuthority1789650000000 implements MigrationInterface {
  name = 'EstablishNamedIdentityAuthority1789650000000';

  async up(q: QueryRunner): Promise<void> {
    for (const table of ['client_auth_v1', 'admin_auth_v1']) {
      await q.query(
        `INSERT OR IGNORE INTO "${table}"
         ("id", "passwordHash", "passwordChangedAt", "tokenSecret", "updatedAt")
         VALUES (1, ?, CURRENT_TIMESTAMP, lower(hex(randomblob(32))), CURRENT_TIMESTAMP)`,
        [RETIRED_PASSWORD],
      );
      await q.query(
        `UPDATE "${table}"
         SET "tokenSecret" = lower(hex(randomblob(32))), "updatedAt" = CURRENT_TIMESTAMP
         WHERE "id" = 1 AND "tokenSecret" IS NULL`,
      );
    }
  }

  async down(): Promise<void> {
    throw new Error('NAMED_IDENTITY_AUTHORITY_ROLLBACK_PROHIBITED');
  }
}
