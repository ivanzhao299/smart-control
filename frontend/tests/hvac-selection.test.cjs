const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = require('vue');

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}

function execute() {
  const modelModule = { exports: {} };
  vm.runInNewContext(
    transpile(path.resolve(__dirname, '../src/features/hvac-view-model.ts')),
    { module: modelModule, exports: modelModule.exports, require },
  );
  const module = { exports: {} };
  vm.runInNewContext(
    transpile(path.resolve(__dirname, '../src/composables/useHvacSelection.ts')),
    {
      module,
      exports: module.exports,
      Set,
      Map,
      require(id) {
        if (id === 'vue') return vue;
        if (id === '@/features/hvac-view-model') return modelModule.exports;
        if (id === '@/services/hvac.service') return {};
        throw new Error(id);
      },
    },
  );
  return module.exports.useHvacSelection;
}

function state(patch = {}) {
  return {
    known: true,
    on: false,
    temperature: 24,
    mode: 'auto',
    fan: 'auto',
    online: true,
    faultCode: 0,
    ...patch,
  };
}

function indoor(idx, floor, zoneCode, patch = {}) {
  return { idx, name: `内机${idx}`, floor, zoneCode, state: state(patch) };
}

function harness() {
  const indoors = vue.ref([
    indoor(1, '1F', 'front', { on: true, temperature: 22, mode: 'cool', fan: 'low', roomTemp: 20 }),
    indoor(2, '1F', 'front', { on: true, temperature: 24, mode: 'cool', fan: 'low', roomTemp: 22 }),
    indoor(3, '1F', null, { on: false, temperature: 28, mode: 'heat', fan: 'high', roomTemp: 24 }),
    indoor(4, '2F', 'meeting', { known: false, online: false }),
  ]);
  const zones = vue.ref([
    { code: 'front', name: '前厅', floor: '1F', indoors: [1, 2] },
    { code: 'empty', name: '空分区', floor: '1F', indoors: [] },
    { code: 'meeting', name: '会议室', floor: '2F', indoors: [4] },
  ]);
  const floor = vue.ref('1F');
  const selected = vue.ref(new Set([4]));
  const scope = vue.effectScope();
  const selection = scope.run(() => execute()({ indoors, zones, floor, selected }));
  return { indoors, zones, floor, selected, scope, selection };
}

function selectedIndexes(h) {
  return [...h.selected.value].sort((a, b) => a - b).join(',');
}

test('floor selection operations preserve hidden-floor selections', () => {
  const h = harness();
  assert.equal(h.selection.visibleIndoors.value.map((row) => row.idx).join(','), '1,2,3');
  h.selection.selectAll();
  assert.equal(selectedIndexes(h), '1,2,3,4');
  assert.equal(h.selection.allSelected.value, true);
  h.selection.selectAll();
  assert.equal(selectedIndexes(h), '4');
  h.selection.invertSelection();
  assert.equal(selectedIndexes(h), '1,2,3,4');
  h.scope.stop();
});

test('zone selection toggles visible members and ignores empty zones', () => {
  const h = harness();
  h.selection.selectZone('front');
  assert.equal(selectedIndexes(h), '1,2,4');
  assert.equal(h.selection.isZoneSelected('front'), true);
  h.selection.selectZone('front');
  assert.equal(selectedIndexes(h), '4');
  h.selection.selectZone('empty');
  assert.equal(selectedIndexes(h), '4');
  assert.equal(h.selection.isZoneSelected('empty'), false);
  h.scope.stop();
});

test('selected control values are reactive and ignore unknown readings', () => {
  const h = harness();
  h.selected.value = new Set([1, 2, 4]);
  assert.equal(h.selection.selectedIdxs.value.join(','), '1,2,4');
  assert.equal(h.selection.selectedMode.value, 'cool');
  assert.equal(h.selection.selectedFan.value, 'low');
  assert.equal(h.selection.selectedPower.value, true);
  assert.equal(h.selection.selectedTemperature.value, 23);
  h.selection.toggleOne(3);
  assert.equal(h.selection.selectedMode.value, null);
  assert.equal(h.selection.selectedPower.value, null);
  h.scope.stop();
});

test('view projections retain empty zones, ungrouped units, and current names', () => {
  const h = harness();
  assert.equal(h.selection.visibleZones.value.map((zone) => zone.code).join(','), 'front,empty');
  assert.equal(h.selection.groupedSections.value.map((group) => `${group.code}:${group.rows.length}`).join(','), 'front:2,empty:0,null:1');
  assert.equal(h.selection.zoneCards.value.map((card) => `${card.code}:${card.members.length}`).join(','), 'front:2,empty:0,null:1');
  assert.equal(h.selection.ungroupedCount.value, 1);
  assert.equal(h.selection.zoneNameOf('front'), '前厅');
  h.zones.value[0].name = '迎宾厅';
  assert.equal(h.selection.zoneNameOf('front'), '迎宾厅');
  assert.equal(h.selection.zoneNameOf(null), '未分组');
  assert.equal(h.selection.zoneKey(null), '__none__');
  h.scope.stop();
});

test('changing floor updates the projection without rewriting selection', () => {
  const h = harness();
  h.floor.value = '2F';
  assert.equal(h.selection.visibleIndoors.value.map((row) => row.idx).join(','), '4');
  assert.equal(h.selection.overview.value.unknownCount, 1);
  assert.equal(h.selection.allSelected.value, true);
  assert.equal(selectedIndexes(h), '4');
  h.scope.stop();
});

