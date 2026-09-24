import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'fs';
import { resolve, join } from 'path';
import { execFileSync } from 'child_process';
import * as os from 'os';
import { DataSource } from 'typeorm';
import { AppConfig, DatabaseConfig, LoggerConfig } from '../../common/config/configuration';
import { resolveRuntimeDataDir } from '../../common/storage/runtime-data-path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveProductionMediaRoot } = require('../../../scripts/production-paths.cjs') as {
  resolveProductionMediaRoot: () => string;
};

export interface VersionMeta {
  version: string;
  sprint: string;
  buildTime: string;
  platform: string;
  host: string;
  commit?: string;
  ref?: string;
  releasedAt?: string;
  identitySource?: 'environment' | 'git' | 'release-manifest' | 'version-file' | 'unknown';
}

interface ReleaseManifest {
  commit?: string;
  ref?: string;
  releasedAt?: string;
}

export interface RuntimeSummary {
  release: VersionMeta;
  database: {
    configuredPath: string;
    connectedPath: string;
    sqliteVersion: string;
    migrationsApplied: number;
    latestMigration: { timestamp: number; name: string } | null;
    pendingMigrations: boolean;
    runtimeConfigDocuments: number;
  };
  storage: {
    runtimeDataDir: string;
    mediaRoot: string;
    logDir: string;
    releaseManifest: string;
  };
}

export interface BackupItem {
  name: string;
  path: string;
  sizeBytes: number;
  createdAt: string;
}

export interface SiteHeartbeat {
  /** 主控机标识 (hostname / 工位号, 现场端报上来) */
  host: string;
  /** 现场当前 git HEAD commit (现场报) */
  commit?: string;
  /** 分支名 (现场报) */
  ref?: string;
  /** 现场 package.json version (现场报) */
  version?: string;
  /** 现场构建时间 / version.json buildTime (现场报) */
  buildAt?: string;
  /** 现场 update.ps1 完成时刻 (现场报, ISO) */
  updatedAt?: string;
  /** 后端接收时刻 (服务端打) */
  receivedAt?: string;
  /** 现场自检诊断 (e.g. dali-selftest 结果). 不解析, 透传 */
  diagnostics?: unknown;
}

@Injectable()
export class SystemService implements OnModuleInit {
  private readonly logger = new Logger(SystemService.name);
  private versionMeta: VersionMeta = {
    version: '0.10.0',
    sprint: 'Sprint-10',
    buildTime: new Date().toISOString(),
    platform: process.platform,
    host: os.hostname(),
  };
  private readonly startedAt = Date.now();
  private releaseIdentityInitialized = false;

  constructor(
    private readonly config: ConfigService,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    const candidates = [
      resolve(process.cwd(), 'deploy/configs/version.json'),
      resolve(process.cwd(), '../deploy/configs/version.json'),
      resolve(__dirname, '../../../../deploy/configs/version.json'),
    ];
    for (const p of candidates) {
      if (existsSync(p)) {
        try {
          const txt = await fs.readFile(p, 'utf-8');
          const parsed = JSON.parse(txt) as Partial<VersionMeta>;
          this.versionMeta = {
            version: parsed.version ?? this.versionMeta.version,
            sprint: parsed.sprint ?? this.versionMeta.sprint,
            buildTime: parsed.buildTime ?? this.versionMeta.buildTime,
            // Platform and hostname describe this running process, never a committed template.
            platform: this.versionMeta.platform,
            host: this.versionMeta.host,
            commit: parsed.commit,
            ref: parsed.ref,
          };
          this.versionMeta.identitySource = parsed.commit ? 'version-file' : 'unknown';
          this.logger.log(`version.json 已加载: ${p}`);
          break;
        } catch (e) {
          this.logger.warn(`version.json 解析失败 ${p}: ${(e as Error).message}`);
        }
      }
    }
    this.refreshReleaseIdentity();
    const summary = await this.runtimeSummary();
    this.logger.log(
      `runtime summary: commit=${summary.release.commit} ref=${summary.release.ref} ` +
        `db=${summary.database.connectedPath} migrations=${summary.database.migrationsApplied} ` +
        `pending=${summary.database.pendingMigrations} data=${summary.storage.runtimeDataDir} ` +
        `media=${summary.storage.mediaRoot}`,
    );
  }

  meta(): VersionMeta {
    this.refreshReleaseIdentity();
    return { ...this.versionMeta };
  }

  async runtimeSummary(): Promise<RuntimeSummary> {
    const database = this.config.getOrThrow<DatabaseConfig>('database');
    const logger = this.config.getOrThrow<LoggerConfig>('logger');
    const connected = this.dataSource.options.database;
    if (typeof connected !== 'string') {
      throw new Error('RUNTIME_DATABASE_PATH_UNAVAILABLE');
    }
    if (this.pathKey(database.path) !== this.pathKey(connected)) {
      throw new Error(
        `RUNTIME_DATABASE_PATH_MISMATCH: configured=${database.path} connected=${connected}`,
      );
    }

    const migrations = (await this.dataSource.query(
      'SELECT timestamp, name FROM migrations ORDER BY timestamp DESC, id DESC',
    )) as Array<{ timestamp: number; name: string }>;
    const sqliteRows = (await this.dataSource.query(
      'SELECT sqlite_version() AS sqliteVersion',
    )) as Array<{ sqliteVersion: string }>;
    const configRows = (await this.dataSource.query(
      'SELECT COUNT(*) AS count FROM runtime_config_documents',
    )) as Array<{ count: number }>;

    return {
      release: this.meta(),
      database: {
        configuredPath: database.path,
        connectedPath: connected,
        sqliteVersion: String(sqliteRows[0]?.sqliteVersion ?? 'unknown'),
        migrationsApplied: migrations.length,
        latestMigration: migrations[0]
          ? { timestamp: Number(migrations[0].timestamp), name: migrations[0].name }
          : null,
        pendingMigrations: await this.dataSource.showMigrations(),
        runtimeConfigDocuments: Number(configRows[0]?.count ?? 0),
      },
      storage: {
        runtimeDataDir: resolveRuntimeDataDir(),
        mediaRoot: resolveProductionMediaRoot(),
        logDir: logger.dir,
        releaseManifest: this.releaseManifestPath(),
      },
    };
  }

  private refreshReleaseIdentity(): void {
    const manifest = this.readReleaseManifest();
    if (!this.releaseIdentityInitialized) {
      const environmentCommit = this.validCommit(
        process.env.APP_COMMIT ?? process.env.GITHUB_SHA ?? process.env.COMMIT_SHA,
      );
      const gitCommit = this.gitValue(['rev-parse', 'HEAD']);
      const versionCommit = this.validCommit(this.versionMeta.commit);
      const commit =
        environmentCommit ??
        this.validCommit(gitCommit) ??
        this.validCommit(manifest.commit) ??
        versionCommit;

      this.versionMeta.commit = commit ?? 'unknown';
      this.versionMeta.ref =
        process.env.APP_REF?.trim() ||
        this.gitValue(['symbolic-ref', '--short', '-q', 'HEAD']) ||
        manifest.ref?.trim() ||
        this.versionMeta.ref?.trim() ||
        'unknown';
      this.versionMeta.identitySource = environmentCommit
        ? 'environment'
        : this.validCommit(gitCommit)
          ? 'git'
          : this.validCommit(manifest.commit)
            ? 'release-manifest'
            : versionCommit
              ? 'version-file'
              : 'unknown';
      this.releaseIdentityInitialized = true;
    }
    if (manifest.commit === this.versionMeta.commit && manifest.releasedAt) {
      this.versionMeta.releasedAt = manifest.releasedAt;
    }
  }

  private readReleaseManifest(): ReleaseManifest {
    const path = this.releaseManifestPath();
    if (!existsSync(path)) return {};
    try {
      const raw = readFileSync(path, 'utf8').replace(/^\uFEFF/, '');
      return JSON.parse(raw) as ReleaseManifest;
    } catch (error) {
      this.logger.warn(`release manifest 读取失败 ${path}: ${(error as Error).message}`);
      return {};
    }
  }

  private releaseManifestPath(): string {
    return resolve(
      process.env.RELEASE_MANIFEST_PATH?.trim() || join(resolveRuntimeDataDir(), 'release.json'),
    );
  }

  private validCommit(value: string | undefined): string | undefined {
    const normalized = value?.trim().toLowerCase();
    return normalized && /^[0-9a-f]{40}$/.test(normalized) ? normalized : undefined;
  }

  private gitValue(args: string[]): string | undefined {
    try {
      const value = execFileSync('git', ['-C', process.cwd(), ...args], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 2_000,
      }).trim();
      return value || undefined;
    } catch {
      return undefined;
    }
  }

  private pathKey(path: string): string {
    const normalized = resolve(path).replace(/\\/g, '/');
    return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
  }

  uptimeSec(): number {
    return Math.floor((Date.now() - this.startedAt) / 1000);
  }

  private backupsRoot(): string {
    const fromEnv = process.env.BACKUP_DIR;
    if (fromEnv && fromEnv.trim()) return resolve(fromEnv);
    return resolve(process.cwd(), '../backups');
  }

  /** 触发 SQLite 在线备份 (复制单文件方式; 现场可由 deploy/scripts/backup.ps1 增强为 sqlite3 .backup) */
  async backup(): Promise<{
    snapshot: string;
    sizeBytes: number;
    createdAt: string;
    sourceDbPath: string;
  }> {
    const dbCfg = this.config.getOrThrow<DatabaseConfig>('database');
    const src = dbCfg.path;
    if (!existsSync(src)) {
      throw new NotFoundException(`数据库文件不存在: ${src}`);
    }
    const root = this.backupsRoot();
    if (!existsSync(root)) mkdirSync(root, { recursive: true });

    const ts = new Date().toISOString().replace(/[-:T]/g, '').replace(/\..+$/, '');
    const snapDir = join(root, ts);
    mkdirSync(snapDir, { recursive: true });
    const dest = join(snapDir, 'smart-control.db');
    copyFileSync(src, dest);

    const size = statSync(dest).size;
    this.logger.log(`数据库已备份 → ${dest} (${(size / 1024).toFixed(1)} KB)`);
    return {
      snapshot: snapDir,
      sizeBytes: size,
      createdAt: new Date().toISOString(),
      sourceDbPath: src,
    };
  }

  /** Sprint-10 模拟恢复: 仅列出可用快照 + 校验目标文件, 不真正覆盖运行中的数据库. */
  async restore(snapshotName?: string): Promise<{
    simulated: true;
    selected: string | null;
    wouldRestoreFrom: string | null;
    wouldRestoreTo: string;
    available: BackupItem[];
    note: string;
  }> {
    const dbCfg = this.config.getOrThrow<DatabaseConfig>('database');
    const root = this.backupsRoot();
    const available = await this.listBackupsInternal(root);
    const selected = snapshotName
      ? (available.find((b) => b.name === snapshotName) ?? null)
      : (available[0] ?? null);
    return {
      simulated: true,
      selected: selected?.name ?? null,
      wouldRestoreFrom: selected ? join(selected.path, 'smart-control.db') : null,
      wouldRestoreTo: dbCfg.path,
      available,
      note: '此接口仅模拟。线上请用 deploy\\scripts\\restore.ps1 -Snapshot <name> 离线恢复。',
    };
  }

  async listBackups(): Promise<BackupItem[]> {
    return this.listBackupsInternal(this.backupsRoot());
  }

  private async listBackupsInternal(root: string): Promise<BackupItem[]> {
    if (!existsSync(root)) return [];
    const entries = await fs.readdir(root, { withFileTypes: true });
    const items: BackupItem[] = [];
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      const p = join(root, ent.name);
      const dbFile = join(p, 'smart-control.db');
      if (!existsSync(dbFile)) continue;
      const st = statSync(dbFile);
      items.push({
        name: ent.name,
        path: p,
        sizeBytes: st.size,
        createdAt: st.mtime.toISOString(),
      });
    }
    return items.sort((a, b) => (a.name < b.name ? 1 : -1));
  }

  // 现场主控机心跳 — update.ps1 跑成功后回报, 让远程能看到现场当前 commit / 时间
  private readonly siteHeartbeats = new Map<string, SiteHeartbeat>();

  recordSiteHeartbeat(input: Partial<SiteHeartbeat> & { host: string }): SiteHeartbeat {
    const now = new Date().toISOString();
    const prev = this.siteHeartbeats.get(input.host);
    const entry: SiteHeartbeat = {
      host: input.host,
      commit: input.commit ?? prev?.commit,
      ref: input.ref ?? prev?.ref,
      version: input.version ?? prev?.version,
      buildAt: input.buildAt ?? prev?.buildAt,
      updatedAt: input.updatedAt ?? now,
      receivedAt: now,
      diagnostics: input.diagnostics ?? prev?.diagnostics,
    };
    this.siteHeartbeats.set(input.host, entry);
    this.logger.log(
      `site heartbeat: ${entry.host} @ ${entry.commit?.slice(0, 7) ?? '?'} (updated ${entry.updatedAt})`,
    );
    return entry;
  }

  listSiteHeartbeats(): SiteHeartbeat[] {
    return [...this.siteHeartbeats.values()].sort((a, b) =>
      (a.receivedAt ?? '') < (b.receivedAt ?? '') ? 1 : -1,
    );
  }

  productionFlags(): {
    nodeEnv: string;
    mockMode: boolean;
    testMode: boolean;
    debug: boolean;
  } {
    const app = this.config.getOrThrow<AppConfig>('app');
    const logger = this.config.getOrThrow<LoggerConfig>('logger');
    return {
      nodeEnv: app.nodeEnv,
      mockMode: (process.env.MOCK_MODE ?? '').toLowerCase() === 'true',
      testMode: (process.env.TEST_MODE ?? '').toLowerCase() === 'true',
      debug: logger.level === 'debug',
    };
  }
}
