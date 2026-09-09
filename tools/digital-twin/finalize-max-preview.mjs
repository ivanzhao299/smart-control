// Add a clearly heuristic camera focus without clipping, moving or deleting geometry.
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
const dir = path.resolve(process.argv[2]);
const manifestFile = path.join(dir, 'twin-manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
const stats = JSON.parse(await fs.readFile(path.join(dir, 'simplification.json'), 'utf8'));
const dense = new Set(stats.objects.filter(o => o.before >= 10000).map(o => o.id));
await MeshoptDecoder.ready;
const doc = await new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder }).read(path.join(dir, 'scene.glb'));
const samples = [[], [], []], p = [];
for (const node of doc.getRoot().listNodes()) {
  if (!node.getMesh() || !node.getExtras().sourceEntities) continue;
  const source = node.getExtras().sourceEntities, m = node.getWorldMatrix();
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), ids = prim.getAttribute('_ENTITY_ID');
    for (let i = 0; i < pos.getCount(); i++) {
      if (!dense.has(source[ids.getScalar(i)].id)) continue;
      pos.getElement(i, p);
      for (let k = 0; k < 3; k++) samples[k].push(m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12]);
    }
  }
}
if (samples[0].length) {
  const bounds = samples.map(values => {
    values.sort((a, b) => a - b);
    return [values[Math.floor(values.length * .02)], values[Math.floor(values.length * .98)]];
  });
  manifest.reviewFocus = { method: 'dense-component-2-to-98-percentile-heuristic',
    min: bounds.map(b => b[0]), max: bounds.map(b => b[1]), verifiedGeographicBoundary: false };
}
await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2));
console.log('REVIEW_FOCUS', manifest.reviewFocus);
