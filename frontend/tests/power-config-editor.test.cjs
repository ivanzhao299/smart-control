const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), vue = require('vue');

const row = (over = {}) => ({ id: 1, code: 'synthetic', name: 'Published', floor: '1F', category: 'misc',
  gatewayCode: null, relayChannel: null, meterAddress: null, ratedVoltage: 220, ratedCurrent: 16,
  ratedPower: 0, sortOrder: 100, icon: null, description: null, enabled: true, configRevision: 1, ...over });
function fixture(kind = 'editor') {
  const modules = {}, writes = [], messages = [], lifecycle = {};
  const services = {
    configurationList: async () => [row()], configuration: async () => row(),
    create: async data => { writes.push(['create', data]); return row({ ...data, id: 2 }); },
    update: async (id, data) => { writes.push(['update', id, data]); return row({ ...data, id, configRevision: data.expectedRevision + 1 }); },
    remove: async (id, expectedRevision) => { writes.push(['remove', id, expectedRevision]); },
    rename: async (id, name, expectedRevision) => { writes.push(['rename', id, name, expectedRevision]); return row({ id, name, configRevision: expectedRevision + 1 }); },
  };
  const ui = { ElMessage: Object.fromEntries(['error', 'success'].map(level => [level, text => messages.push([level, text])])), ElMessageBox: { confirm: async () => true } };
  function load(name) {
    if (modules[name]) return modules[name];
    if (name === 'vue') return { ...vue, onActivated: fn => { lifecycle.activate = fn; }, onDeactivated: fn => { lifecycle.deactivate = fn; } };
    if (name === 'element-plus') return ui;
    if (name.endsWith('power-circuits.service')) return { powerCircuitsService: services };
    const filename = name.endsWith('identity-boundary') ? 'services/identity-boundary.ts' : kind === 'editor' ? 'features/usePowerConfigEditor.ts' : 'features/usePowerCircuitRename.ts';
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: load, JSON, Number });
    return modules[name] = exports;
  }
  const rows = vue.ref([row({ reading: { on: true, voltage: 240 }, isBreaker: true })]);
  const scope = vue.effectScope();
  const state = scope.run(() => kind === 'editor' ? load('feature').usePowerConfigEditor() : load('feature').usePowerCircuitRename(rows, async () => true));
  return { state, scope, services, writes, messages, ui, rows, lifecycle,
    switchIdentity: () => load('@/services/identity-boundary').invalidateIdentity() };
}

test('metadata editor loads fresh versions and preserves nullable addressing without changing telemetry', async () => {
  const f = fixture(); await f.state.refresh(); f.state.openEdit(f.state.list.value[0]);
  assert.equal(f.state.form.relayChannel, null); assert.equal(f.state.form.icon, null);
  f.state.form.name = 'New'; await f.state.submit();
  assert.equal(f.writes[0][2].expectedRevision, 1); assert.equal(f.writes[0][2].relayChannel, null);
  assert.equal(f.state.list.value[0].configRevision, 2); assert.equal(f.state.editVisible.value, false); f.scope.stop();
});

test('only one frozen save is sent and continued typing stays open at the acknowledged revision', async () => {
  const f = fixture(); await f.state.refresh(); f.state.openEdit(f.state.list.value[0]);
  f.state.form.name = 'Submitted'; let finish;
  f.services.update = (id, payload) => { f.writes.push(payload); return new Promise(resolve => { finish = resolve; }); };
  const pending = f.state.submit(); f.state.form.name = 'Continued'; await f.state.submit();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].name, 'Submitted');
  finish(row({ name: 'Submitted', configRevision: 2 })); await pending;
  assert.equal(f.state.form.name, 'Continued'); assert.equal(f.state.editVisible.value, true);
  f.services.update = async (id, payload) => { f.writes.push(payload); return row({ ...payload, configRevision: 3 }); };
  await f.state.submit(); assert.equal(f.writes[1].expectedRevision, 2); f.scope.stop();
});

test('conflicts and transport failures preserve draft, block repeats, and require confirmed reload', async () => {
  for (const status of [409, 503]) {
    const f = fixture(); await f.state.refresh(); f.state.openEdit(f.state.list.value[0]); f.state.form.name = 'Keep';
    f.services.update = async () => { f.writes.push('attempt'); throw { status, message: 'failed' }; };
    await f.state.submit(); await f.state.submit(); assert.equal(f.writes.length, 1);
    assert.equal(f.state.form.name, 'Keep'); assert.equal(f.state.needsReload.value, true);
    f.ui.ElMessageBox.confirm = async () => { throw 'cancel'; }; await f.state.refresh();
    assert.equal(f.state.form.name, 'Keep');
    f.ui.ElMessageBox.confirm = async () => true; await f.state.refresh();
    assert.equal(f.state.form.name, 'Published'); assert.equal(f.state.needsReload.value, false); f.scope.stop();
  }
});

test('failed initial read blocks creation, and a later failed read does not discard drafts', async () => {
  const f = fixture(); f.services.configurationList = async () => { throw new Error('offline'); };
  await f.state.refresh(); f.state.openCreate(); assert.equal(f.state.editVisible.value, false);
  f.services.configurationList = async () => [row()]; await f.state.refresh(); f.state.openEdit(f.state.list.value[0]);
  f.state.form.name = 'Keep'; f.services.configurationList = async () => { throw new Error('offline'); };
  await f.state.refresh(); await f.state.submit(); assert.equal(f.state.form.name, 'Keep'); assert.equal(f.writes.length, 0); f.scope.stop();
});

test('row toggles and deletion carry versions; account change during confirmation prevents deletion', async () => {
  const f = fixture(); await f.state.refresh(); await f.state.toggleEnabled(f.state.list.value[0]);
  assert.equal(f.writes[0][2].expectedRevision, 1); assert.equal(f.state.list.value[0].enabled, false);
  await f.state.remove(f.state.list.value[0]); assert.deepEqual(f.writes[1], ['remove', 1, 2]);
  f.services.configurationList = async () => [row()]; await f.state.refresh(); let finish;
  f.ui.ElMessageBox.confirm = () => new Promise(resolve => { finish = resolve; });
  const deleting = f.state.remove(f.state.list.value[0]); f.switchIdentity(); finish(true); await deleting;
  assert.equal(f.writes.length, 2); assert.equal(f.state.list.value.length, 0); f.scope.stop();
});

test('old account/disposed responses cannot refill metadata or report a late successful save', async () => {
  for (const action of ['read', 'write']) for (const invalidate of [f => f.switchIdentity(), f => f.scope.stop()]) {
    const f = fixture(); await f.state.refresh(); f.state.openEdit(f.state.list.value[0]); let finish;
    f.services[action === 'read' ? 'configurationList' : 'update'] = () => new Promise(resolve => { finish = resolve; });
    if (action === 'read') f.state.editVisible.value = false;
    const pending = action === 'read' ? f.state.refresh() : f.state.submit();
    invalidate(f); finish(action === 'read' ? [row({ name: 'Late' })] : row({ name: 'Late', configRevision: 2 })); await pending;
    assert.equal(f.state.list.value.some(row => row.name === 'Late'), false);
    assert.equal(f.messages.some(([level]) => level === 'success'), false); f.scope.stop();
  }
});

test('inline rename freezes its starting version and only replaces metadata, never readings', async () => {
  const f = fixture('rename'); await f.state.startRename(f.rows.value[0]);
  f.state.renameDraft.value = 'Renamed'; f.rows.value[0].configRevision = 9; // A newer poll must not alter the edit baseline.
  await f.state.commitRename(f.rows.value[0]);
  assert.deepEqual(f.writes, [['rename', 1, 'Renamed', 1]]);
  assert.equal(f.rows.value[0].reading.on, true); assert.equal(f.rows.value[0].configRevision, 9); f.scope.stop();
});

test('inline rename conflict preserves draft and cancellation or leaving stops late responses', async () => {
  const f = fixture('rename'); await f.state.startRename(f.rows.value[0]); f.state.renameDraft.value = 'Keep';
  f.services.rename = async () => { f.writes.push('attempt'); throw new Error('409'); };
  await f.state.commitRename(f.rows.value[0]); await f.state.commitRename(f.rows.value[0]);
  assert.equal(f.writes.length, 1); assert.equal(f.state.renameDraft.value, 'Keep'); assert.equal(f.state.renameNeedsReload.value, true);
  f.state.cancelRename(); let finish, signal;
  const started = new Promise(resolve => { signal = resolve; });
  f.services.configuration = () => new Promise(resolve => { finish = resolve; signal(); });
  const reading = f.state.startRename(f.rows.value[0]); await started;
  f.lifecycle.deactivate(); finish(row({ name: 'Late' })); await reading;
  assert.equal(f.state.renamingId.value, null); assert.equal(f.rows.value[0].name, 'Published'); f.scope.stop();
});

test('late telemetry preserves newer configuration while accepting the actual latest reading', () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/services/power-circuits.service.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: () => ({}) });
  const merged = exports.mergePowerCircuitView(row({ name: 'Old', configRevision: 1, reading: { on: true } }), row({ name: 'New', configRevision: 2, reading: { on: false } }));
  assert.equal(merged.name, 'New'); assert.equal(merged.reading.on, true); assert.equal(merged.configRevision, 2);
});
