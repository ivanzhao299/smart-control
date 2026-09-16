'use strict';

const path = require('node:path');

function pathApi(platform) {
  return platform === 'win32' ? path.win32 : path.posix;
}

function resolveProductionMediaRoot(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const paths = pathApi(platform);
  const configured = String(env.MEDIA_ROOT || '').trim();
  if (configured) return paths.resolve(cwd, configured);
  return platform === 'win32' ? 'D:\\Media' : '/var/lib/smart-control/media';
}

function resolveProductionDatabasePath(options = {}) {
  const platform = options.platform || process.platform;
  const env = options.env || process.env;
  const cwd = options.cwd || process.cwd();
  const paths = pathApi(platform);
  const configured = String(env.DB_PATH || '').trim() || '../database/smart-control.db';
  return paths.resolve(cwd, configured);
}

module.exports = { resolveProductionMediaRoot, resolveProductionDatabasePath };
