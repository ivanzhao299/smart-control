// Execute the actual component action bodies with isolated side-effect adapters.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const vue = fs.readFileSync(path.join(__dirname, '../src/components/PlayerConsole.vue'), 'utf8');
const script = vue.match(/<script setup lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('console.ts', script, ts.ScriptTarget.Latest, true);
const names = ['selectContent', 'selectWelcome', 'selectParkDashboard'];
const bodies = ast.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => node.getText(ast));
assert.equal(bodies.length, names.length);
const js = ts.transpileModule(bodies.join('\n'), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

for (const action of names) {
  test(`${action} does not publish after identity/scope changes during display switching`, async () => {
    let active = true, finishSwitch;
    const calls = [];
    const context = vm.createContext({
      captureConsoleAction: () => () => active,
      busy: { value: false }, SLOT: { value: 1 }, activeSource: { value: 'welcome-default' }, playlist: { value: [{}] },
      props: { title: 'LED 大屏' },
      ensureDisplayPath: () => new Promise(resolve => { finishSwitch = resolve; }),
      playbackStore: { next: async () => calls.push('next') },
      publishWelcome: async () => calls.push('welcome'),
      publishParkDashboard: async () => calls.push('park-dashboard'),
      ElMessage: { success: () => calls.push('success'), error: () => calls.push('error'), info: () => calls.push('info') },
    });
    vm.runInContext(js, context);
    const pending = context[action]('default');
    active = false; finishSwitch(); await pending;
    assert.deepEqual(calls, []);
    assert.equal(context.busy.value, false);
    active = true;
    const next = context[action]('default');
    finishSwitch(); await next;
    const expected = action === 'selectContent' ? 'next' : action === 'selectWelcome' ? 'welcome' : 'park-dashboard';
    assert.deepEqual(calls, [expected, 'success']);
  });
}

test('park dashboard is rendered as a direct input-source card', () => {
  assert.match(vue, /@click="selectParkDashboard"/);
  assert.match(vue, /> 园区运营大屏<\/button>/);
  assert.match(vue, /activeSource === 'park-dashboard'/);
});
