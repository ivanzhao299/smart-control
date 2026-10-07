import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(process.argv[2]);
const nodes = doc.getRoot().listNodes().filter(n => n.getMesh());
const shared = doc.getRoot().listNodes().find(n => !n.getMesh() && n.getExtras().sourceEntities)?.getExtras().sourceEntities;
let triangles = 0; const found = new Set();
for (const node of nodes) {
  const localFound = new Set();
  const entities = node.getExtras().sourceEntities ?? shared;
  assert.ok(Array.isArray(entities));
  assert.equal(new Set(entities.map(e => e.id)).size, entities.length);
  for (const primitive of node.getMesh().listPrimitives()) {
    const attr = primitive.getAttribute('_ENTITY_ID'); assert.ok(attr, 'Custom entity IDs lost');
    const pos = primitive.getAttribute('POSITION'), normal = primitive.getAttribute('NORMAL');
    const indexes = primitive.getIndices()?.getArray();
    const count = indexes?.length ?? pos.getCount();
    assert.equal(attr.getCount(), pos.getCount()); assert.equal(normal.getCount(), pos.getCount());
    for (const value of pos.getArray()) assert.ok(Number.isFinite(value));
    for (let i = 0; i < count; i += 3) {
      const ids = [0, 1, 2].map(k => attr.getScalar(indexes ? indexes[i + k] : i + k));
      assert.ok(Number.isInteger(ids[0]) && entities[ids[0]]);
      assert.equal(ids[0], ids[1]); assert.equal(ids[0], ids[2]);
      found.add(entities[ids[0]].id); localFound.add(entities[ids[0]].id); triangles++;
    }
  }
  if (!shared) assert.equal(localFound.size, entities.length, 'An original component lost all geometry');
}
if (shared) assert.equal(found.size, shared.length, 'An original component lost all geometry');
assert.ok(triangles <= 300000);
const result = { pass: true, triangles, selectableSourceComponents: found.size, meshoptDecoded: true, perTriangleIdsConsistent: true };
if (process.argv[3]) await fs.writeFile(process.argv[3], JSON.stringify(result, null, 2));
console.log(result);
