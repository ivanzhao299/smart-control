const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { ref, computed } = require('vue');

const source = fs.readFileSync(path.resolve(__dirname, '../src/features/hvac-view-state.ts'), 'utf8');
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const loaded = { exports: {} };
vm.runInNewContext(output, { module: loaded, exports: loaded.exports });
const view = loaded.exports;
const plain = value => JSON.parse(JSON.stringify(value));
const row = (idx, state = {}, zoneCode = 'a') => ({
  idx, name: `内机 ${idx}`, floor: '1F', zoneCode,
  state: { ...view.unknownState(), known: true, online: true, ...state },
});

test('unknown placeholders are independent and never count as off or contribute stale readings', () => {
  const first = view.unknownState();
  first.on = true;
  assert.equal(view.unknownState().on, false);
  assert.equal(view.unknownState().known, false);
  const summary = view.buildOverview([
    row(1, { on: true, roomTemp: 20, faultCode: 3 }),
    row(2, { on: false, roomTemp: 23.1 }),
    row(3, { known: false, on: true, roomTemp: 90, faultCode: 9 }),
  ], 2);
  assert.deepEqual(plain(summary), {
    onCount: 1, knownCount: 2, unknownCount: 1, total: 3,
    faultCount: 1, avgRoomT: 21.6, zoneCount: 2,
  });
});

test('overview preserves zero room temperature and has no invented measurement for an empty list', () => {
  assert.equal(view.buildOverview([row(1, { roomTemp: 0 }), row(2)], 1).avgRoomT, 0);
  assert.deepEqual(plain(view.buildOverview([], 0)), {
    onCount: 0, knownCount: 0, unknownCount: 0, total: 0, faultCount: 0, avgRoomT: null, zoneCount: 0,
  });
});

test('selected values ignore unknown readings, preserve false, and mark mixed values', () => {
  const rows = [row(1, { mode: 'cool' }), row(2, { known: false, mode: 'heat' })];
  assert.equal(view.commonStateValue(rows, 'mode'), 'cool');
  assert.equal(view.commonStateValue(rows, 'on'), false);
  assert.equal(view.commonStateValue([...rows, row(3, { mode: 'heat' })], 'mode'), null);
  assert.equal(view.commonStateValue([], 'fan'), null);
  assert.equal(view.commonStateValue([rows[1]], 'on'), null);
  assert.equal(view.selectedTemperature([rows[1]]), 24);
  assert.equal(view.selectedTemperature([row(1, { temperature: 20 }), row(2, { temperature: 25 }), rows[1]]), 23);
});

test('zone temperature prefers running units then known units then the existing 26-degree fallback', () => {
  const card = members => view.buildZoneCard('a', '展厅', members);
  assert.equal(card([row(1, { on: true, temperature: 20 }), row(2, { temperature: 28 })]).temp, 20);
  assert.equal(card([row(1, { temperature: 20 }), row(2, { temperature: 25 })]).temp, 23);
  assert.equal(card([row(1, { known: false, on: true, temperature: 18 })]).temp, 26);
  assert.equal(card([]).temp, 26);
  assert.equal(card([row(1, { temperature: 10 })]).temp, 16);
  assert.equal(card([row(1, { temperature: 35 })]).temp, 30);
});

test('zone mode is shared only by known running units while room temperature includes known stopped units', () => {
  const rows = [row(1, { on: true, mode: 'cool', roomTemp: 20 }), row(2, { mode: 'heat', roomTemp: 25 })];
  const card = view.buildZoneCard('a', '展厅', rows);
  assert.equal(card.mode, 'cool');
  assert.equal(card.avgRoomT, 22.5);
  assert.equal(card.onCount, 1);
  assert.equal(card.members, rows); // commands still target the original reactive members
  assert.equal(view.buildZoneCard('a', '展厅', [...rows, row(3, { on: true, mode: 'heat' })]).mode, null);
  assert.equal(view.buildZoneCard('a', '展厅', [rows[1]]).mode, null);
});

test('grouping preserves empty zones, configured order, member identity and an ungrouped section', () => {
  const zones = [{ code: 'empty', name: '新建区', floor: '1F', indoors: [] }, { code: 'a', name: '展厅', floor: '1F', indoors: [1] }];
  const rows = [row(1), row(2, {}, null)];
  const sections = view.buildGroupedSections(rows, zones);
  assert.deepEqual(Array.from(sections, section => section.code), ['empty', 'a', null]);
  assert.equal(sections[0].rows.length, 0);
  assert.equal(sections[1].rows[0], rows[0]);
  assert.equal(sections[1].zone, zones[1]);
  assert.equal(sections[2].name, '未分组');
  assert.equal(view.buildGroupedSections([], zones).length, 2);
});

test('selectors remain pure and Vue computed values follow status changes and member reassignment', () => {
  const original = [row(1)];
  const before = JSON.stringify(original);
  Object.freeze(original[0].state);
  Object.freeze(original[0]);
  Object.freeze(original);
  view.buildOverview(original, 1);
  view.buildZoneCard('a', '展厅', original);
  view.commonStateValue(original, 'mode');
  view.selectedTemperature(original);
  view.buildGroupedSections(original, []);
  assert.equal(JSON.stringify(original), before);

  const rows = ref([row(1)]);
  const summary = computed(() => view.buildOverview(rows.value, 1));
  const card = computed(() => view.buildZoneCard('a', '展厅', rows.value.filter(item => item.zoneCode === 'a')));
  assert.equal(summary.value.onCount, 0);
  rows.value[0].state.on = true;
  assert.equal(summary.value.onCount, 1);
  assert.equal(card.value.onCount, 1);
  rows.value[0].state.known = false;
  assert.equal(summary.value.unknownCount, 1);
  assert.equal(card.value.onCount, 0);
  rows.value[0].zoneCode = null;
  assert.equal(card.value.members.length, 0);
});

test('HVAC page consumes one pure view-state boundary without duplicating selectors', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/HvacPage.vue'), 'utf8');
  assert.match(page, /from '@\/features\/hvac-view-state'/);
  for (const name of ['unknownState', 'buildZoneCard', 'buildOverview', 'buildGroupedSections', 'commonStateValue', 'selectedTemperature']) {
    assert.doesNotMatch(page, new RegExp(`function ${name}\\b`));
    assert.match(page, new RegExp(`${name}\\(`));
  }
  assert.doesNotMatch(output, /require\(/); // no HTTP, Vue, timers or device side effects
});
