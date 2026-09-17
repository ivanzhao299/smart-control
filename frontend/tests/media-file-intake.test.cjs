const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load() {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/features/media-file-intake.ts'),
    'utf8',
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(output, { module, exports: module.exports, require });
  return module.exports;
}

test('file picker policy and drag/drop validation share every fallback extension', () => {
  const policy = load();
  for (const name of ['clip.M4V', 'audio.APE', 'deck.PPTX', 'report.pdf']) {
    assert.equal(policy.isAllowedMediaFile({ name, type: '' }), true, name);
    assert.match(policy.MEDIA_UPLOAD_ACCEPT.toLowerCase(), new RegExp(`\\${name.slice(name.lastIndexOf('.')).toLowerCase()}(?:,|$)`));
  }
  assert.equal(policy.isAllowedMediaFile({ name: 'notes.txt', type: 'text/plain' }), false);
  assert.equal(policy.isAllowedMediaFile({ name: 'camera.bin', type: 'image/jpeg' }), true);
});

test('media entry points consume the shared policy instead of defining local copies', () => {
  const page = fs.readFileSync(path.resolve(__dirname, '../src/pages/MediaPage.vue'), 'utf8');
  const service = fs.readFileSync(path.resolve(__dirname, '../src/services/media.service.ts'), 'utf8');
  assert.match(page, /from '@\/features\/media-file-intake'/);
  assert.doesNotMatch(page, /const (?:AUDIO|VIDEO|DOC)_EXTS/);
  assert.match(service, /export \{ MEDIA_UPLOAD_ACCEPT \} from '\.\.\/features\/media-file-intake'/);
  assert.doesNotMatch(service, /export const MEDIA_UPLOAD_ACCEPT/);
});

test('media formatting preserves the existing UI contract', () => {
  const policy = load();
  assert.equal(policy.formatMediaSize(512), '512 B');
  assert.equal(policy.formatMediaSize(1536), '1.5 KB');
  assert.equal(policy.formatMediaSize(2 * 1024 ** 2), '2.0 MB');
  assert.equal(policy.formatMediaDuration(null), '');
  assert.equal(policy.formatMediaDuration(65), '1:05');
});

test('directory traversal consumes every reader batch and recursively collects files', async () => {
  const policy = load();
  const first = { name: 'first.mp4', type: 'video/mp4' };
  const second = { name: 'second.pdf', type: 'application/pdf' };
  const fileEntry = file => ({ isFile: true, isDirectory: false, file: ok => ok(file) });
  const batches = [[fileEntry(first)], [fileEntry(second)], []];
  const directory = {
    isFile: false,
    isDirectory: true,
    createReader: () => ({ readEntries: ok => ok(batches.shift()) }),
  };

  const files = await policy.collectFilesFromEntry(directory);
  assert.equal(Array.from(files, file => file.name).join(','), 'first.mp4,second.pdf');
  assert.equal(batches.length, 0);
});
