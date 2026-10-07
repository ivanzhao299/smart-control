import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { join, meshopt, dedup } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import { inspect } from './inspect-glb.mjs';

const dir=path.resolve(process.argv[2]);
const manifest=JSON.parse(await fs.readFile(path.join(dir,'twin-manifest.json'),'utf8'));
await Promise.all([MeshoptEncoder.ready,MeshoptDecoder.ready]);
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.encoder':MeshoptEncoder,'meshopt.decoder':MeshoptDecoder});
const doc=await io.read(path.join(dir,'scene-source.glb'));
for(const mesh of doc.getRoot().listMeshes()) for(const prim of mesh.listPrimitives()) {
  if(!prim.getAttribute('_ENTITY_ID')) throw Error('Blender did not export the source component attribute');
}
await doc.transform(dedup(),join({keepNamed:false,keepMeshes:false}));
const scene=doc.getRoot().listScenes()[0], children=[...scene.listChildren()];
const root=doc.createNode('Jinhu real source components').setExtras({sourceEntities:manifest.entities,materialMode:manifest.materialMode});
for(const n of children){scene.removeChild(n);root.addChild(n);}
scene.addChild(root);
let index=0;
for(const n of doc.getRoot().listNodes()) if(n.getMesh()) n.setExtras({twinId:`jinhu-material-batch-${index++}`,isGeometryBatch:true});
await doc.transform(meshopt({encoder:MeshoptEncoder,level:'high'}));
await io.write(path.join(dir,'scene.glb'),doc);
const result=await inspect(path.join(dir,'scene.glb'));
await fs.writeFile(path.join(dir,'validation.json'),JSON.stringify(result,null,2));
console.log(result);
if(!result.readyForVisualReview)process.exitCode=2;
