import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyDeployFiles, applyForceScope } from './deploy-scope.mjs';

test('classifies public assets as a static release', () => {
  assert.equal(classifyDeployFiles(['frontend/public/welcome/index.html']).scope, 'static');
});

test('classifies the isolated 3d-twin directory as twin scope', () => {
  const twin = classifyDeployFiles([
    'frontend/public/park-ops/3d-twin/bootstrap.js',
    'frontend/public/park-ops/3d-twin/viewer/index.html',
    'frontend/public/park-ops/3d-twin/viewer/assets/reference-day.webp',
  ]);
  assert.equal(twin.scope, 'twin');
  assert.equal(twin.twinOnly, true);
  assert.equal(twin.highRisk, false);

  // Mixed with other public assets -> normal static scope, never isolated twin.
  const mixedStatic = classifyDeployFiles([
    'frontend/public/park-ops/3d-twin/bootstrap.js',
    'frontend/public/park-ops/index.html',
  ]);
  assert.equal(mixedStatic.scope, 'static');

  // Mixed with frontend code -> normal frontend build, never isolated twin.
  const mixedCode = classifyDeployFiles([
    'frontend/public/park-ops/3d-twin/bootstrap.js',
    'frontend/src/App.vue',
  ]);
  assert.equal(mixedCode.scope, 'frontend');
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

test('classifies controlled-release orchestration and deploy verification as non-runtime', () => {
  const controlOnly = classifyDeployFiles([
    'scripts/resume-gk9000-release.ps1',
    'scripts/verify-deploy.js',
  ]);
  assert.equal(controlOnly.scope, 'none');
  assert.equal(controlOnly.releaseControl, true);
  assert.equal(controlOnly.highRisk, false);

  // Mixed with backend runtime code -> a backend release (the control script
  // does not widen the scope to full), and the control flag is still recorded.
  const withBackend = classifyDeployFiles([
    'scripts/resume-gk9000-release.ps1',
    'backend/src/main.ts',
  ]);
  assert.equal(withBackend.scope, 'backend');
  assert.equal(withBackend.releaseControl, true);
});

test('fails closed for mixed, dependency, deployment, and unknown changes', () => {
  assert.equal(classifyDeployFiles(['frontend/src/App.vue', 'backend/src/main.ts']).scope, 'full');
  assert.equal(classifyDeployFiles(['frontend/pnpm-lock.yaml']).scope, 'full');
  assert.equal(classifyDeployFiles(['scripts/deploy-from-ci.ps1']).scope, 'full');
  assert.equal(classifyDeployFiles(['some-new-runtime/file']).scope, 'full');
});

test('manual force scope overrides the auto-classified scope for validated commits', () => {
  // A tests/docs-only commit auto-classifies to none (paths-ignore never opens a
  // push deploy); an operator can force a frontend deploy for the validated HEAD.
  const docsOnly = classifyDeployFiles(['MEMORY.md', 'frontend/tests/identity-boundary.test.cjs']);
  assert.equal(docsOnly.scope, 'none');

  const forced = applyForceScope(docsOnly, 'frontend');
  assert.equal(forced.scope, 'frontend');
  assert.equal(forced.forced, true);

  // auto / empty / whitespace leave the classification untouched.
  assert.equal(applyForceScope(docsOnly, 'auto').scope, 'none');
  assert.equal(applyForceScope(docsOnly, '').scope, 'none');
  assert.equal(applyForceScope(docsOnly, undefined).scope, 'none');
  assert.equal(applyForceScope(docsOnly, 'auto').forced, undefined);

  // A real frontend classification stays frontend even when force is auto.
  const real = classifyDeployFiles(['frontend/src/pages/MediaPage.vue']);
  assert.equal(applyForceScope(real, 'auto').scope, 'frontend');

  // Only real deploy scopes are forceable: none/twin are rejected, as are typos.
  assert.throws(() => applyForceScope(docsOnly, 'none'), /Invalid --force scope/);
  assert.throws(() => applyForceScope(docsOnly, 'twin'), /Invalid --force scope/);
  assert.throws(() => applyForceScope(docsOnly, 'frondend'), /Invalid --force scope/);
});
