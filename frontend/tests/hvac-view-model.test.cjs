const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/features/hvac-view-model.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require });
  return module.exports;
}

const model = load();

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

function row(idx, floor, zoneCode, patch = {}) {
  return { idx, name: `内机${idx}`, floor, zoneCode, state: state(patch) };
}

const zones = [
  { code: 'front', name: '前厅', floor: '1F', indoors: [1, 2] },
  { code: 'empty', name: '空分区', floor: '1F', indoors: [] },
  { code: 'meeting', name: '会议室', floor: '2F', indoors: [4] },
];

const rows = [
  row(1, '1F', 'front', { on: true, temperature: 22, mode: 'cool', roomTemp: 20 }),
  row(2, '1F', 'front', { on: true, temperature: 24, mode: 'cool', roomTemp: 22, faultCode: 3 }),
  row(3, '1F', null, { on: false, temperature: 28, mode: 'heat', roomTemp: 24 }),
  row(4, '2F', 'meeting', { known: false, online: false }),
];

test('floor projection keeps rows and empty zones in their original order', () => {
  assert.equal(model.filterIndoorsByFloor(rows, '1F').map(x => x.idx).join(','), '1,2,3');
  assert.equal(model.filterIndoorsByFloor(rows, 'all').map(x => x.idx).join(','), '1,2,3,4');
  assert.equal(model.filterZonesByFloor(zones, '1F').map(x => x.code).join(','), 'front,empty');
});

test('grouped sections retain empty groups and append ungrouped units', () => {
  const sections = model.buildGroupedSections(
    model.filterIndoorsByFloor(rows, '1F'),
    model.filterZonesByFloor(zones, '1F'),
  );
  assert.equal(sections.map(x => `${x.code}:${x.rows.length}`).join(','), 'front:2,empty:0,null:1');
  assert.equal(sections[2].name, '未分组');
  assert.equal(sections[2].zone, null);
});

test('overview and zone cards use known device readings without inventing unknown state', () => {
  const overview = model.summarizeHvacOverview(rows, zones.length);
  assert.equal(JSON.stringify(overview), JSON.stringify({
    onCount: 2,
    knownCount: 3,
    unknownCount: 1,
    total: 4,
    faultCount: 1,
    avgRoomT: 22,
    zoneCount: 3,
  }));

  const cards = model.buildZoneCards(
    model.filterIndoorsByFloor(rows, '1F'),
    model.filterZonesByFloor(zones, '1F'),
  );
  assert.equal(cards.map(x => `${x.code}:${x.members.length}`).join(','), 'front:2,empty:0,null:1');
  assert.equal(cards[0].onCount, 2);
  assert.equal(cards[0].temp, 23);
  assert.equal(cards[0].mode, 'cool');
  assert.equal(cards[0].avgRoomT, 21);
  assert.equal(cards[1].temp, 26);
  assert.equal(cards[2].temp, 28);
});

test('selected control values ignore unknown readings and expose disagreement', () => {
  assert.equal(model.commonKnownState([rows[0], rows[1], rows[3]], 'mode'), 'cool');
  assert.equal(model.commonKnownState([rows[0], rows[2], rows[3]], 'mode'), null);
  assert.equal(model.commonKnownState([rows[3]], 'on'), null);
  assert.equal(model.averageSelectedTemperature([rows[0], rows[1], rows[3]]), 23);
  assert.equal(model.averageSelectedTemperature([rows[3]]), 24);
});

test('selection operations toggle whole groups and preserve hidden-floor selections', () => {
  let selected = model.toggleSelection(new Set([4]), [1, 2]);
  assert.equal(Array.from(selected).sort((a, b) => a - b).join(','), '1,2,4');
  assert.equal(model.isSelectionComplete(selected, [1, 2]), true);

  selected = model.toggleSelection(selected, [1, 2]);
  assert.equal(Array.from(selected).join(','), '4');
  assert.equal(model.isSelectionComplete(selected, []), false);

  selected = model.invertVisibleSelection(new Set([1, 4]), [1, 2, 3]);
  assert.equal(Array.from(selected).sort((a, b) => a - b).join(','), '2,3,4');
});

test('HvacPage delegates shared projections and selection state to one composable', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/HvacPage.vue'), 'utf8');
  const selection = fs.readFileSync(path.resolve(__dirname, '../src/composables/useHvacSelection.ts'), 'utf8');
  assert.match(page, /useHvacSelection\(\{ indoors, zones, floor: floorTab, selected \}\)/);
  assert.doesNotMatch(page, /interface IndoorState/);
  assert.doesNotMatch(page, /function buildZoneCard\(/);
  assert.doesNotMatch(page, /function commonOf</);
  assert.doesNotMatch(page, /buildGroupedSections\(/);
  assert.doesNotMatch(page, /buildZoneCards\(/);
  assert.match(selection, /buildGroupedSections\(visibleIndoors\.value, visibleZones\.value\)/);
  assert.match(selection, /buildZoneCards\(visibleIndoors\.value, visibleZones\.value\)/);
});
