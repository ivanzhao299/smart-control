// Explicit offline entry: never stops/restarts production itself.
// The release operator must keep the host isolated until activation or recovery.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

async function run() {
  if (process.platform !== 'win32' || os.hostname().toUpperCase() !== 'GK9000') {
    throw new Error('Controlled production migration is restricted to GK9000');
  }
  const [destinationRoot, sourceRevision, extra] = process.argv.slice(2);
  if (extra || !destinationRoot || !path.isAbsolute(destinationRoot) || !/^[a-f0-9]{40}$/.test(sourceRevision || '')) {
    throw new Error('Required: absolute existing recovery directory and pre-release full revision');
  }
  if (!fs.statSync(destinationRoot).isDirectory()) throw new Error('Recovery destination must be a directory');
  const root = 'D:\\smart-control';
  if (fs.realpathSync(path.resolve(__dirname, '../..')).toLowerCase() !== root.toLowerCase()) {
    throw new Error('Unexpected deployment checkout');
  }
  const assertWritersStopped = async () => {
    const result = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(root, 'scripts', 'assert-gk9000-writers-stopped.ps1'),
      '-ProjectRoot', root, '-MigrationPid', String(process.pid)],
    { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.trim() !== 'GK9000_WRITERS_STOPPED') throw new Error('No verified stopped-writer result');
    return true;
  };
  // Before loading config, opening SQLite or producing a backup.
  await assertWritersStopped();
  process.chdir(path.join(root, 'backend'));
  const { main, loadEnvFile } = require('./run-migrations.js');
  loadEnvFile(process.cwd());
  if (!process.env.MEDIA_ROOT || !path.isAbsolute(process.env.MEDIA_ROOT)) {
    throw new Error('An explicit absolute production MEDIA_ROOT is required');
  }
  await main({ destinationRoot, sourceRevision, mediaRoot: process.env.MEDIA_ROOT, assertWritersStopped });
}

if (require.main === module) run().catch(error => {
  // Child-process errors can include command output; never dump the whole object.
  console.error('Controlled migration failed; keep release isolation and preserve recovery artifacts.');
  if (error.bundleDirectory) console.error(`Recovery bundle: ${error.bundleDirectory}`);
  if (error.rehearsalDirectory) console.error(`Restore rehearsal: ${error.rehearsalDirectory}`);
  process.exitCode = 1;
});
module.exports = { run };
