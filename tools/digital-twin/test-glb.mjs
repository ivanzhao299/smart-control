import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metrics, readGLB } from './inspect-glb.mjs';
import { imageSize, textureBudget } from './web/texture-budget.js';

const sample = () => ({ nodes: [{ mesh: 0, extras: { twinId: 'A01' } }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ count: 36 }] });
test('counts primitives per mesh instance, not unique geometry', () => {
  const json = sample(); json.nodes.push({ mesh: 0, extras: { twinId: 'A02' } });
  assert.equal(metrics(json, 100).triangles, 24); assert.equal(metrics(json, 100).drawCalls, 2);
});
test('missing/duplicate entity IDs fail delivery gate', () => {
  const json = sample(); json.nodes.push(json.nodes[0]); assert.equal(metrics(json, 100).budgetPass, false);
  delete json.nodes[0].extras; assert.equal(metrics(json, 100).budgetPass, false);
});
test('external images fail offline delivery gate', () => {
  const json = sample(); json.images = [{ uri: 'https://example.org/map.jpg' }];
  assert.equal(metrics(json, 100).budgetPass, false);
});
test('large files/geometry fail performance budget', () => {
  assert.equal(metrics(sample(), 21 * 1048576).budgetPass, false);
  const json = sample(); json.accessors[0].count = 900003;
  assert.equal(metrics(json, 100).budgetPass, false);
});
test('reject corrupt GLB and empty scene', () => {
  assert.throws(() => readGLB(Buffer.alloc(20)));
  assert.equal(metrics({}, 20).budgetPass, false);
});
test('read large PNG dimensions without decoding pixels', () => {
  const png = Buffer.alloc(24); png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(11280, 16); png.writeUInt32BE(11280, 20);
  assert.deepEqual(imageSize(png), [11280, 11280]);
  assert.throws(() => imageSize(Buffer.alloc(4)));
});
test('reject images outside binary ranges or external data URI', () => {
  assert.throws(() => textureBudget(new ArrayBuffer(12), { images: [{ uri: 'data:image/png;base64,AAA' }] }));
});
