import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyDeployFiles } from './deploy-scope.mjs';

test('classifies public assets as a static release', () => {
  assert.equal(classifyDeployFiles(['frontend/public/welcome/index.html']).scope, 'static');
});

test('classifies each application tier independently', () => {
  assert.equal(classifyDeployFiles(['frontend/src/App.vue', 'frontend/tests/app.test.cjs']).scope, 'frontend');
  assert.equal(classifyDeployFiles(['backend/src/app.module.ts', 'frontend/public/icon.png']).scope, 'backend');
});

test('keeps accumulated release-control and native changes out of the GK9000 runtime scope', () => {
  const frontend = classifyDeployFiles([
    '.github/workflows/ci.yml',
    'tools/ci/verify-production-remote-address.mjs',
    'ios-app/App/AppDelegate.swift',
    'frontend/tests/pwa-precache-config.test.cjs',
    'frontend/vite.config.ts',
  ]);

  assert.equal(frontend.scope, 'frontend');
  assert.equal(frontend.releaseControl, true);
  assert.equal(frontend.highRisk, false);

  const controlOnly = classifyDeployFiles([
    '.github/workflows/deploy-gk9000.yml',
    'tools/ci/deploy-scope.mjs',
    'android-app/app/build.gradle.kts',
  ]);
  assert.equal(controlOnly.scope, 'none');
});

test('treats repository ignore policy as release control without widening runtime scope', () => {
  const ignoreRules = readFileSync('.gitignore', 'utf8').split(/\r?\n/);
  assert.equal(ignoreRules.includes('/media/'), true);
  assert.equal(ignoreRules.includes('media/'), false);

  const hygieneOnly = classifyDeployFiles(['.gitignore']);
  assert.equal(hygieneOnly.scope, 'none');
  assert.equal(hygieneOnly.releaseControl, true);
  assert.equal(hygieneOnly.highRisk, false);

  const withBackend = classifyDeployFiles([
    '.gitignore',
    'backend/src/modules/media/media-file-policy.ts',
  ]);
  assert.equal(withBackend.scope, 'backend');
  assert.equal(withBackend.releaseControl, true);
  assert.equal(withBackend.highRisk, false);
});

test('fails closed for mixed, dependency, deployment, and unknown changes', () => {
  assert.equal(classifyDeployFiles(['frontend/src/App.vue', 'backend/src/main.ts']).scope, 'full');
  assert.equal(classifyDeployFiles(['frontend/pnpm-lock.yaml']).scope, 'full');
  assert.equal(classifyDeployFiles(['scripts/deploy-from-ci.ps1']).scope, 'full');
  assert.equal(classifyDeployFiles(['some-new-runtime/file']).scope, 'full');
});
