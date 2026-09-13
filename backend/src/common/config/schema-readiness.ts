/** Read-only startup gate. Schema changes belong to the explicit, backed-up migration step. */
export function assertSchemaReady(db: { prepare(sql: string): { all(...args: unknown[]): any[] } }): void {
  const required = [
    'AddMediaProcessing1785190000000',
    'AddResourceOwnership1788618000000', 'AddPersonalPlaylists1788618001000',
    'AddPlaybackSession1788618002000', 'AddUploadReservations1788618003000',
    'BindUploadTemporaryFiles1788618004000', 'TrackUploadInstances1788618005000',
    'LinkUploadMedia1788618006000', 'ProtectLastAdministrator1788618007000',
    'TrackSystemUploadReservations1788618008000',
  ];
  try {
    const applied = new Set(db.prepare('SELECT name FROM migrations').all().map(row => row.name));
    if (required.some(name => !applied.has(name))) throw new Error('missing migration');
    const columns: Record<string, string[]> = {
      media_assets: ['owner_user_id', 'visibility', 'source', 'sourcePath', 'processingStatus', 'processingError'],
      users: ['storage_quota_bytes'],
      playlist_item: ['owner_user_id'],
      playback_history: ['owner_user_id'],
      playback_channels: ['initiator_user_id', 'playback_session'],
      upload_reservations: ['owner_user_id', 'bytes', 'temp_name', 'instance_id', 'target_media_id'],
      upload_instances: ['id'],
    };
    for (const [table, names] of Object.entries(columns)) {
      const actual = db.prepare(`PRAGMA table_info("${table}")`).all();
      if (names.some(name => !actual.some(column => column.name === name))) throw new Error('missing column');
      if (table === 'upload_reservations' && actual.find(column => column.name === 'owner_user_id')?.notnull !== 0) throw new Error('system uploads unsupported');
    }
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'protect_last_administrator_%'").all();
    if (triggers.length !== 2) throw new Error('administrator protection missing');
  } catch {
    throw new Error('Database schema is not ready for multiuser service. Back up the target database and media, then run migration:run before starting. Startup will not repair schema automatically.');
  }
}
