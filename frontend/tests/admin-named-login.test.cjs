const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = relative => fs.readFileSync(path.resolve(__dirname, '..', relative), 'utf8');

test('admin login submits a named account and stores both biometric fields as one opaque credential', () => {
  const page = read('src/pages/admin/AdminLogin.vue');
  const store = read('src/stores/admin-auth.ts');
  const service = read('src/services/admin-auth.service.ts');
  assert.match(page, /v-model="username"/);
  assert.match(page, /authStore\.login\(normalizedUsername, password\.value\)/);
  assert.match(page, /JSON\.stringify\(\{ version: 2, username: normalizedUsername, password: password\.value \}\)/);
  assert.match(store, /async function login\(username: string, password: string\)/);
  assert.match(service, /\/admin\/auth\/login', \{ username, password \}/);
});

test('shared-password mutation controls are absent from the current admin UI and API client', () => {
  const branding = read('src/pages/admin/SystemBrandingAdmin.vue');
  const service = read('src/services/admin-auth.service.ts');
  assert.doesNotMatch(branding, /修改后台密码|重置业主端密码|pwForm|cpForm/);
  assert.doesNotMatch(service, /change-password|client-auth\/password|adminChangePassword|adminResetClientPassword/);
});
