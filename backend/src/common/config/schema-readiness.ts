import { createHash } from 'crypto';

export const REQUIRED_SCHEMA_MIGRATIONS = [
  'AddPowerConfigRevision1789700000000',
  'AddAudioConfigRevisions1789690000000',
  'AddDisplayFit1785030000000',
  'AddDocScreening1785120000000',
  'AddWelcomeGuest1785130000000',
  'AddClientTokenSecret1785140000000',
  'AddWelcomeEditor1785150000000',
  'AddDocZoom1785160000000',
  'AddBaiduPanAuth1785170000000',
  'AddAdminTokenSecret1785180000000',
  'AddBaiduPanRoot1785190000000',
  'AddMediaProcessing1785190000000',
  'AddResourceOwnership1788618000000',
  'AddPersonalPlaylists1788618001000',
  'AddPlaybackSession1788618002000',
  'AddUploadReservations1788618003000',
  'BindUploadTemporaryFiles1788618004000',
  'TrackUploadInstances1788618005000',
  'LinkUploadMedia1788618006000',
  'ProtectLastAdministrator1788618007000',
  'TrackSystemUploadReservations1788618008000',
  'AddParkOpsConfig1788790002000',
  'AddWelcomePhoto1789300000000',
  'AddRuntimeConfigStore1789470000000',
  'ImportVideoBindingRuntimeConfig1789560000000',
  'ImportParkOpsMetricsRuntimeConfig1789570000000',
  'ImportParkOpsVisualRuntimeConfig1789580000000',
  'EstablishAppReleaseCatalog1789640000000',
  'EstablishNamedIdentityAuthority1789650000000',
  'EstablishOperationalCatalog1789660000000',
  'EstablishHvacPlaybackCatalog1789670000000',
  'EstablishBundledMediaAuthority1789680000000',
] as const;

export const REQUIRED_SCHEMA_COLUMNS: Record<string, string[]> = {
  power_circuit: ['config_revision'],
  audio_output_zone: ['config_revision'],
  audio_input_source: ['config_revision'],
  audio_scene: ['config_revision'],
  client_auth_v1: ['tokenSecret'],
  admin_auth_v1: ['tokenSecret'],
  baidu_pan_auth: [
    'id',
    'appKey',
    'secretKey',
    'deviceCode',
    'accessToken',
    'refreshToken',
    'expiresAt',
    'rootPath',
    'updatedAt',
  ],
  system_branding_v2: [
    'welcomeGuest',
    'welcomeTitle',
    'welcomeTagline',
    'welcomeBgMediaId',
    'welcomePhotoMediaId',
    'parkOpsConfigJson',
  ],
  media_assets: [
    'pageCount',
    'docPdfPath',
    'owner_user_id',
    'visibility',
    'source',
    'sourcePath',
    'processingStatus',
    'processingError',
    'system_key',
    'artifact_sha256',
  ],
  users: ['storage_quota_bytes'],
  playlist_item: ['owner_user_id'],
  playback_history: ['owner_user_id'],
  playback_channels: ['displayFit', 'docPage', 'docZoom', 'initiator_user_id', 'playback_session'],
  upload_reservations: ['owner_user_id', 'bytes', 'temp_name', 'instance_id', 'target_media_id'],
  upload_instances: ['id'],
  runtime_config_documents: [
    'config_key',
    'schema_version',
    'revision',
    'document',
    'document_sha256',
    'created_at',
    'updated_at',
  ],
  runtime_config_revisions: [
    'id',
    'config_key',
    'schema_version',
    'revision',
    'document',
    'document_sha256',
    'actor',
    'source',
    'created_at',
  ],
  app_release_v1: [
    'release_source',
    'artifact_commit',
    'artifact_sha256',
    'artifact_size',
    'artifact_built_at',
  ],
};

/** Read-only startup gate. Schema changes belong to the explicit, backed-up migration step. */
interface SchemaQueryRow {
  name?: string;
  notnull?: number;
  [column: string]: unknown;
}

export function assertSchemaReady(db: {
  prepare(sql: string): { all(...args: unknown[]): SchemaQueryRow[] };
}): void {
  try {
    const applied = new Set(
      db
        .prepare('SELECT name FROM migrations')
        .all()
        .map((row) => row.name)
        .filter((name): name is string => typeof name === 'string'),
    );
    if (REQUIRED_SCHEMA_MIGRATIONS.some((name) => !applied.has(name)))
      throw new Error('missing migration');
    for (const [table, names] of Object.entries(REQUIRED_SCHEMA_COLUMNS)) {
      const actual = db.prepare(`PRAGMA table_info("${table}")`).all();
      if (names.some((name) => !actual.some((column) => column.name === name)))
        throw new Error('missing column');
      if (
        table === 'upload_reservations' &&
        actual.find((column) => column.name === 'owner_user_id')?.notnull !== 0
      )
        throw new Error('system uploads unsupported');
    }
    const triggers = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'protect_last_administrator_%'",
      )
      .all();
    if (triggers.length !== 2) throw new Error('administrator protection missing');
    for (const table of ['client_auth_v1', 'admin_auth_v1']) {
      const rows = db.prepare(`SELECT id, tokenSecret FROM "${table}"`).all();
      if (
        rows.length !== 1 || rows[0]?.id !== 1 ||
        typeof rows[0]?.tokenSecret !== 'string' || !/^[a-f0-9]{64}$/.test(rows[0].tokenSecret)
      ) throw new Error('identity signing configuration missing');
    }
    const administrators = db
      .prepare("SELECT id FROM users WHERE role = 'admin' AND enabled = 1 LIMIT 1")
      .all();
    if (administrators.length !== 1) throw new Error('named administrator missing');
    const branding = db.prepare('SELECT id FROM system_branding_v2').all();
    if (branding.length !== 1 || branding[0]?.id !== 1) {
      throw new Error('system branding authority missing');
    }
    const videoDocuments = db
      .prepare(
        `SELECT schema_version, revision, document, document_sha256
         FROM runtime_config_documents WHERE config_key = ?`,
      )
      .all('video.binding');
    const video = videoDocuments[0];
    if (
      videoDocuments.length !== 1 ||
      video?.schema_version !== 1 ||
      typeof video.revision !== 'number' ||
      video.revision < 1 ||
      typeof video.document !== 'string' ||
      typeof video.document_sha256 !== 'string' ||
      createHash('sha256').update(video.document, 'utf8').digest('hex') !==
        video.document_sha256
    ) {
      throw new Error('video binding authority missing or damaged');
    }
    const matchingRevision = db
      .prepare(
        `SELECT document_sha256 FROM runtime_config_revisions
         WHERE config_key = ? AND revision = ?`,
      )
      .all('video.binding', video.revision);
    if (
      matchingRevision.length !== 1 ||
      matchingRevision[0]?.document_sha256 !== video.document_sha256
    ) {
      throw new Error('video binding revision history mismatch');
    }
  } catch {
    throw new Error(
      'Database schema is not ready: identity, schema, or authority records failed validation. Back up the target database and media, run migration:run, then restore required authority records or provision the first named administrator if needed. Startup will not repair or create business data automatically.',
    );
  }
}
