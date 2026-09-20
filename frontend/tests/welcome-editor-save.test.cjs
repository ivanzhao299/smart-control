const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const playerConsole = fs.readFileSync(path.join(__dirname, '../src/components/PlayerConsole.vue'), 'utf8');
const brandingService = fs.readFileSync(path.join(__dirname, '../src/services/system-branding.service.ts'), 'utf8');

test('welcome editor revalidates admin access and requires the persisted response to match', () => {
  assert.match(playerConsole, /ensureAdmin\('保存欢迎页'\)/);
  assert.match(playerConsole, /const saved = await saveWelcomeConfig\(patch\)/);
  assert.match(playerConsole, /saved\.welcomeTitle === patch\.welcomeTitle/);
  assert.match(playerConsole, /服务器未确认保存结果/);
});

test('welcome save contract documents its administrator boundary', () => {
  assert.match(brandingService, /后端仍要求管理员身份/);
  assert.doesNotMatch(brandingService, /客户端 token 即可/);
});
