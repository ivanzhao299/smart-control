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

test('fails closed for mixed, dependency, deployment, and unknown changes', () => {
  assert.equal(classifyDeployFiles(['frontend/src/App.vue', 'backend/src/main.ts']).scope, 'full');
  assert.equal(classifyDeployFiles(['frontend/pnpm-lock.yaml']).scope, 'full');
  assert.equal(classifyDeployFiles(['scripts/deploy-from-ci.ps1']).scope, 'full');
  assert.equal(classifyDeployFiles(['some-new-runtime/file']).scope, 'full');
});
