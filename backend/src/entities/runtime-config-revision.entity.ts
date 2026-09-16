import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/** Immutable snapshot written in the same transaction as the current document. */
@Entity({ name: 'runtime_config_revisions' })
@Index('UQ_runtime_config_revisions_key_revision', ['key', 'revision'], { unique: true })
export class RuntimeConfigRevision {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index('IDX_runtime_config_revisions_key')
  @Column({ type: 'varchar', length: 100, name: 'config_key' })
  key!: string;

  @Column({ type: 'integer', name: 'schema_version' })
  schemaVersion!: number;

  @Column({ type: 'integer' })
  revision!: number;

  @Column({ type: 'text' })
  document!: string;

  @Column({ type: 'varchar', length: 64, name: 'document_sha256' })
  documentSha256!: string;

  @Column({ type: 'varchar', length: 64, default: 'system' })
  actor!: string;

  @Column({ type: 'varchar', length: 160, default: 'runtime-config-store' })
  source!: string;

  @CreateDateColumn({ type: 'datetime', name: 'created_at' })
  createdAt!: Date;
}
