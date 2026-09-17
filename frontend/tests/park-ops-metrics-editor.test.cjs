const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

function fixture() {
  let form = null, defaults = 0;
  const modules = {}, writes = [], messages = [];
  const services = {
    buildDefaultDoc: () => { defaults++; return { source: 'default' }; },
    fetchParkOpsMetricsSnapshot: async () => ({ document: { source: 'published' }, revision: 3 }),
    saveParkOpsMetrics: async (document, expectedRevision) => {
      writes.push({ document, expectedRevision }); return { document, revision: expectedRevision + 1 };
    },
  };
  function load(name) {
    if (modules[name]) return modules[name];
    if (name === 'vue') return vue;
    if (name === 'element-plus') return { ElMessage: Object.fromEntries(['success', 'info', 'error'].map(level => [level, text => messages.push([level, text])])) };
    if (name === '@/services/park-ops-metrics.service') return services;
    const filename = name === '@/services/identity-boundary' ? 'services/identity-boundary.ts' : 'features/useParkOpsMetricsEditor.ts';
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: load });
    return modules[name] = exports;
  }
  const scope = vue.effectScope();
  const state = scope.run(() => load('editor').useParkOpsMetricsEditor({
    fill: value => { form = value; }, collect: () => form, clear: () => { form = null; },
  }));
  return { scope, state, writes, messages, services, defaults: () => defaults, form: () => form,
    edit: value => { form = value; }, switchIdentity: () => load('@/services/identity-boundary').invalidateIdentity() };
}

test('editor binds writes to the loaded revision and preserves edits made while saving', async () => {
  const f = fixture(); await f.state.load();
  assert.equal(f.form().source, 'published'); let finish;
  f.services.saveParkOpsMetrics = (document, revision) => { f.writes.push({ document, revision }); return new Promise(resolve => { finish = resolve; }); };
  f.edit({ source: 'first edit' }); const pending = f.state.save();
  f.edit({ source: 'continued typing' }); await f.state.save();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].revision, 3);
  finish({ revision: 4 }); await pending;
  assert.equal(f.state.revision.value, 4); assert.equal(f.form().source, 'continued typing'); f.scope.stop();
});

test('only a successful empty snapshot loads defaults; a failed read must not allow publishing defaults', async () => {
  const f = fixture();
  f.services.fetchParkOpsMetricsSnapshot = async () => { throw new Error('offline'); };
  await f.state.load(); await f.state.save();
  assert.equal(f.defaults(), 0); assert.equal(f.writes.length, 0); assert.equal(f.state.revision.value, null);
  f.services.fetchParkOpsMetricsSnapshot = async () => ({ document: null, revision: 0 });
  await f.state.load(); await f.state.save();
  assert.equal(f.defaults(), 1); assert.equal(f.writes[0].expectedRevision, 0); f.scope.stop();
});

test('409 preserves the draft, blocks repeated stale saves, and requires an explicit reload', async () => {
  const f = fixture(); await f.state.load(); let saves = 0;
  f.edit({ source: 'my draft' });
  f.services.saveParkOpsMetrics = async () => { saves++; throw { status: 409 }; };
  await f.state.save(); await f.state.save();
  assert.equal(saves, 1); assert.equal(f.form().source, 'my draft');
  assert.equal(f.state.needsReload.value, true);
  await f.state.load(); assert.equal(f.form().source, 'published');
  assert.equal(f.state.needsReload.value, false); f.scope.stop();
});

test('late old-account or disposed reads cannot refill the editor', async () => {
  for (const invalidate of [f => f.switchIdentity(), f => f.scope.stop()]) {
    const f = fixture(); let finish;
    f.services.fetchParkOpsMetricsSnapshot = () => new Promise(resolve => { finish = resolve; });
    const pending = f.state.load(); invalidate(f);
    finish({ document: { source: 'old account' }, revision: 4 }); await pending;
    assert.equal(f.form(), null); assert.equal(f.state.revision.value, null); f.scope.stop();
  }
});

test('late save completion cannot set the new account revision or show success', async () => {
  const f = fixture(); await f.state.load(); let finish;
  f.services.saveParkOpsMetrics = () => new Promise(resolve => { finish = resolve; });
  const pending = f.state.save(); f.switchIdentity(); finish({ revision: 4 }); await pending;
  assert.equal(f.form(), null); assert.equal(f.state.revision.value, null);
  assert.equal(f.messages.filter(message => message[0] === 'success').length, 0); f.scope.stop();
});

test('newer reads win and malformed server revisions fail closed', async () => {
  const f = fixture(); const reads = [];
  f.services.fetchParkOpsMetricsSnapshot = () => new Promise(resolve => reads.push(resolve));
  const old = f.state.load(), latest = f.state.load();
  reads[1]({ document: { source: 'new' }, revision: 5 }); await latest;
  reads[0]({ document: { source: 'old' }, revision: 2 }); await old;
  assert.equal(f.form().source, 'new'); assert.equal(f.state.revision.value, 5);
  f.services.fetchParkOpsMetricsSnapshot = async () => ({ document: null, revision: '5' });
  await f.state.load(); await f.state.save();
  assert.equal(f.writes.length, 0); assert.equal(f.form().source, 'new'); f.scope.stop();
});

test('page uses guarded editor actions, exposes explicit reload and describes SQLite truthfully', () => {
  const page = fs.readFileSync(path.join(__dirname, '../src/pages/admin/ParkOpsMetricsAdmin.vue'), 'utf8');
  assert.match(page, /useParkOpsMetricsEditor/);
  assert.match(page, /revision === null \|\| needsReload/);
  assert.match(page, /重新载入最新版本/); assert.match(page, /SQLite/);
  assert.doesNotMatch(page, /不改动数据库|读取服务端数据失败，已载入出厂默认/);
});
