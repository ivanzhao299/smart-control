const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), vue = require('vue');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(rename = false) {
  const calls = [], messages = [], modules = {}, activate = [], deactivate = [];
  const zones = [0, 1].map(channel => ({ id: channel + 1, channel, name: `old·${channel ? '右' : '左'}`, floor: null, color: null, sortOrder: channel, enabled: true, configRevision: 1 }));
  const inputs = [{ id: 1, channel: 0, name: 'input', color: null, enabled: true, sortOrder: 0, configRevision: 1 }];
  const scenes = [{ id: 1, presetNum: 1, name: 'scene', hint: null, content: null, enabled: true, sortOrder: 0, configRevision: 1 }];
  const dialog = { confirm: async () => {} };
  const service = { applyScene: async (...args) => { calls.push(['apply', ...args]); return { ok: true }; } };
  for (const [kind, rows] of [['Zone', zones], ['Input', inputs], ['Scene', scenes]]) {
    service[`list${kind}s`] = async (...args) => { calls.push(['list' + kind, ...args]); return rows; };
    service[`update${kind}`] = async (id, patch) => {
      calls.push(['update' + kind, id, patch]);
      const row = rows.find(item => item.id === id);
      if (patch.expectedRevision !== row.configRevision) throw Object.assign(new Error('conflict'), { status: 409 });
      const { expectedRevision, ...fields } = patch;
      if (fields.content && typeof fields.content === 'object') fields.content = JSON.stringify(fields.content);
      Object.assign(row, fields); row.configRevision += 1;
      const result = { ...row };
      if (kind === 'Zone') {
        const partner = rows.find(item => item.id !== id);
        row.name = row.name.replace(/·[左右]$/, '') + '·左'; result.name = row.name;
        partner.name = row.name.replace(/·左$/, '·右'); partner.configRevision += 1;
        result.pairedZone = { ...partner };
      }
      return result;
    };
  }
  const load = name => {
    if (modules[name]) return modules[name];
    if (name === 'vue') return { ...vue, onActivated: fn => activate.push(fn), onDeactivated: fn => deactivate.push(fn) };
    if (name === 'element-plus') return { ElMessage: Object.fromEntries(['error', 'success', 'info'].map(level => [level, message => messages.push([level, message])])), ElMessageBox: dialog };
    if (name === '@/services/audio-config.service') return { audioConfigService: service, parseSceneContent: scene => scene.content ? JSON.parse(scene.content) : null };
    const file = name === '@/services/identity-boundary' ? 'services/identity-boundary.ts' : `features/${rename ? 'useAudioZoneRename' : 'useAudioConfigEditor'}.ts`;
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: load });
    return modules[name] = exports;
  };
  const rows = vue.ref(zones.map(row => ({ dbId: row.id, name: row.name, configRevision: row.configRevision, volume: 37 })));
  const scope = vue.effectScope();
  const state = scope.run(() => rename ? load('editor').useAudioZoneRename(rows, async () => true, row => row.name.endsWith('·左')) : load('editor').useAudioConfigEditor());
  return { scope, state, calls, messages, service, zones, inputs, scenes, rows, dialog,
    switchIdentity: () => load('@/services/identity-boundary').invalidateIdentity(),
    deactivate: () => deactivate.forEach(fn => fn()), activate: () => activate.forEach(fn => fn()),
  };
}

test('editor loads uncached isolated drafts and sends their revision on writes', async () => {
  const f = fixture(); await f.state.refresh(false);
  assert.equal(f.state.needsReload.value, false);
  assert.ok(f.calls.every(call => call[1] === true && call[2] === true));
  f.state.inputs.value[0].name = 'draft'; assert.equal(f.inputs[0].name, 'input');
  await f.state.saveInput(f.state.inputs.value[0]);
  assert.equal(f.calls.at(-1)[2].expectedRevision, 1); assert.equal(f.state.inputs.value[0].configRevision, 2);
  f.scope.stop();
});
test('missing server revisions and failed reads prohibit saving without replacing drafts', async () => {
  const f = fixture(); await f.state.refresh(false); f.state.inputs.value[0].name = 'keep';
  f.service.listInputs = async () => { throw new Error('offline'); };
  await f.state.refresh(); assert.equal(f.state.needsReload.value, true); assert.equal(f.state.inputs.value[0].name, 'keep');
  await f.state.saveInput(f.state.inputs.value[0]); assert.equal(f.calls.filter(call => call[0] === 'updateInput').length, 0);
  f.service.listInputs = async () => [{ ...f.inputs[0], configRevision: undefined }];
  await f.state.refresh(); assert.equal(f.state.needsReload.value, true); f.scope.stop();
});
test('409 preserves drafts and requires explicit confirmed reload before any more writes', async () => {
  const f = fixture(); await f.state.refresh(false); f.state.inputs.value[0].name = 'my draft';
  f.inputs[0].name = 'other admin'; f.inputs[0].configRevision = 2;
  await f.state.saveInput(f.state.inputs.value[0]);
  assert.equal(f.state.inputs.value[0].name, 'my draft'); assert.equal(f.state.needsReload.value, true);
  f.dialog.confirm = async () => { throw new Error('cancel'); }; await f.state.refresh();
  assert.equal(f.state.inputs.value[0].name, 'my draft');
  f.dialog.confirm = async () => {}; await f.state.refresh();
  assert.equal(f.state.inputs.value[0].name, 'other admin'); assert.equal(f.state.needsReload.value, false); f.scope.stop();
});
test('stereo saving updates untouched partner but preserves independent drafts', async () => {
  const f = fixture(); await f.state.refresh(false);
  f.state.zones.value[0].name = 'renamed'; f.state.inputs.value[0].name = 'unrelated draft';
  await f.state.saveZone(f.state.zones.value[0]);
  assert.equal(f.calls.filter(call => call[0] === 'updateZone').length, 1);
  assert.equal(f.state.zones.value[1].name, 'renamed·右'); assert.equal(f.state.zones.value[1].configRevision, 2);
  assert.equal(f.state.inputs.value[0].name, 'unrelated draft');
  f.state.zones.value[1].name = 'partner draft'; f.state.zones.value[0].name = 'rename again';
  await f.state.saveZone(f.state.zones.value[0]);
  assert.equal(f.state.zones.value[1].name, 'partner draft'); assert.equal(f.state.needsReload.value, true); f.scope.stop();
});
test('a save in flight cannot run twice or erase typing done after the request', async () => {
  const f = fixture(); await f.state.refresh(false); const pending = deferred();
  const row = f.state.inputs.value[0]; row.name = 'submitted'; let writes = 0;
  f.service.updateInput = async () => { writes++; return pending.promise; };
  const save = f.state.saveInput(row); await f.state.saveInput(row); row.name = 'new typing';
  pending.resolve({ ...f.inputs[0], name: 'submitted', configRevision: 2 }); await save;
  assert.equal(writes, 1); assert.equal(row.name, 'new typing'); assert.equal(row.configRevision, 2); f.scope.stop();
});
test('scene route save preserves disabled outputs and independent metadata drafts', async () => {
  const f = fixture(); f.scenes[0].content = JSON.stringify({ outputs: [{ ch: 7, inputs: [3], volume: 22 }] });
  await f.state.refresh(false); f.state.scenes.value[0].name = 'unsaved name';
  f.state.openEditor(f.state.scenes.value[0]); await f.state.saveContent();
  const write = f.calls.find(call => call[0] === 'updateScene');
  assert.ok(write[2].content.outputs.some(row => row.ch === 7 && row.volume === 22));
  assert.equal('name' in write[2], false); assert.equal(f.state.scenes.value[0].name, 'unsaved name');
  assert.equal(f.state.scenes.value[0].configRevision, 2); f.scope.stop();
});
test('save then audition uses the exact returned revision, rejects missing acknowledgement', async () => {
  const f = fixture(); await f.state.refresh(false); f.state.openEditor(f.state.scenes.value[0]);
  f.service.applyScene = async (...args) => { f.calls.push(['apply', ...args]); return { ok: false }; };
  await f.state.applyNow();
  assert.deepEqual(f.calls.at(-1), ['apply', 1, 2]);
  assert.ok(f.messages.some(([level, text]) => level === 'error' && text.includes('设备未确认')));
  assert.equal(f.state.editingScene.value.configRevision, 2); assert.equal(f.state.editorVisible.value, true); f.scope.stop();
});
test('failed or conflicted route save never sends an audition command', async () => {
  const f = fixture(); await f.state.refresh(false); f.state.openEditor(f.state.scenes.value[0]);
  f.scenes[0].configRevision = 2;
  await f.state.applyNow(); assert.equal(f.calls.filter(call => call[0] === 'apply').length, 0);
  assert.equal(f.state.editorVisible.value, true); assert.equal(f.state.needsReload.value, true); f.scope.stop();
});
test('account switch between save and audition clears drafts and blocks the hardware follow-up', async () => {
  const f = fixture(); await f.state.refresh(false); f.state.openEditor(f.state.scenes.value[0]);
  const pending = deferred(); f.service.updateScene = () => pending.promise;
  const work = f.state.applyNow(); f.switchIdentity();
  pending.resolve({ ...f.scenes[0], configRevision: 2 }); await work;
  assert.equal(f.calls.filter(call => call[0] === 'apply').length, 0); assert.equal(f.state.scenes.value.length, 0);
  assert.equal(f.state.editingScene.value, null); f.scope.stop();
});
test('closing the route editor while saving prevents a subsequent audition request', async () => {
  const f = fixture(); await f.state.refresh(false); f.state.openEditor(f.state.scenes.value[0]);
  const pending = deferred(); f.service.updateScene = () => pending.promise;
  const work = f.state.applyNow(); f.state.editorVisible.value = false;
  pending.resolve({ ...f.scenes[0], configRevision: 2 }); await work;
  assert.equal(f.calls.filter(call => call[0] === 'apply').length, 0);
  assert.equal(f.state.scenes.value[0].configRevision, 2); f.scope.stop();
});
test('late reads cannot restore rows after account change or disposal', async () => {
  const f = fixture(), pending = deferred(); f.service.listZones = () => pending.promise;
  const read = f.state.refresh(false); f.switchIdentity(); pending.resolve(f.zones); await read;
  assert.equal(f.state.zones.value.length, 0); assert.equal(f.state.loading.value, false); f.scope.stop();
});
test('control-page rename refreshes metadata without changing volume, then sends one atomic request', async () => {
  const f = fixture(true), row = f.rows.value[0];
  await f.state.startRenameCh(row); f.state.editingChText.value = 'new pair'; await f.state.commitRenameCh(row);
  assert.equal(f.calls.filter(call => call[0] === 'updateZone').length, 1);
  assert.equal(f.calls.at(-1)[2].expectedRevision, 1);
  assert.deepEqual(plain(f.rows.value).map(row => [row.name, row.volume, row.configRevision]), [['new pair·左', 37, 2], ['new pair·右', 37, 2]]); f.scope.stop();
});
test('control-page rename does not fake success or send a second request after conflict', async () => {
  const f = fixture(true), row = f.rows.value[0]; await f.state.startRenameCh(row);
  f.zones[0].configRevision = 2; f.state.editingChText.value = 'stale'; await f.state.commitRenameCh(row);
  assert.equal(row.name, 'old·左'); assert.equal(f.calls.filter(call => call[0] === 'updateZone').length, 1);
  assert.ok(f.messages.some(([level]) => level === 'error')); f.scope.stop();
});
test('control-page rename delayed by permissions or a read cannot reopen after leaving', async () => {
  const f = fixture(true), pending = deferred(); f.service.listZones = () => pending.promise;
  const start = f.state.startRenameCh(f.rows.value[0]); await Promise.resolve(); f.deactivate(); pending.resolve(f.zones); await start;
  assert.equal(f.state.editingCh.value, null); f.scope.stop();
});
test('audio editor integration delegates state and blocks writes while reload is needed', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/pages/admin/AudioConfigAdmin.vue'), 'utf8');
  assert.match(source, /useAudioConfigEditor\(/); assert.match(source, /busy \|\| needsReload/);
  assert.doesNotMatch(source, /audioConfigService\./);
});
