const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/services/playback.service.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

class HttpError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

function subject({ directResult, directError, assets = [], changeBeforeDirectError = false }) {
  const calls = [];
  let generation = 9;
  const api = {
    get: async () => ({}),
    put: async () => ({}),
    del: async () => ({}),
    post: async (url, body) => {
      calls.push({ kind: 'post', url, body });
      if (url.endsWith('/park-dashboard')) {
        if (directError) {
          if (changeBeforeDirectError) generation += 1;
          throw directError;
        }
        return directResult;
      }
      return { slot: 2, currentMediaId: body.mediaId };
    },
  };
  const mediaService = {
    list: async (options) => {
      calls.push({ kind: 'list', options });
      return { items: assets, total: assets.length };
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled, {
    module,
    exports: module.exports,
    require(id) {
      if (id === './http') return { api, HttpError };
      if (id === './media.service') return { mediaService };
      if (id === './identity-boundary') return {
        identityGeneration: () => generation,
        assertCurrentIdentity: (expected) => {
          if (expected !== generation) throw new Error('identity changed');
        },
      };
      throw new Error(`unexpected import: ${id}`);
    },
  });
  return { service: module.exports, calls, changeIdentity: () => { generation += 1; } };
}

test('uses the dedicated park-dashboard endpoint when the backend supports it', async () => {
  const directResult = { slot: 2, currentMediaId: 81 };
  const { service, calls } = subject({ directResult });

  assert.deepEqual(await service.publishParkDashboard(2), directResult);
  assert.deepEqual(calls, [{ kind: 'post', url: '/playback/channels/2/park-dashboard', body: null }]);
});

test('falls back to stable-name lookup and the existing publish endpoint on an old backend', async () => {
  const name = '金湖科创产业园·智慧运营总览(DEMO)';
  const { service, calls } = subject({
    directError: new HttpError('not found', 404),
    assets: [{ id: 81, originalName: name }],
  });

  assert.deepEqual(await service.publishParkDashboard(2), { slot: 2, currentMediaId: 81 });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [
    { kind: 'post', url: '/playback/channels/2/park-dashboard', body: null },
    { kind: 'list', options: { kind: 'webpage', scope: 'shared', keyword: name, limit: 100 } },
    { kind: 'post', url: '/playback/channels/2/publish', body: { mediaId: 81, loopMode: 'loop' } },
  ]);
});

test('does not continue fallback publishing after an identity change', async () => {
  const ctx = subject({ directError: new HttpError('not found', 404), changeBeforeDirectError: true });
  await assert.rejects(ctx.service.publishParkDashboard(2), /identity changed/);
  assert.equal(ctx.calls.length, 1);
});
