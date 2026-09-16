// Explicit offline entry: never stops/restarts production itself.
// The release operator must keep the host isolated until activation or recovery.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');
const { resolveProductionMediaRoot } = require('./production-paths.cjs');

async function run() {
  let stage = 'entry-validation';
  try {
    if (process.platform !== 'win32' || os.hostname().toUpperCase() !== 'GK9000') {
      throw new Error('Controlled production migration is restricted to GK9000');
    }
    const [destinationRoot, sourceRevision, extra] = process.argv.slice(2);
    if (
      extra ||
      !destinationRoot ||
      !path.isAbsolute(destinationRoot) ||
      !/^[a-f0-9]{40}$/.test(sourceRevision || '')
    ) {
      throw new Error(
        'Required: absolute existing recovery directory and pre-release full revision',
      );
    }
    if (!fs.statSync(destinationRoot).isDirectory())
      throw new Error('Recovery destination must be a directory');
    const root = 'D:\\smart-control';
    if (fs.realpathSync(path.resolve(__dirname, '../..')).toLowerCase() !== root.toLowerCase()) {
      throw new Error('Unexpected deployment checkout');
    }
    const assertWritersStopped = async () => {
      const result = execFileSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          path.join(root, 'scripts', 'assert-gk9000-writers-stopped.ps1'),
          '-ProjectRoot',
          root,
          '-MigrationPid',
          String(process.pid),
        ],
        { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] },
      );
      if (result.trim() !== 'GK9000_WRITERS_STOPPED')
        throw new Error('No verified stopped-writer result');
      return true;
    };
    // Before loading config, opening SQLite or producing a backup.
    stage = 'initial-writer-fence';
    await assertWritersStopped();
    const readRevision = () => {
      const value = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
        timeout: 10000,
      }).trim();
      if (!/^[a-f0-9]{40}$/.test(value)) throw new Error('Invalid candidate revision');
      return value;
    };
    const candidateRevision = readRevision();
    process.chdir(path.join(root, 'backend'));
    const { main, loadEnvFile } = require('./run-migrations.js');
    loadEnvFile(process.cwd());
    const mediaRoot = resolveProductionMediaRoot({ cwd: process.cwd() });
    if (!path.isAbsolute(mediaRoot))
      throw new Error('Production MEDIA_ROOT must resolve to an absolute path');
    stage = 'backup-rehearsal-and-migration';
    const result = await main({ destinationRoot, sourceRevision, mediaRoot, assertWritersStopped });
    if (!result?.bundleDirectory || !result?.rehearsalDirectory) {
      throw new Error(
        'No new verified migration bundle; use an existing verified release receipt for recovery',
      );
    }
    try {
      stage = 'receipt-fence';
      await assertWritersStopped();
      if (readRevision() !== candidateRevision)
        throw new Error('Candidate changed during migration');
      const receipt = {
        version: 1,
        kind: 'gk9000-migration-complete',
        completedAt: new Date().toISOString(),
        sourceRevision,
        candidateRevision,
        databasePath: result.databasePath,
        mediaRoot,
        rehearsalDirectory: result.rehearsalDirectory,
        migrations: result.migrations.map((m) => m.name),
        productionActivated: false,
      };
      const receiptPath = path.join(result.bundleDirectory, 'migration-complete.json');
      fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n', {
        flag: 'wx',
        mode: 0o600,
      });
      return { receiptPath, receipt };
    } catch (error) {
      error.bundleDirectory = result.bundleDirectory;
      error.rehearsalDirectory = result.rehearsalDirectory;
      throw error;
    }
  } catch (error) {
    if (!error.migrationStage) error.migrationStage = stage;
    throw error;
  }
}

if (require.main === module)
  run()
    .then((result) => {
      console.log(`Migration receipt (not activation): ${result.receiptPath}`);
    })
    .catch((error) => {
      // Child-process errors can include command output; never dump the whole object.
      console.error(
        'Controlled migration failed; keep release isolation and preserve recovery artifacts.',
      );
      if (error.migrationStage) console.error(`Failure stage: ${error.migrationStage}`);
      if (error.bundleDirectory) console.error(`Recovery bundle: ${error.bundleDirectory}`);
      if (error.rehearsalDirectory) console.error(`Restore rehearsal: ${error.rehearsalDirectory}`);
      process.exitCode = 1;
    });
module.exports = { run };
