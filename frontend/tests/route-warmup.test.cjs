const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const read = file => fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(read('features/route-warmup.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: exportsObject });
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture(loader) {
  const jobs = new Map();
  const loaded = [];
  let id = 0;
  const schedule = (run, delay) => { const key = ++id; jobs.set(key, { run, delay }); return () => jobs.delete(key); };
  const warmup = exportsObject.createRouteWarmup({ names: ['lighting', 'media'],
    load: name => { loaded.push(name); return loader ? loader(name) : Promise.resolve(); },
    defer: schedule, idle: run => schedule(run, 'idle'),
  });
  return { warmup, loaded, jobs, tick: async () => {
    const next = jobs.entries().next().value;
    if (next) { jobs.delete(next[0]); next[1].run(); }
    await flush();
  } };
}

test('warmup starts once after 800ms and loads pages serially during idle slots', async () => {
  const f = fixture();
  f.warmup.start(); f.warmup.start();
  assert.equal(f.jobs.size, 1);
  assert.equal([...f.jobs.values()][0].delay, 800);
  await f.tick();
  assert.deepEqual(f.loaded, ['lighting']);
  assert.equal([...f.jobs.values()][0].delay, 'idle');
  await f.tick();
  assert.deepEqual(f.loaded, ['lighting', 'media']);
  assert.equal(f.jobs.size, 0);
});

test('pointer and idle warmup deduplicate both in-flight and completed imports', async () => {
  let resolve;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  f.warmup.start();
  const pointer = f.warmup.warm('lighting');
  await f.tick();
  assert.deepEqual(f.loaded, ['lighting']);
  resolve(); await pointer; await flush();
  await f.warmup.warm('lighting');
  assert.deepEqual(f.loaded, ['lighting']);
  f.warmup.stop();
});

test('failed imports are retryable and do not stop the idle queue', async () => {
  const f = fixture(() => Promise.reject(new Error('offline')));
  f.warmup.start();
  await f.tick(); await f.tick();
  await f.warmup.warm('lighting');
  assert.deepEqual(f.loaded, ['lighting', 'media', 'lighting']);
});

test('unmount cancels scheduled work and a late import cannot restart an idle queue', async () => {
  const unopened = fixture(); unopened.warmup.start(); unopened.warmup.stop();
  assert.equal(unopened.jobs.size, 0);
  await unopened.warmup.warm('lighting');
  assert.deepEqual(unopened.loaded, []);
  let resolve;
  const f = fixture(() => new Promise(done => { resolve = done; }));
  f.warmup.start(); await f.tick(); f.warmup.stop(); resolve(); await flush();
  assert.equal(f.jobs.size, 0);
  assert.deepEqual(f.loaded, ['lighting']);
});

test('stop and restart do not allow old queued microtasks to start downloads', async () => {
  const f = fixture(); f.warmup.start();
  const pending = f.warmup.warm('media');
  f.warmup.stop(); f.warmup.start(); await pending;
  assert.deepEqual(f.loaded, []);
  await f.tick(); await f.tick();
  assert.deepEqual(f.loaded, ['lighting', 'media']);
});

test('main layout has no unauthenticated API prefetch and cleans up warmup and recovery timers', () => {
  const layout = read('layouts/MainLayout.vue');
  const manifest = read('router/main-route-manifest.ts');
  assert.doesNotMatch(layout, /prefetchData|fetch\(url\)|mainRoutePrefetchApis/);
  assert.doesNotMatch(manifest, /prefetchApis|\/control\/api\//);
  assert.match(layout, /warmup\.start\(\)/);
  assert.match(layout, /warmup\.stop\(\)/);
  assert.match(layout, /clearTimeout\(offlineRecheckT\)/);
  assert.match(layout, /clearTimeout\(reconnT\)/);
  assert.match(read('services/media.service.ts'), /from '\.\/media-transport'/);
  assert.doesNotMatch(read('services/media.service.ts'), /axios\.request/);
});
