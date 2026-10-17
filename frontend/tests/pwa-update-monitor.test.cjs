const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const current = '11111111-1111-4111-8111-111111111111';
const next = '22222222-2222-4222-8222-222222222222';
const later = '33333333-3333-4333-8333-333333333333';
const flush = () => new Promise(resolve => setImmediate(resolve));

function setup(opts = {}) {
  const hasSw = opts.hasSw !== false;
  let swMode = opts.swMode || 'waiting'; // 'waiting' | 'installing' | 'none'
  const workerEvents = new Map(), pageEvents = new Map(), windowEvents = new Map();
  const timers = new Map(), storage = new Map(), local = new Map();
  let nextId = 0, checks = 0, fetches = 0, reloads = 0, prompts = 0, applying = 0;
  let hardRecover = 0, hardReloads = 0;
  let version = current, fail = false, lastMessage = null;
  const installationEvents = new Map();
  const installingSw = {
    state: 'installing',
    addEventListener: (n, f) => installationEvents.set(n, f),
    removeEventListener: n => installationEvents.delete(n),
  };
  const waitingSw = { state: 'waiting', postMessage: (m) => { lastMessage = m; } };
  const registration = {
    installing: null, waiting: null, active: null,
    update: async () => {
      checks++;
      if (swMode === 'waiting') { registration.waiting = waitingSw; registration.installing = null; }
      else if (swMode === 'installing') { registration.installing = installingSw; registration.waiting = null; }
      else { registration.installing = null; registration.waiting = null; }
    },
  };
  const workers = {
    getRegistration: async () => registration,
    addEventListener: (n, f) => workerEvents.set(n, f),
    removeEventListener: n => workerEvents.delete(n),
  };
  const document = {
    visibilityState: 'visible',
    addEventListener: (n, f) => pageEvents.set(n, f),
    removeEventListener: n => pageEvents.delete(n),
  };
  const exports = {};
  // 硬兜底 import('./pwa-recovery') 的 recoverFromStalePwa 在此模拟：计数一次硬清/硬重载，
  // 不真正加载该模块（它依赖 window.location/navigator/caches）。
  const mockRequire = (name) => {
    if (name === './pwa-recovery') {
      return { recoverFromStalePwa: async () => { hardRecover += 1; hardReloads += 1; return true; } };
    }
    throw new Error('unexpected require: ' + name);
  };
  const source = fs.readFileSync(path.resolve(__dirname, '../src/services/pwa-update-monitor.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, {
    exports, require: mockRequire, navigator: hasSw ? { serviceWorker: workers } : {}, document,
    __FRONTEND_BUILD_ID__: opts.servedBuild || current, __FRONTEND_VERSION_URL__: '/control/deployment-version.json',
    fetch: async () => {
      fetches++;
      if (fail) throw new Error('offline');
      return { ok: true, json: async () => ({ frontendBuildId: version }) };
    },
    sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v) },
    localStorage: {
      getItem: k => local.get(k) ?? null,
      setItem: (k, v) => local.set(k, v),
      removeItem: k => local.delete(k),
      key: i => [...local.keys()][i] ?? null,
      get length() { return local.size; },
    },
    window: {
      setTimeout: (fn, ms) => { timers.set(++nextId, { fn, ms }); return nextId; },
      clearTimeout: id => timers.delete(id),
      setInterval: () => { throw new Error('No periodic update polling permitted'); },
      addEventListener: (n, f) => windowEvents.set(n, f),
      removeEventListener: n => windowEvents.delete(n),
      location: { reload: () => reloads++, replace: () => hardReloads += 1 },
    },
  });
  let readyApply = null;
  const handle = exports.startPwaUpdateMonitor({
    onReady: (apply) => { readyApply = apply; prompts++; },
    onApplying: () => { applying++; },
  });
  return {
    timers, storage, local, handle, workerEvents, pageEvents, windowEvents,
    notify: exports.notifyFrontendBuild,
    setVersion: v => { version = v; }, setFail: v => { fail = v; }, setMode: m => { swMode = m; },
    applyNow: () => { if (readyApply) readyApply(); },
    controllerChange: () => workerEvents.get('controllerchange')?.(),
    show: () => { document.visibilityState = 'visible'; pageEvents.get('visibilitychange')?.(); },
    online: () => windowEvents.get('online')?.(),
    installingToInstalled: () => {
      installingSw.state = 'installed'; registration.waiting = waitingSw;
      installationEvents.get('statechange')?.();
    },
    installingRedundant: () => {
      installingSw.state = 'redundant'; installationEvents.get('statechange')?.();
    },
    runTimeout: ms => { for (const [id, t] of [...timers]) if (t.ms === ms) { timers.delete(id); t.fn(); } },
    get checks() { return checks; }, get fetches() { return fetches; },
    get reloads() { return reloads; }, get prompts() { return prompts; },
    get applying() { return applying; }, get lastMessage() { return lastMessage; },
    get hardRecover() { return hardRecover; }, get hardReloads() { return hardReloads; },
  };
}

test('idle: same build / invalid hello produce no prompt, no update work', async () => {
  const s = setup(); await flush();
  // 冷启动主动核对一次，版本相同 -> 无任何更新动作。
  assert.equal(s.fetches, 1); assert.equal(s.checks, 0);
  assert.equal(s.prompts, 0); assert.equal(s.reloads, 0);
  s.notify(current); s.notify(undefined); s.notify('bad'); await flush();
  s.controllerChange(); s.runTimeout(150);
  assert.equal(s.prompts, 0); assert.equal(s.reloads, 0);
  assert.equal(s.timers.size, 0);
  s.handle.stop();
});

test('waiting SW: duplicate hellos coalesce, prompt once, apply after user confirms', async () => {
  const s = setup(); await flush();
  s.setVersion(next); s.notify(next); s.notify(next); await flush();
  assert.equal(s.fetches, 2); assert.equal(s.checks, 1);
  assert.equal(s.prompts, 1); assert.equal(s.reloads, 0);
  s.applyNow();
  assert.equal(s.lastMessage.type, 'SKIP_WAITING');
  s.controllerChange(); s.runTimeout(150);
  assert.equal(s.applying, 1); assert.equal(s.reloads, 1);
  s.handle.stop();
});

test('SKIP_WAITING sent but controllerchange never fires (iOS stuck): 4s timeout hard recovers', async () => {
  const s = setup({ swMode: 'waiting' }); await flush();
  s.setVersion(next); s.notify(next); await flush();
  assert.equal(s.prompts, 1);
  s.applyNow();
  assert.equal(s.lastMessage.type, 'SKIP_WAITING');
  // 旧 SW 不主动让位, controllerchange 一直不来(典型 iOS 独立壳)。
  s.runTimeout(4000);
  assert.equal(s.applying, 1);
  assert.equal(s.hardRecover, 1);
  assert.equal(s.hardReloads, 1);
  assert.equal(s.reloads, 0);
  s.handle.stop();
});

test('hard-recover guard persists across reload: same target never hard-recovers twice', async () => {
  const s1 = setup({ swMode: 'none' }); await flush();
  s1.setVersion(next); s1.notify(next); await flush();
  s1.applyNow(); await flush();
  assert.equal(s1.hardRecover, 1);
  // 模拟硬清后重载却仍未拿到新版(极端网络): 新实例带着 localStorage 标记启动,
  // 冷启动核对服务器仍为 next(而自身还是旧版), 不应再硬清, 退回普通 reload 避免死循环。
  const s2 = setup({ swMode: 'none' });
  for (const [k, v] of s1.local) s2.local.set(k, v);
  s2.setVersion(next);
  await flush();
  s2.applyNow(); s2.runTimeout(150);
  assert.equal(s2.hardRecover, 0);
  assert.equal(s2.reloads, 1);
  s1.handle.stop(); s2.handle.stop();
});

test('once the new build is actually loaded, hard-recover marks are cleared', async () => {
  const s1 = setup({ swMode: 'none' }); await flush();
  s1.setVersion(next); s1.notify(next); await flush();
  s1.applyNow(); await flush();
  assert.equal(s1.hardRecover, 1);
  // 硬清后重载成功: 新实例自身就是新版 build, 冷启动核对与服务器一致 -> 清除历史标记,
  // 为将来下一次部署重新启用硬兜底。
  const s2 = setup({ swMode: 'none', servedBuild: next });
  for (const [k, v] of s1.local) s2.local.set(k, v);
  s2.setVersion(next);
  await flush();
  assert.equal(s2.local.size, 0);
  assert.equal(s2.hardRecover, 0);
  s1.handle.stop(); s2.handle.stop();
});

test('no SW capability: plain reload on confirm', async () => {
  const s = setup({ hasSw: false }); await flush();
  s.setVersion(next); s.notify(next); await flush();
  assert.equal(s.prompts, 1);
  s.applyNow(); s.runTimeout(150);
  // 无 SW 能力(普通浏览器)：无 SW 可清，普通 reload 即可。
  assert.equal(s.reloads, 1);
  assert.equal(s.hardRecover, 0);
  s.handle.stop();
});

test('registration present but no waiting/installing SW: hard recover (unregister+purge)', async () => {
  const s = setup({ hasSw: true, swMode: 'none' }); await flush();
  s.setVersion(next); s.notify(next); await flush();
  assert.equal(s.prompts, 1);
  s.applyNow(); await flush();
  // 新 SW 装不上(旧 SW 卡住)：普通 reload 仍被旧 SW 劫持，必须注销 SW + 清 precache 硬重载。
  assert.equal(s.hardRecover, 1);
  assert.equal(s.hardReloads, 1);
  assert.equal(s.reloads, 0);
  // 同一目标 build 只硬清一次：再次检测不重复注销，退回普通 reload。
  s.online(); await flush();
  s.applyNow(); s.runTimeout(150);
  assert.equal(s.hardRecover, 1);
  assert.equal(s.reloads, 1);
  s.handle.stop();
});

test('offline failure stays silent with no retry timer; online event resumes the update', async () => {
  const s = setup(); await flush();
  s.setFail(true); s.setVersion(next); s.notify(next); await flush();
  assert.equal(s.prompts, 0); assert.equal(s.reloads, 0); assert.equal(s.timers.size, 0);
  s.setFail(false); s.online(); await flush();
  assert.equal(s.prompts, 1);
  s.applyNow(); s.controllerChange(); s.runTimeout(150);
  assert.equal(s.reloads, 1);
  s.handle.stop();
});

test('dismiss ("later") hides the prompt; returning to foreground prompts again', async () => {
  const s = setup(); await flush();
  s.setVersion(next); s.notify(next); await flush();
  assert.equal(s.prompts, 1);
  s.handle.dismiss();
  await flush(); assert.equal(s.prompts, 1);
  s.show(); await flush();
  assert.equal(s.prompts, 2);
  s.applyNow(); s.controllerChange(); s.runTimeout(150);
  assert.equal(s.reloads, 1);
  s.handle.stop();
});

test('per-build reload guard prevents loops but allows a later distinct release', async () => {
  const s = setup({ hasSw: false }); await flush();
  s.storage.set('sc.pwa.reloadBuild', next);
  s.setVersion(next); s.notify(next); await flush();
  s.applyNow(); s.runTimeout(150); assert.equal(s.reloads, 0);
  s.setVersion(later); s.notify(later); await flush();
  s.applyNow(); s.runTimeout(150); assert.equal(s.reloads, 1);
  s.handle.stop();
});

test('installing SW that reaches installed becomes waiting and prompts', async () => {
  const s = setup({ swMode: 'installing' }); await flush();
  s.setVersion(next); s.notify(next); await flush();
  assert.equal(s.prompts, 0);
  s.installingToInstalled(); await flush();
  assert.equal(s.prompts, 1);
  s.applyNow(); s.controllerChange(); s.runTimeout(150);
  assert.equal(s.reloads, 1);
  s.handle.stop();
});

test('installing SW going redundant never reloads; a later detection recovers', async () => {
  const s = setup({ swMode: 'installing' }); await flush();
  s.setVersion(next); s.notify(next); await flush();
  s.installingRedundant(); await flush();
  assert.equal(s.prompts, 0); assert.equal(s.reloads, 0);
  s.setMode('waiting'); s.online(); await flush();
  assert.equal(s.prompts, 1);
  s.applyNow(); s.controllerChange(); s.runTimeout(150);
  assert.equal(s.reloads, 1);
  s.handle.stop();
});

test('rollback to loaded build cancels the update; disposal removes listeners and timers', async () => {
  const s = setup(); await flush();
  s.setVersion(next); s.notify(next); await flush();
  assert.equal(s.prompts, 1);
  s.setVersion(current); s.notify(current); await flush();
  assert.equal(s.reloads, 0);
  s.handle.stop(); await flush();
  assert.equal(s.workerEvents.size + s.pageEvents.size + s.windowEvents.size, 0);
  assert.equal(s.timers.size, 0);
});
