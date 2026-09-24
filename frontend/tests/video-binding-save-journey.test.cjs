const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const adminSource = fs.readFileSync(
  path.join(__dirname, '../src/pages/admin/VideoBindingAdmin.vue'),
  'utf8',
);
const editorSource = fs.readFileSync(
  path.join(__dirname, '../src/pages/admin/AiRegionEditor.vue'),
  'utf8',
);
const adminScript = adminSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const adminAst = ts.createSourceFile('video-binding-admin.ts', adminScript, ts.ScriptTarget.Latest, true);
const functionNames = ['withExpectedRevision', 'samePoints', 'sameAiPayload', 'onAiSaved'];
const functions = adminAst.statements
  .filter(node => ts.isFunctionDeclaration(node) && functionNames.includes(node.name?.text))
  .map(node => node.getText(adminAst));
assert.equal(functions.length, functionNames.length);
const executable = ts.transpileModule(functions.join('\n'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

const payload = {
  aiEnabled: true,
  countLine: [{ x: 0.15, y: 0.2 }, { x: 0.85, y: 0.8 }],
  roiPolygon: [{ x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 }, { x: 0.5, y: 0.9 }],
};

function createContext(overrides = {}) {
  const calls = [];
  const context = vm.createContext({
    editorTarget: { value: { id: 'gate' } },
    editorVisible: { value: true },
    aiSaving: { value: false },
    configRevision: { value: 7 },
    channels: { value: [] },
    api: {
      put: async (url, body) => {
        calls.push(['put', url, body]);
        return { data: { message: 'saved' } };
      },
    },
    loadData: async () => {
      context.channels.value = [{ id: 'gate', ...payload }];
      return true;
    },
    ElMessage: {
      success: message => calls.push(['success', message]),
      error: message => calls.push(['error', message]),
      warning: message => calls.push(['warning', message]),
    },
    ...overrides,
  });
  vm.runInContext(executable, context);
  return { context, calls };
}

test('detection-range save sends the opened revision and closes only after server readback matches', async () => {
  const { context, calls } = createContext();

  await context.onAiSaved(payload);

  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), ['put', '/video-binding/channels/gate/ai', {
    ...payload,
    expectedRevision: 7,
  }]);
  assert.equal(context.editorVisible.value, false);
  assert.equal(context.aiSaving.value, false);
  assert.equal(calls.filter(call => call[0] === 'success').length, 1);
});

test('failed detection-range save keeps the editor open and reloads the current revision', async () => {
  let reloads = 0;
  const { context, calls } = createContext({
    api: { put: async () => { throw new Error('revision conflict'); } },
    loadData: async () => { reloads += 1; return true; },
  });

  await context.onAiSaved(payload);

  assert.equal(reloads, 1);
  assert.equal(context.editorVisible.value, true);
  assert.equal(context.aiSaving.value, false);
  assert.match(calls.find(call => call[0] === 'error')[1], /编辑内容已保留/);
});

test('a successful write with an unverified readback remains open and warns the operator', async () => {
  const { context, calls } = createContext({
    loadData: async () => {
      context.channels.value = [{ id: 'gate', ...payload, roiPolygon: [] }];
      return true;
    },
  });

  await context.onAiSaved(payload);

  assert.equal(context.editorVisible.value, true);
  assert.equal(context.aiSaving.value, false);
  assert.match(calls.find(call => call[0] === 'warning')[1], /已写入.*回读复核未完成/);
});

test('the region editor never dismisses itself before its parent confirms persistence', () => {
  const editorScript = editorSource.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
  const editorAst = ts.createSourceFile('ai-region-editor.ts', editorScript, ts.ScriptTarget.Latest, true);
  const save = editorAst.statements.find(
    node => ts.isFunctionDeclaration(node) && node.name?.text === 'save',
  );
  assert.ok(save);
  const body = save.getText(editorAst);
  assert.match(body, /emit\('save'/);
  assert.doesNotMatch(body, /emit\('update:modelValue'/);
  assert.match(body, /props\.saving/);
  assert.match(editorSource, /:loading="saving"/);
});

test('every persistent video-binding write carries the opened configuration revision', () => {
  const persistentWrites = {
    saveNvr: /withExpectedRevision/,
    deleteNvr: /revisionParams/,
    saveChannel: /withExpectedRevision/,
    deleteChannel: /revisionParams/,
    saveLayout: /withExpectedRevision/,
    saveAiBox: /withExpectedRevision/,
    onAiSaved: /withExpectedRevision/,
  };
  for (const [name, pattern] of Object.entries(persistentWrites)) {
    const fn = adminAst.statements.find(
      node => ts.isFunctionDeclaration(node) && node.name?.text === name,
    );
    assert.ok(fn, `${name} must exist`);
    assert.match(fn.getText(adminAst), pattern, `${name} must submit expectedRevision`);
  }
  assert.match(adminSource, /error\?\.status === 409/);
  assert.match(adminSource, /当前表单已保留/);
});
