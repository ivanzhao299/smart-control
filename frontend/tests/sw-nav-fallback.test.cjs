const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const cfg = fs.readFileSync(path.resolve(__dirname, '../vite.config.ts'), 'utf8');

function denylistBlock() {
  const m = cfg.match(/navigateFallbackDenylist:\s*\[([\s\S]*?)\]/);
  assert.ok(m, 'navigateFallbackDenylist 必须存在');
  return m[1];
}

function denylistPatterns() {
  const literals = [...denylistBlock().matchAll(/\/((?:\\.|[^/\\\n])*)\/[gimsuy]*/g)].map(
    (x) => x[1],
  );
  return literals.map((src) => new RegExp(src));
}

test('SW navigateFallbackDenylist 放行 park-ops 与 welcome 静态投放页', () => {
  // 回归 (2026-09-21): welcome 是播放器 iframe 顶层导航加载的物理静态页, 漏配 denylist 时
  // 被 SW 的 SPA navigateFallback 顶替成 index.html 应用壳, iframe 内路由不匹配跳到登录页。
  assert.match(denylistBlock(), /park-ops/);
  assert.match(denylistBlock(), /welcome/);
  const denied = (u) => denylistPatterns().some((re) => re.test(u));
  assert.ok(denied('/control/welcome/index.html'), 'welcome/index.html 必须放行导航');
  assert.ok(denied('/control/welcome/'), 'welcome 目录必须放行导航');
  assert.ok(denied('/control/park-ops/index.html'), 'park-ops/index.html 必须放行导航');
  assert.ok(denied('/control/api/system-branding'), 'API 不进页面回退');
  assert.ok(denied('/control/ws/status'), 'WS 不进页面回退');
  // SPA 自身路由仍应回退到 index.html
  assert.equal(denied('/control/player?slot=1'), false);
  assert.equal(denied('/control/'), false);
});

test('welcome 不进离线预缓存但物理文件入口存在', () => {
  // 设计: welcome 大图不进每台设备的离线包 (globIgnores), 现场内网始终在线, 由 denylist 放行后走网络取物理文件。
  assert.match(cfg, /globIgnores:[^\n]*welcome\/\*\*/);
  assert.ok(fs.existsSync(path.resolve(__dirname, '../public/welcome/index.html')));
});
