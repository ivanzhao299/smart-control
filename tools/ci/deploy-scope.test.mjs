import test from 'node:test';
import assert from 'node:assert/strict';
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

test('fails closed for mixed, dependency, deployment, and unknown changes', () => {
  assert.equal(classifyDeployFiles(['frontend/src/App.vue', 'backend/src/main.ts']).scope, 'full');
  assert.equal(classifyDeployFiles(['frontend/pnpm-lock.yaml']).scope, 'full');
  assert.equal(classifyDeployFiles(['scripts/deploy-from-ci.ps1']).scope, 'full');
  assert.equal(classifyDeployFiles(['some-new-runtime/file']).scope, 'full');
});
