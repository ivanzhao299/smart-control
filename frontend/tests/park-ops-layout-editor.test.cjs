const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = { JSON, Number, Error };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/park-ops/park-ops-editor-state.js'), 'utf8'), context);
const createState = context.createParkOpsEditorState;
const config = source => ({ version: 1, fitMode: 'stretch', phases: [{ id: '1' }], buildings: [], source });

function fixture() {
  let draft = config('defaults'), actor = 'admin-one';
  const messages = [], writes = [];
  const options = {
    identity: () => actor, draft: () => draft,
    apply: value => { draft = value || config('defaults'); },
    status: (...args) => messages.push(args),
    read: async () => ({ config: config('published'), revision: 3 }),
    write: async (config, expectedRevision) => {
      writes.push({ config, expectedRevision }); return { config, revision: expectedRevision + 1 };
    },
  };
  const state = createState(options);
  return { state, options, messages, writes, draft: () => draft,
    edit: source => { draft.source = source; }, switchActor: () => { actor = 'admin-two'; } };
}

test('layout saves a frozen versioned draft once and preserves continued editing', async () => {
  const f = fixture(); await f.state.load(); f.edit('submitted'); let finish;
  f.options.write = (config, expectedRevision) => {
    f.writes.push({ config, expectedRevision }); return new Promise(resolve => { finish = resolve; });
  };
  const saving = f.state.save(); f.edit('new typing'); await f.state.save(); await f.state.load();
  assert.deepEqual(f.writes, [{ config: config('submitted'), expectedRevision: 3 }]);
  finish({ config: config('submitted'), revision: 4 }); await saving;
  assert.equal(f.draft().source, 'new typing'); assert.equal(f.state.state.revision, 4);
  assert.match(f.messages.at(-1)[0], /未保存草稿/);
});

test('failed or malformed reads cannot enable saving initial defaults or discard existing drafts', async () => {
  for (const read of [async () => { throw new Error('offline'); },
    async () => ({ config: null, revision: '0' }), async () => ({ config: null, revision: 2 }),
    async () => ({ config: {}, revision: Number.MAX_SAFE_INTEGER + 1 }),
    async () => ({ config: {}, revision: 3 })]) {
    const f = fixture(); f.options.read = read; f.edit('local draft');
    await f.state.load(); await f.state.save();
    assert.equal(f.state.state.revision, null); assert.equal(f.writes.length, 0);
    assert.equal(f.draft().source, 'local draft');
  }
});

test('only an explicit valid empty snapshot enables first-save with revision zero', async () => {
  const f = fixture(); f.options.read = async () => ({ config: null, revision: 0 });
  await f.state.load(); await f.state.save();
  assert.deepEqual(f.writes, [{ config: config('defaults'), expectedRevision: 0 }]);
});

test('conflict and ambiguous transport failures keep drafts and block stale retries until reload', async () => {
  for (const status of [409, 503, 401, 403]) {
    const f = fixture(); await f.state.load(); f.edit('my draft'); let count = 0;
    f.options.write = async () => { count++; throw Object.assign(new Error(String(status)), { status }); };
    await f.state.save(); await f.state.save();
    assert.equal(count, 1); assert.equal(f.draft().source, 'my draft');
    assert.equal(f.state.state.needsReload, true);
    await f.state.load(); assert.equal(f.state.state.needsReload, false);
    assert.equal(f.draft().source, 'published');
  }
});

test('late reads and saves from changed accounts or disposed pages cannot apply or report success', async () => {
  for (const operation of ['read', 'write']) {
    for (const invalidate of [f => f.switchActor(), f => f.state.dispose()]) {
      const f = fixture(); await f.state.load(); f.edit('keep'); let finish;
      f.options[operation] = () => new Promise(resolve => { finish = resolve; });
      const pending = operation === 'read' ? f.state.load() : f.state.save();
      invalidate(f); finish({ config: config('late'), revision: 4 }); await pending;
      assert.equal(f.draft().source, 'keep'); assert.equal(f.state.state.revision, null);
      assert.equal(f.messages.some(([msg]) => msg.includes('保存成功')), false);
    }
  }
});

test('changing identity before submit and typing during a read require explicit reload', async () => {
  const f = fixture(); await f.state.load(); f.switchActor(); await f.state.save();
  assert.equal(f.writes.length, 0); let finish;
  f.options.read = () => new Promise(resolve => { finish = resolve; });
  const pending = f.state.load(); f.edit('new draft');
  finish({ config: config('remote'), revision: 4 }); await pending;
  assert.equal(f.draft().source, 'new draft'); assert.equal(f.state.state.needsReload, true);
});

test('malformed save responses fail closed instead of reporting success', async () => {
  const f = fixture(); await f.state.load(); f.edit('keep');
  f.options.write = async () => ({ config: {}, revision: 1 }); await f.state.save();
  assert.equal(f.draft().source, 'keep'); assert.equal(f.state.state.needsReload, true);
  assert.equal(f.messages.some(([msg]) => msg.includes('保存成功')), false);
});

test('static page loads the state helper before the editor and asks before replacing drafts', () => {
  const root = path.join(__dirname, '../public/park-ops');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const js = fs.readFileSync(path.join(root, 'park-ops-editor.js'), 'utf8');
  assert.ok(html.indexOf('<script src="./park-ops-editor-state.js') < html.indexOf('<script src="./park-ops-editor.js'));
  assert.match(js, /confirm\('重新读取会替换/);
  assert.match(js, /system-branding\/park-ops\/editor/);
  assert.doesNotMatch(js, /remoteRevision = 0/);
});
