const fs = require('node:fs/promises');
const path = require('node:path');
const { verifyReleaseBundle } = require('./release-recovery-bundle.cjs');
const { loadEnvFile } = require('./run-migrations.js');
const { resolveProductionMediaRoot, resolveProductionDatabasePath } = require('./production-paths.cjs');
const { reconcile } = require('./reconcile-bundled-media.cjs');

async function verify(receiptPath, candidateRevision, root) {
  const receipt = JSON.parse(await fs.readFile(receiptPath, 'utf8'));
  if (receipt.version !== 1 || receipt.kind !== 'gk9000-migration-complete' ||
      !/^[a-f0-9]{40}$/.test(candidateRevision || '') || receipt.candidateRevision !== candidateRevision ||
      receipt.productionActivated !== false || typeof receipt.databasePath !== 'string' || typeof receipt.mediaRoot !== 'string') {
    throw new Error('Invalid migration receipt');
  }
  const bundle = await verifyReleaseBundle(path.dirname(receiptPath));
  if (bundle.manifest.sourceRevision !== receipt.sourceRevision) throw new Error('Recovery revision mismatch');
  const backend = path.join(root, 'backend');
  loadEnvFile(backend);
  const db = resolveProductionDatabasePath({ cwd: backend });
  const mediaRoot = resolveProductionMediaRoot({ cwd: backend });
  const normalize = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
  if (normalize(db) !== normalize(receipt.databasePath) ||
      normalize(mediaRoot) !== normalize(receipt.mediaRoot)) throw new Error('Production paths changed after migration');
  if (receipt.bundledMedia?.catalogVersion !== 1 || receipt.bundledMedia?.count !== 15) {
    throw new Error('Bundled media reconciliation evidence is missing');
  }
  reconcile({
    manifestPath: path.join(root, 'deploy', 'assets', 'bundled-media-manifest.json'),
    databasePath: db,
    mediaRoot,
    checkOnly: true,
  });
  return true;
}
if (require.main === module) {
  const [receipt, revision, root, extra] = process.argv.slice(2);
  if (!receipt || !root || extra) process.exitCode = 1;
  else verify(receipt, revision, root).catch(() => {
    console.error('Migration receipt or recovery verification failed. Keep release isolation.');
    process.exitCode = 1;
  });
}
module.exports = { verify };
