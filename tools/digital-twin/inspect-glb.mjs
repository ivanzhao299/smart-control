import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import validator from 'gltf-validator';
import { textureBudget } from './web/texture-budget.js';

export function readGLB(buffer) {
  if (buffer.length < 20 || buffer.toString('ascii', 0, 4) !== 'glTF' || buffer.readUInt32LE(4) !== 2 || buffer.readUInt32LE(8) !== buffer.length) throw Error('Invalid GLB header or size');
  const size = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== 0x4e4f534a || 20 + size > buffer.length) throw Error('GLB JSON chunk missing');
  return JSON.parse(buffer.toString('utf8', 20, 20 + size));
}

export function metrics(json, bytes) {
  let triangles = 0, drawCalls = 0;
  const failures = [], ids = new Set();
  for (const node of json.nodes ?? []) {
    if (node.mesh === undefined) continue;
    const id = node.extras?.twinId;
    if (!id || ids.has(id)) failures.push('Mesh node is missing a unique twinId');
    ids.add(id);
    for (const p of json.meshes[node.mesh].primitives) {
      drawCalls++;
      if ((p.mode ?? 4) !== 4) { failures.push('Non-triangle primitive requires review'); continue; }
      triangles += (json.accessors[p.indices ?? p.attributes.POSITION]?.count ?? 0) / 3;
    }
  }
  const external = [...(json.buffers ?? []), ...(json.images ?? [])].filter(v => v.uri && !v.uri.startsWith('data:'));
  if (external.length) failures.push('GLB must be self-contained');
  if (!drawCalls) failures.push('No mesh nodes');
  if (bytes > 20 * 1024 ** 2) failures.push('GLB exceeds initial 20 MiB delivery budget');
  if (triangles > 300_000) failures.push('More than 300,000 rendered triangles');
  if (drawCalls > 200) failures.push('More than 200 primitive instances/draw calls');
  return { bytes, triangles, drawCalls, meshNodes: ids.size, failures, budgetPass: !failures.length };
}

export async function inspect(file) {
  const data = await fs.readFile(file);
  const json = readGLB(data);
  const validation = await validator.validateBytes(new Uint8Array(data), { uri: 'scene.glb', maxIssues: 30 });
  const result = metrics(json, data.length);
  try { result.textures = textureBudget(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength), json); }
  catch (error) { result.failures.push(error.message); result.budgetPass = false; }
  result.validation = { errors: validation.issues.numErrors, warnings: validation.issues.numWarnings, messages: validation.issues.messages };
  // These checks measure geometry delivery, not material fidelity or sustained hardware load.
  result.readyForVisualReview = result.budgetPass && validation.issues.numErrors === 0;
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await inspect(process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  if (!result.readyForVisualReview) process.exitCode = 2;
}
