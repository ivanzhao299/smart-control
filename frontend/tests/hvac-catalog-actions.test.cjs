const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

const source = fs.readFileSync(path.resolve(__dirname, '../src/composables/useHvacCatalogActions.ts'), 'utf8');
const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/HvacPage.vue'), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function indoor(idx, overrides = {}) {
  return {
    idx,
    name: `内机 ${idx}`,
    floor: '1F',
    zoneCode: null,
    state: {
      known: true,
      on: false,
      temperature: 22,
      mode: 'cool',
      fan: 'auto',
      online: true,
      faultCode: 0,
    },
    ...overrides,
  };
}

function zone(code = 'zone-a', overrides = {}) {
  return { code, name: code === 'zone-a' ? '会议区' : '接待区', floor: '1F', indoors: [], ...overrides };
}

async function settle(rounds = 6) {
  for (let index = 0; index < rounds; index += 1) await Promise.resolve();
}

function identityBoundary() {
  let generation = 0;
  const listeners = new Set();
  return {
    api: {
      captureIdentityGuard(active = () => true) {
        const expected = generation;
        return () => generation === expected && active();
      },
      onIdentityChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    },
    invalidate() {
      generation += 1;
      for (const listener of [...listeners]) listener();
    },
  };
}

function execute(identity) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, {
    module,
    exports: module.exports,
    Promise,
    Map,
    Set,
    require(id) {
      if (id === 'vue') return vue;
      if (id === 'element-plus') return { ElMessage: {}, ElMessageBox: {} };
      if (id === '@/services/hvac.service') return { hvacService: {} };
      if (id === '@/services/identity-boundary') return identity;
      if (id === '@/features/hvac-view-model') return {};
      throw new Error(id);
    },
  });
  return module.exports.useHvacCatalogActions;
}

function harness(serviceOverrides = {}, options = {}) {
  const identity = identityBoundary();
  const indoors = vue.ref(options.indoors || [indoor(1), indoor(2)]);
  const zones = vue.ref(options.zones || [zone()]);
  let selected = options.selected || [1];
  let floor = options.floor || '1F';
  let reloads = 0;
  const success = [];
  const warnings = [];
  const errors = [];
  const service = {
    updateIndoor: async (idx, patch) => ({ ...indoors.value.find((row) => row.idx === idx), ...patch }),
    renameZone: async (code, name) => ({ ...zones.value.find((entry) => entry.code === code), name }),
    assignIndoors: async (targets, zoneCode) => ({ count: targets.length, zoneCode }),
    createZone: async (name, targetFloor) => zone('zone-new', { name, floor: targetFloor }),
    deleteZone: async (code) => ({ code, releasedIndoors: [] }),
    ...serviceOverrides,
  };
  const useActions = execute(identity.api);
  const scope = vue.effectScope();
  const actions = scope.run(() => useActions({
    indoors,
    zones,
    selectedIdxs: () => selected,
    floor: () => floor,
    reload: options.reload || (async () => { reloads += 1; return true; }),
    service,
    prompt: options.prompt || (async () => ({ value: '新分区' })),
    confirm: options.confirm || (async () => {}),
    messages: {
      success: (message) => success.push(message),
      warning: (message) => warnings.push(message),
      error: (message) => errors.push(message),
    },
  }));
  return {
    actions,
    indoors,
    zones,
    identity,
    scope,
    success,
    warnings,
    errors,
    counts: () => ({ reloads }),
    setSelected(value) { selected = value; },
    setFloor(value) { floor = value; },
  };
}

test('enter followed by blur commits an indoor rename only once', async () => {
  const pending = deferred();
  let calls = 0;
  const h = harness({
    updateIndoor: async (idx, patch) => {
      calls += 1;
      await pending.promise;
      return { ...indoor(idx), ...patch };
    },
  });
  const row = h.indoors.value[0];
  h.actions.startRenameIndoor(row);
  h.actions.editingText.value = '主会议室';
  const enter = h.actions.commitRenameIndoor(row);
  const blur = await h.actions.commitRenameIndoor(row);
  assert.equal(blur, false);
  assert.equal(calls, 1);
  assert.equal(h.actions.catalogBusy.value, true);
  pending.resolve();
  assert.equal(await enter, true);
  assert.equal(h.indoors.value[0].name, '主会议室');
  assert.equal(h.actions.catalogBusy.value, false);
  h.scope.stop();
});

test('all catalog mutations share one lock', async () => {
  const pending = deferred();
  let assignments = 0;
  const h = harness({
    updateIndoor: async (idx, patch) => {
      await pending.promise;
      return { ...indoor(idx), ...patch };
    },
    assignIndoors: async () => { assignments += 1; return { count: 1, zoneCode: 'zone-a' }; },
  });
  const row = h.indoors.value[0];
  h.actions.startRenameIndoor(row);
  h.actions.editingText.value = '前厅内机';
  const rename = h.actions.commitRenameIndoor(row);
  assert.equal(await h.actions.assignTo('zone-a'), false);
  assert.equal(assignments, 0);
  pending.resolve();
  assert.equal(await rename, true);
  h.scope.stop();
});

test('identity change rolls back the old optimistic rename and suppresses its late failure', async () => {
  const pending = deferred();
  const h = harness({ updateIndoor: () => pending.promise });
  const row = h.indoors.value[0];
  h.actions.startRenameIndoor(row);
  h.actions.editingText.value = '旧身份改名';
  const request = h.actions.commitRenameIndoor(row);
  assert.equal(row.name, '旧身份改名');
  h.identity.invalidate();
  assert.equal(row.name, '内机 1');
  h.indoors.value = [indoor(1, { name: '新身份目录' })];
  pending.reject(new Error('旧服务器失败'));
  assert.equal(await request, false);
  assert.equal(h.indoors.value[0].name, '新身份目录');
  assert.deepEqual(h.errors, []);
  h.scope.stop();
});

test('deactivation rolls back optimism and silently reloads after a committed late success', async () => {
  const pending = deferred();
  const reloadGate = deferred();
  let reloads = 0;
  let assignments = 0;
  const h = harness({
    updateIndoor: () => pending.promise,
    assignIndoors: async () => { assignments += 1; return { count: 1, zoneCode: 'zone-a' }; },
  }, {
    reload: async () => {
      reloads += 1;
      await reloadGate.promise;
      h.indoors.value = [indoor(1, { name: '服务端名称' })];
      return true;
    },
  });
  const row = h.indoors.value[0];
  h.actions.startRenameIndoor(row);
  h.actions.editingText.value = '待提交名称';
  const request = h.actions.commitRenameIndoor(row);
  h.actions.stopCatalogActions();
  assert.equal(row.name, '内机 1');
  pending.resolve({ ...indoor(1), name: '服务端名称' });
  await settle();
  assert.equal(h.actions.catalogBusy.value, true);
  assert.equal(await h.actions.assignTo('zone-a'), false);
  assert.equal(assignments, 0);
  reloadGate.resolve();
  assert.equal(await request, false);
  assert.equal(reloads, 1);
  assert.equal(h.indoors.value[0].name, '服务端名称');
  assert.deepEqual(h.success, []);
  assert.deepEqual(h.errors, []);
  h.scope.stop();
});

test('assignment captures one target set and reports success only after authoritative reload', async () => {
  const pending = deferred();
  let sent;
  const h = harness({
    assignIndoors: async (targets, zoneCode) => {
      sent = { targets, zoneCode };
      await pending.promise;
      return { count: targets.length, zoneCode };
    },
  });
  const request = h.actions.assignTo('zone-a');
  h.setSelected([2]);
  h.zones.value[0].name = '后来名称';
  pending.resolve();
  assert.equal(await request, true);
  assert.deepEqual({ targets: Array.from(sent.targets), zoneCode: sent.zoneCode }, { targets: [1], zoneCode: 'zone-a' });
  assert.deepEqual(h.counts(), { reloads: 1 });
  assert.deepEqual(h.success, ['已归入「会议区」']);
  h.scope.stop();
});

test('committed assignment with failed readback keeps optimism without a false success', async () => {
  let reloads = 0;
  const h = harness({}, {
    reload: async () => { reloads += 1; return false; },
  });
  assert.equal(await h.actions.assignTo('zone-a'), true);
  assert.equal(h.indoors.value[0].zoneCode, 'zone-a');
  assert.equal(reloads, 1);
  assert.deepEqual(h.success, []);
  assert.match(h.warnings[0], /已提交.*回读失败/);
  h.scope.stop();
});

test('dialog preflight cancels stale create and delete requests before dispatch', async () => {
  const createPrompt = deferred();
  const deleteConfirm = deferred();
  let creates = 0;
  let deletes = 0;
  const createHarness = harness({
    createZone: async () => { creates += 1; return zone('new'); },
  }, { prompt: () => createPrompt.promise });
  const create = createHarness.actions.createZone();
  createHarness.setFloor('2F');
  createPrompt.resolve({ value: '二楼分区' });
  assert.equal(await create, false);
  assert.equal(creates, 0);
  createHarness.scope.stop();

  const deleteHarness = harness({
    deleteZone: async () => { deletes += 1; return { code: 'zone-a', releasedIndoors: [] }; },
  }, { confirm: () => deleteConfirm.promise });
  const remove = deleteHarness.actions.removeZone(deleteHarness.zones.value[0]);
  deleteHarness.identity.invalidate();
  deleteConfirm.resolve();
  assert.equal(await remove, false);
  assert.equal(deletes, 0);
  deleteHarness.scope.stop();
});

test('delete failure restores the zone and every previous membership', async () => {
  const h = harness({
    deleteZone: async () => { throw new Error('数据库写入失败'); },
  }, {
    indoors: [indoor(1, { zoneCode: 'zone-a' }), indoor(2, { zoneCode: 'zone-a' })],
  });
  assert.equal(await h.actions.removeZone(h.zones.value[0]), false);
  assert.deepEqual(h.zones.value.map((entry) => entry.code), ['zone-a']);
  assert.deepEqual(h.indoors.value.map((row) => row.zoneCode), ['zone-a', 'zone-a']);
  assert.match(h.errors[0], /删除失败: 数据库写入失败/);
  h.scope.stop();
});

test('HvacPage delegates catalog writes and lifecycle invalidation to the catalog composable', () => {
  assert.match(page, /useHvacCatalogActions\(\{/);
  assert.match(page, /stopCatalogActions\(\)/);
  assert.doesNotMatch(page, /hvacService\.(updateIndoor|renameZone|assignIndoors|createZone|deleteZone)/);
  assert.doesNotMatch(page, /function commitRenameIndoor/);
  assert.match(source, /captureIdentityGuard/);
  assert.match(source, /operation已提交|操作已提交/);
});
