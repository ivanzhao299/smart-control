const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const playerConsole = fs.readFileSync(path.join(__dirname, '../src/components/PlayerConsole.vue'), 'utf8');
const brandingService = fs.readFileSync(path.join(__dirname, '../src/services/system-branding.service.ts'), 'utf8');

test('welcome editor separates draft saving from publishing and carries the opened revision', () => {
  assert.match(playerConsole, /ensureAdmin\('保存欢迎方案'\)/);
  assert.match(playerConsole, /saveWelcomeSchemes\([\s\S]*welcomeSchemesRevision\.value/);
  assert.match(playerConsole, /方案已保存，当前大屏画面未改变/);
  assert.match(playerConsole, /ensureAdmin\('发布欢迎页'\)/);
  assert.match(playerConsole, /publishWelcomeScheme\(selectedId, welcomeSchemesRevision\.value\)/);
  assert.match(playerConsole, /服务器未确认发布结果/);
  assert.match(playerConsole, /发布到 LED 大屏/);
});

test('welcome save contract documents its administrator boundary', () => {
  assert.match(brandingService, /后端仍要求管理员身份/);
  assert.match(brandingService, /expectedRevision/);
  assert.doesNotMatch(brandingService, /客户端 token 即可/);
});
