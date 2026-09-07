const { createReleaseBundle, rehearseReleaseRestore } = require('./release-recovery-bundle.cjs');
const fs = require('node:fs/promises');

/** Caller must hold continuous ingress/service/worker isolation until activation or recovery. */
async function migrateWithRecovery({ dataSource, databasePath, mediaRoot, destinationRoot, sourceRevision, assertWritersStopped }) {
  if (typeof assertWritersStopped !== 'function') throw new Error('Controlled migration requires a continuous writer fence and paired recovery configuration');
  const check = async () => {
    if (await assertWritersStopped() !== true) throw new Error('Writer fence lost; keep services and ingress isolated');
  };
  await check();
  if (!dataSource?.isInitialized || typeof dataSource.options.database !== 'string' ||
      await fs.realpath(dataSource.options.database) !== await fs.realpath(databasePath)) {
    throw new Error('Migration connection and recovery database must be the same initialized file');
  }
  const bundle = await createReleaseBundle({ databasePath, mediaRoot, destinationRoot, sourceRevision, assertWritersStopped });
  const restored = await rehearseReleaseRestore(bundle.directory, destinationRoot);
  await check();
  try {
    const migrations = await dataSource.runMigrations({ transaction: 'each' });
    await check();
    return { migrations, bundleDirectory: bundle.directory, rehearsalDirectory: restored.directory };
  } catch (error) {
    // A migration may already have committed. Never restart old code here.
    const failure = new Error('Migration did not complete safely; preserve the recovery bundle and keep services isolated');
    failure.cause = error;
    failure.bundleDirectory = bundle.directory;
    failure.rehearsalDirectory = restored.directory;
    throw failure;
  }
}

module.exports = { migrateWithRecovery };
