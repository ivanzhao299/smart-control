const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

const source = fs.readFileSync(path.resolve(__dirname, '../src/composables/useHvacIndoorOrder.ts'), 'utf8');
const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/HvacPage.vue'), 'utf8');
function deferred() { let resolve; let reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
function execute(service, messages) {
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, Promise, require(id) {
    if (id === 'vue') return vue;
    if (id === 'element-plus') return { ElMessage: { error: (message) => messages.push(message) } };
    if (id === '@/services/hvac.service') return { hvacService: service };
    if (id === '@/services/identity-boundary') return { captureIdentityGuard: (active) => active };
    throw new Error(id);
  } });
  return module.exports.useHvacIndoorOrder;
}
function harness(reorderIndoors) {
  const messages = [];
  const indoors = vue.ref([{ idx: 1 }, { idx: 2 }, { idx: 3 }]);
  const useOrder = execute({ reorderIndoors }, messages);
  const scope = vue.effectScope();
  const state = scope.run(() => useOrder(indoors));
  return { state, indoors, messages, scope };
}
function drag(state, from, to) {
  state.onIndoorDragStart({ idx: from }, { dataTransfer: { setData() {}, effectAllowed: '' } });
  return state.onIndoorDrop({ idx: to });
}

test('drop saves the optimistic order', async () => {
  const calls = [];
  const h = harness(async (ids) => calls.push(Array.from(ids)));
  await drag(h.state, 1, 3);
  assert.deepEqual(Array.from(h.indoors.value, (row) => row.idx), [2, 3, 1]);
  assert.deepEqual(calls, [[2, 3, 1]]);
  h.scope.stop();
});

test('current save failure restores the previous order', async () => {
  const h = harness(async () => { throw new Error('write failed'); });
  await drag(h.state, 1, 3);
  assert.deepEqual(Array.from(h.indoors.value, (row) => row.idx), [1, 2, 3]);
  assert.match(h.messages[0], /write failed/);
  h.scope.stop();
});

test('an older failure cannot roll back a newer successful reorder', async () => {
  const first = deferred();
  const h = harness((ids) => ids[0] === 2 ? first.promise : Promise.resolve());
  const older = drag(h.state, 1, 3);
  await drag(h.state, 2, 1);
  first.reject(new Error('late failure'));
  await older;
  assert.deepEqual(Array.from(h.indoors.value, (row) => row.idx), [3, 1, 2]);
  assert.equal(h.messages.length, 0);
  h.scope.stop();
});

test('scope disposal suppresses late rollback and clears drag state', async () => {
  const pending = deferred();
  const h = harness(() => pending.promise);
  const request = drag(h.state, 1, 3);
  h.scope.stop();
  pending.reject(new Error('late'));
  await request;
  assert.deepEqual(Array.from(h.indoors.value, (row) => row.idx), [2, 3, 1]);
  assert.equal(h.messages.length, 0);
  assert.equal(h.state.dragIndoorIdx.value, null);
});

test('HvacPage delegates indoor ordering to its composable', () => {
  assert.match(page, /useHvacIndoorOrder\(indoors\)/);
  assert.doesNotMatch(page, /reorderIndoors/);
  assert.doesNotMatch(page, /async function onIndoorDrop/);
  assert.match(source, /revision === saveRevision/);
});
