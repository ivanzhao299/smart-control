// Publish only a static, unapproved comparison on the loopback workbench.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
const [renderDirectory, reference, fitFile] = process.argv.slice(2);
if (!renderDirectory || !reference || !fitFile) throw Error('Usage: node package-reference-review.mjs RENDER_DIR REFERENCE.jpg FIT.json');
const evidence = JSON.parse(await fs.readFile(path.join(renderDirectory, 'evidence.json')));
const fit = JSON.parse(await fs.readFile(fitFile));
if (evidence.productionEligible !== false || !evidence.cleanup.sourceUntouched) throw Error('Unapproved review and source preservation must be explicit');
const ref = await fs.readFile(reference);
await fs.writeFile(path.join(renderDirectory, 'reference.jpg'), ref, {flag:'wx'});
const review = {
  version:1, status:'reference-matching-incomplete', productionEligible:false,
  imageSize:[1280,884], referenceSha256:crypto.createHash('sha256').update(ref).digest('hex'),
  landmarkCount:fit.landmarks.length, rmsPixels:fit.rmsPixels,
  camera:fit.parameters, cameraFit:'approximate-manual-roof-points',
  removedObjects:evidence.cleanup.removedObjects.length,
  clippedObjects:evidence.cleanup.clippedObjects.length,
  blockers:['vegetation-missing','water-surface-not-visible','ground-and-road-materials-incomplete','building-details-unverified'],
  nextCameraRotationAllowed:false,
};
await fs.writeFile(path.join(renderDirectory, 'review.json'), JSON.stringify(review,null,2),{flag:'wx'});
console.log(JSON.stringify(review,null,2));
