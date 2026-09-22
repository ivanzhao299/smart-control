const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { join, relative, resolve } = require('node:path');

const root = resolve(__dirname, '../..');
const sourceRoot = join(root, 'backend/src');

function runtimeSources() {
  const files = [];
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'migrations') walk(file);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
        files.push(file);
      }
    }
  };
  walk(sourceRoot);
  return files;
}

const toRepoPath = file => relative(root, file).split(require('node:path').sep).join('/');

test('runtime services cannot read retired JSON authorities or execute schema DDL', () => {
  const legacyAuthorities = /(?:video-binding|park-ops-metrics|matrix-state|park-ops-control)\.json(?:\.bak)?/i;
  const schemaDdl = /\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TRIGGER)\b/i;
  for (const file of runtimeSources()) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, legacyAuthorities, `${toRepoPath(file)} references a retired JSON authority`);
    assert.doesNotMatch(source, schemaDdl, `${toRepoPath(file)} contains runtime schema DDL`);
  }
});

test('every startup lifecycle hook stays on the reviewed runtime-state allowlist', () => {
  const expected = [
    'backend/src/adapters/led/nova-led.adapter.ts',
    'backend/src/adapters/power/epa-mqtt-breaker.adapter.ts',
    'backend/src/modules/audio/audio-reconciler.service.ts',
    'backend/src/modules/cameras/cameras.service.ts',
    'backend/src/modules/cameras/park-ops-metrics.service.ts',
    'backend/src/modules/cameras/video-binding.service.ts',
    'backend/src/modules/dali-lights/dali-lights.service.ts',
    'backend/src/modules/logs/operation-log.service.ts',
    'backend/src/modules/media/media.service.ts',
    'backend/src/modules/playback/playback.service.ts',
    'backend/src/modules/pv/pv.service.ts',
    'backend/src/modules/scheduler/scheduler.service.ts',
    'backend/src/modules/system/site-heartbeat.service.ts',
    'backend/src/modules/system/system.service.ts',
    'backend/src/modules/websocket/status.gateway.ts',
    'backend/src/services/device-status.service.ts',
  ];
  const actual = runtimeSources()
    .filter(file => /\bon(?:ModuleInit|ApplicationBootstrap)\s*\(/.test(fs.readFileSync(file, 'utf8')))
    .map(toRepoPath)
    .sort();
  assert.deepEqual(actual, expected);
});

test('catalog services remain free of startup hooks and fallback seed writes', () => {
  const services = [
    'backend/src/modules/admin-auth/admin-auth.service.ts',
    'backend/src/modules/app-release/app-release.service.ts',
    'backend/src/modules/audio-config/audio-config.service.ts',
    'backend/src/modules/brands/brands.service.ts',
    'backend/src/modules/client-auth/client-auth.service.ts',
    'backend/src/modules/drivers/driver-registry.service.ts',
    'backend/src/modules/hardware/hardware.service.ts',
    'backend/src/modules/light-zones/light-zones.service.ts',
    'backend/src/modules/power-circuits/power-circuits.service.ts',
    'backend/src/modules/scenes/scenes.service.ts',
    'backend/src/modules/system-branding/system-branding.service.ts',
  ];
  for (const service of services) {
    const source = fs.readFileSync(join(root, service), 'utf8');
    assert.doesNotMatch(source, /\bon(?:ModuleInit|ApplicationBootstrap)\s*\(/, `${service} has a startup hook`);
  }
  const branding = fs.readFileSync(join(root, 'backend/src/modules/system-branding/system-branding.service.ts'), 'utf8');
  assert.doesNotMatch(branding, /repo\.save\(this\.repo\.create\(\{\s*id:\s*1[\s\S]*DEFAULTS/);
});
