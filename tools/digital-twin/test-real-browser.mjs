import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = process.env.TWIN_URL ?? 'http://127.0.0.1:5199';
const out = process.env.TWIN_EVIDENCE;
if (!out) throw Error('TWIN_EVIDENCE required');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1800, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [], external = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', req => { if (/^https?:/.test(req.url()) && !req.url().startsWith(base + '/')) external.push(req.url()); });
  await page.goto(base);
  await page.click('#real');
  await page.waitForFunction(() => document.querySelector('#badge').textContent.includes('简化白模'), { timeout: 60000 });
  const metrics = await page.locator('#metrics').textContent();
  assert.match(metrics, /1522 对象/);
  const before = await page.evaluate(() => ({ camera: TWIN_DEBUG.camera(), transforms: TWIN_DEBUG.transforms() }));
  await page.screenshot({ path: path.join(out, 'real-front.png') });
  await page.click('#opposite');
  const after = await page.evaluate(() => ({ camera: TWIN_DEBUG.camera(), transforms: TWIN_DEBUG.transforms() }));
  assert.notDeepEqual(before.camera, after.camera);
  assert.deepEqual(before.transforms, after.transforms);
  await page.screenshot({ path: path.join(out, 'real-opposite.png') });
  // Real pointer picking after Meshopt decode, not merely dropdown selection.
  const rect = await page.locator('#viewport canvas').boundingBox();
  const firstId = await page.locator('#twinId').inputValue();
  let picked;
  for (let y = .3; y < .8 && !picked; y += .045) {
    for (let x = .3; x < .8 && !picked; x += .045) {
      await page.mouse.click(rect.x + rect.width * x, rect.y + rect.height * y);
      const id = await page.locator('#twinId').inputValue();
      if (id !== firstId) picked = id;
    }
  }
  assert.ok(picked?.startsWith('jinhu-max-'), 'Batched geometry must retain pointer selection');
  await page.locator('#label').fill('真实构件 A01'); await page.locator('#label').press('Space');
  assert.equal(await page.locator('#label').inputValue(), '真实构件 A01 ');
  assert.deepEqual(after.camera, await page.evaluate(() => TWIN_DEBUG.camera()));
  const downloadPromise = page.waitForEvent('download'); await page.click('#save');
  await (await downloadPromise).saveAs(path.join(out, 'real-edited-manifest.json'));
  await page.locator('#label').fill('临时');
  await page.locator('#mappingFile').setInputFiles(path.join(out, 'real-edited-manifest.json'));
  await page.waitForFunction(() => document.querySelector('#label').value === '真实构件 A01 ');
  assert.equal(await page.locator('#label').inputValue(), '真实构件 A01 ');
  await page.waitForTimeout(400);
  const idleBefore = await page.evaluate(() => TWIN_DEBUG.renders);
  await page.waitForTimeout(2000);
  const idleAfter = await page.evaluate(() => TWIN_DEBUG.renders);
  assert.equal(idleBefore, idleAfter);
  const probe = await page.request.get(base + '/source/scene.max'); assert.equal(probe.status(), 404);
  assert.deepEqual(errors, []); assert.deepEqual(external, []);
  await fs.writeFile(path.join(out, 'real-browser-result.json'), JSON.stringify({ metrics, picked,
    cameraBefore: before.camera, cameraOpposite: after.camera, geometryUnchanged: true,
    idleFramesIn2Seconds: idleAfter - idleBefore, sourceNotExposed: true, externalRequests: external, errors }, null, 2));
  console.log('REAL_BROWSER_PASS', metrics, picked);
} finally { await browser.close(); }
