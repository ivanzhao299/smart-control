import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root=new URL('../../frontend/public/park-ops/twin-view/assets/',import.meta.url);
test('Low-power camera pack is complete, bounded and hash verified',async()=>{
 const m=JSON.parse(await readFile(new URL('display-manifest.json',root)));
 assert.equal(m.productionEligible,false);assert.equal(m.continuousWebGL,false);
 assert.deepEqual(m.views.map(v=>v.id),['reference','opposite','left','right','top']);
 assert.equal(m.views.find(v=>v.id==='opposite').azimuthDeltaDegrees,180);
 assert.notDeepEqual(m.views[0].camera,m.views[1].camera);
 assert.equal(m.landscapeSummary.sourceGeometryUnchanged,true);
 assert.deepEqual(m.dimensions,[3000,2400]);assert.deepEqual(m.clayDimensions,m.dimensions);
 assert.equal(m.geometryUnchanged,true);
 for(const view of m.views){
  const b=view.subjectBounds;assert.equal(b.length,4);
  assert.ok(b.every(x=>Number.isFinite(x)&&x>=0&&x<=1));
  assert.ok(b[2]>b[0]&&b[3]>b[1]);
  assert.ok(Math.abs((b[0]+b[2])/2-.5)<.001&&Math.abs((b[1]+b[3])/2-.5)<.001);
 }
 const files=m.views.flatMap(v=>[v.images.day,v.images.night,v.clayImage]);
 assert.equal(new Set(files).size,15);let total=0;
 for(const file of files){
  assert.match(file,/^[-a-z0-9]+\.webp$/);
  const data=await readFile(new URL(file,root));
  assert.equal(data.toString('ascii',0,4),'RIFF');assert.equal(data.toString('ascii',8,12),'WEBP');
  assert.equal(data.length,m.bytesByImage[file]);assert.ok(data.length<1_000_000);
  assert.equal(createHash('sha256').update(data).digest('hex'),m.imageHashes[file]);total+=data.length;
 }
 assert.equal(total,m.totalImageBytes);assert.ok(total<10_000_000);
});
