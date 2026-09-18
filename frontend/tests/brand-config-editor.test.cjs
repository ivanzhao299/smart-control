const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const ts = require('typescript'), vue = require('vue');
const row = (over = {}) => ({ id: 1, name: ' Exact Vendor ', displayName: 'Published', logoUrl: null,
  country: null, website: null, salesContact: null, techContact: null, remark: null, enabled: false,
  configRevision: 1, hardwareCount: 0, driverCount: 0, ...over });
function fixture() {
  const modules = {}, writes = [], messages = [];
  const services = {
    list: async () => [row()],
    create: async payload => { writes.push(['create', payload]); return row({ ...payload, id: 2 }); },
    update: async (id, payload) => { writes.push(['update', id, payload]); return row({ ...payload, id, configRevision: payload.expectedRevision + 1 }); },
    remove: async (id, revision) => { writes.push(['remove', id, revision]); },
  };
  const ui = { ElMessage: Object.fromEntries(['error', 'success'].map(level => [level, text => messages.push([level, text])])), ElMessageBox: { confirm: async () => true } };
  function load(name) {
    if (modules[name]) return modules[name];
    if (name === 'vue') return vue;
    if (name === 'element-plus') return ui;
    if (name.endsWith('brand.service')) return { brandService: services };
    const filename = name.endsWith('identity-boundary') ? 'services/identity-boundary.ts' : 'features/useBrandConfigEditor.ts';
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', filename), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText, { exports, require: load, JSON, Number });
    return modules[name] = exports;
  }
  const scope = vue.effectScope(), state = scope.run(() => load('editor').useBrandConfigEditor());
  return { state, scope, services, writes, messages, ui, switchIdentity: () => load('@/services/identity-boundary').invalidateIdentity() };
}

test('brand editor preserves exact soft-link keys, null and false and sends a revision', async () => {
  const f = fixture(); await f.state.refresh(); f.state.openEdit(f.state.list.value[0]);
  f.state.form.displayName = 'Updated'; await f.state.submit();
  assert.equal(f.writes[0][2].expectedRevision, 1); assert.equal(f.writes[0][2].name, ' Exact Vendor ');
  assert.equal(f.writes[0][2].logoUrl, null); assert.equal(f.writes[0][2].enabled, false);
  assert.equal(f.state.list.value[0].configRevision, 2); assert.equal(f.state.editVisible.value, false); f.scope.stop();
});
test('one frozen save retains continued typing and advances its acknowledged version', async () => {
  const f = fixture(); await f.state.refresh(); f.state.openEdit(f.state.list.value[0]);
  f.state.form.displayName = 'Submitted'; let finish;
  f.services.update = (id, payload) => { f.writes.push(payload); return new Promise(resolve => { finish = resolve; }); };
  const pending = f.state.submit(); f.state.form.displayName = 'Continued'; await f.state.submit();
  assert.equal(f.writes.length, 1); assert.equal(f.writes[0].displayName, 'Submitted');
  finish(row({ displayName: 'Submitted', configRevision: 2 })); await pending;
  assert.equal(f.state.form.displayName, 'Continued'); assert.equal(f.state.editVisible.value, true);
  assert.equal(f.state.expectedRevision.value, 2); f.scope.stop();
});
test('conflicts and uncertain transport failures retain drafts, prevent retry, and require confirmed reload', async () => {
  for (const status of [409, 503]) {
    const f = fixture(); await f.state.refresh(); f.state.openEdit(f.state.list.value[0]); f.state.form.displayName = 'Keep';
    f.services.update = async () => { f.writes.push('attempt'); throw { status, message: 'synthetic failure' }; };
    await f.state.submit(); await f.state.submit(); assert.equal(f.writes.length, 1);
    assert.equal(f.state.form.displayName, 'Keep'); assert.equal(f.state.needsReload.value, true);
    f.ui.ElMessageBox.confirm = async () => { throw 'cancel'; }; await f.state.refresh(); assert.equal(f.state.form.displayName, 'Keep');
    f.ui.ElMessageBox.confirm = async () => true; await f.state.refresh(); assert.equal(f.state.form.displayName, 'Published'); f.scope.stop();
  }
});
test('failed/missing-version reads block creation and failed reload keeps the current draft', async () => {
  const f = fixture(); f.services.list = async () => [row({ configRevision: undefined })];
  await f.state.refresh(); f.state.openCreate(); assert.equal(f.state.editVisible.value, false);
  f.services.list = async () => [row()]; await f.state.refresh(); f.state.openEdit(f.state.list.value[0]); f.state.form.displayName = 'Keep';
  f.services.list = async () => { throw Error('offline'); }; await f.state.refresh(); await f.state.submit();
  assert.equal(f.writes.length, 0); assert.equal(f.state.form.displayName, 'Keep'); f.scope.stop();
});
test('reload cannot overwrite typing during the read, and deleted brands keep their blocked draft', async () => {
  const f = fixture(); await f.state.refresh(); f.state.openEdit(f.state.list.value[0]); let finish, signal;
  const started = new Promise(resolve => { signal = resolve; });
  f.services.list = () => new Promise(resolve => { finish = resolve; signal(); });
  const pending = f.state.refresh(); await started; f.state.form.displayName = 'Keep'; finish([row({ configRevision: 3 })]); await pending;
  assert.equal(f.state.form.displayName, 'Keep'); assert.equal(f.state.needsReload.value, true);
  f.services.list = async () => []; await f.state.refresh();
  assert.equal(f.state.form.displayName, 'Keep'); assert.equal(f.state.editVisible.value, true); assert.equal(f.state.needsReload.value, true); f.scope.stop();
});
test('row toggle/delete carry frozen versions and editing blocks unrelated row writes', async () => {
  const f = fixture(); await f.state.refresh(); await f.state.toggleEnabled(f.state.list.value[0]);
  assert.equal(f.writes[0][2].enabled, true); assert.equal(f.writes[0][2].expectedRevision, 1);
  f.state.openEdit(f.state.list.value[0]); await f.state.remove(f.state.list.value[0]); assert.equal(f.writes.length, 1);
  f.state.editVisible.value = false; await f.state.remove(f.state.list.value[0]); assert.deepEqual(f.writes[1], ['remove', 1, 2]); f.scope.stop();
});
test('identity change during delete confirmation never sends the old-account delete', async () => {
  const f = fixture(); await f.state.refresh(); let finish;
  f.ui.ElMessageBox.confirm = () => new Promise(resolve => { finish = resolve; });
  const pending = f.state.remove(f.state.list.value[0]); f.switchIdentity(); finish(true); await pending;
  assert.equal(f.writes.length, 0); assert.equal(f.state.list.value.length, 0); f.scope.stop();
});
test('old identity or disposed reads and saves cannot refill state or emit late success', async () => {
  for (const kind of ['list', 'update']) for (const invalidate of [f => f.switchIdentity(), f => f.scope.stop()]) {
    const f = fixture(); await f.state.refresh(); f.state.openEdit(f.state.list.value[0]); let finish;
    f.services[kind] = () => new Promise(resolve => { finish = resolve; });
    if (kind === 'list') f.state.editVisible.value = false;
    const pending = kind === 'list' ? f.state.refresh() : f.state.submit();
    invalidate(f); finish(kind === 'list' ? [row({ displayName: 'Late' })] : row({ displayName: 'Late', configRevision: 2 })); await pending;
    assert.equal(f.state.list.value.some(r => r.displayName === 'Late'), false);
    assert.equal(f.messages.some(([level]) => level === 'success'), false); f.scope.stop();
  }
});
test('creation is not retried after an uncertain result and a later acknowledged create becomes an edit', async () => {
  const uncertain = fixture(); await uncertain.state.refresh(); uncertain.state.openCreate(); uncertain.state.form.name = 'Keep new';
  uncertain.services.create = async () => { uncertain.writes.push('attempt'); throw Error('transport disconnected'); };
  await uncertain.state.submit(); await uncertain.state.submit();
  assert.equal(uncertain.writes.length, 1); assert.equal(uncertain.state.form.name, 'Keep new'); assert.equal(uncertain.state.needsReload.value, true); uncertain.scope.stop();
  const f = fixture(); await f.state.refresh(); f.state.openCreate(); f.state.form.name = 'New';
  let finish; f.services.create = payload => { f.writes.push(payload); return new Promise(resolve => { finish = resolve; }); };
  const pending = f.state.submit(); f.state.form.remark = 'Continued'; finish(row({ id: 2, name: 'New' })); await pending;
  assert.equal(f.state.editMode.value, 'edit'); assert.equal(f.state.expectedRevision.value, 1);
  await f.state.submit(); assert.equal(f.writes[1][0], 'update'); assert.equal(f.writes[1][1], 2); f.scope.stop();
});
test('malformed or regressive save receipts block further writes', async () => {
  const f = fixture(); await f.state.refresh(); f.state.openEdit(f.state.list.value[0]);
  f.services.update = async () => row({ id: 99, configRevision: 2 }); await f.state.submit();
  assert.equal(f.state.needsReload.value, true); assert.equal(f.state.editVisible.value, true); assert.equal(f.state.list.value[0].id, 1); f.scope.stop();
});
test('historical/draft unsafe links are never rendered as website or image URLs', () => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/features/brand-links.ts'), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, URL });
  for (const value of ['javascript:alert(1)', 'data:image/svg+xml,bad', '//evil.invalid/x', 'https://user:pass@host.invalid/x', '/media/../admin', '/media/%2e%2e/admin', 'https://host.invalid/a b']) assert.equal(exports.safeBrandLink(value, true), null);
  for (const value of ['/media/a.png', '/api/media/a.png', 'https://assets.invalid/a.png?token=x']) assert.equal(exports.safeBrandLink(value, true), value);
  assert.equal(exports.safeBrandLink('/media/a.png'), null);
  const page = fs.readFileSync(path.join(__dirname, '../src/pages/admin/BrandsAdmin.vue'), 'utf8');
  assert.equal(page.includes(':href="row.website"'), false); assert.equal(page.includes(':src="row.logoUrl"'), false);
});
