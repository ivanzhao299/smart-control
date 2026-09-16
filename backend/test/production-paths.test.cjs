const test = require('node:test');
const assert = require('node:assert/strict');
const {
  resolveProductionMediaRoot,
  resolveProductionDatabasePath,
} = require('../scripts/production-paths.cjs');

test('production paths use the application defaults on each platform', () => {
  assert.equal(resolveProductionMediaRoot({ platform: 'win32', env: {}, cwd: 'D:\\smart-control\\backend' }), 'D:\\Media');
  assert.equal(resolveProductionMediaRoot({ platform: 'linux', env: {}, cwd: '/srv/smart-control/backend' }), '/var/lib/smart-control/media');
  assert.equal(resolveProductionDatabasePath({ platform: 'win32', env: {}, cwd: 'D:\\smart-control\\backend' }), 'D:\\smart-control\\database\\smart-control.db');
});

test('production paths normalize explicit relative configuration from the backend cwd', () => {
  assert.equal(resolveProductionMediaRoot({ platform: 'win32', env: { MEDIA_ROOT: '..\\media' }, cwd: 'D:\\smart-control\\backend' }), 'D:\\smart-control\\media');
  assert.equal(resolveProductionDatabasePath({ platform: 'linux', env: { DB_PATH: '../data/app.db' }, cwd: '/srv/app/backend' }), '/srv/app/data/app.db');
});
