import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

const base = process.env.TWIN_URL ?? 'http://127.0.0.1:5199';
const output = process.env.TWIN_EVIDENCE;
if (!output) throw Error('Set TWIN_EVIDENCE to a local output directory');
await fs.mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto(base);
  await page.waitForFunction(() => document.querySelector('#intake').textContent.includes('25 / 25'));
  await page.screenshot({ path: path.join(output, 'workbench.png') });
  await page.click('#fixture');
  await page.waitForFunction(() => document.querySelector('#badge').textContent.includes('非真实园区'));
  await page.screenshot({ path: path.join(output, 'camera-front.png') });
  const before = await page.evaluate(() => ({ camera: TWIN_DEBUG.camera(), transforms: TWIN_DEBUG.transforms() }));
  await page.click('#opposite');
  const after = await page.evaluate(() => ({ camera: TWIN_DEBUG.camera(), transforms: TWIN_DEBUG.transforms() }));
  assert.notDeepEqual(before.camera, after.camera);
  assert.deepEqual(before.transforms, after.transforms, 'Camera preset must not transform model');
  await page.screenshot({ path: path.join(output, 'camera-opposite.png') });
  await page.locator('#label').fill('科创 A01');
  await page.locator('#label').press('Space');
  assert.equal(await page.locator('#label').inputValue(), '科创 A01 ');
  assert.deepEqual(after.camera, await page.evaluate(() => TWIN_DEBUG.camera()));
  const downloadPromise = page.waitForEvent('download');
  await page.click('#save');
  const download = await downloadPromise;
  await download.saveAs(path.join(output, 'edited-manifest.json'));
  const edited = JSON.parse(await fs.readFile(path.join(output, 'edited-manifest.json'), 'utf8'));
  assert.equal(edited.entities[0].label, '科创 A01 ');
  await page.locator('#label').fill('临时改名');
  await page.locator('#mappingFile').setInputFiles(path.join(output, 'edited-manifest.json'));
  await page.waitForFunction(() => document.querySelector('#label').value === '科创 A01 ');
  await page.waitForTimeout(300);
  const rendersBefore = await page.evaluate(() => TWIN_DEBUG.renders);
  await page.waitForTimeout(2000);
  const rendersAfter = await page.evaluate(() => TWIN_DEBUG.renders);
  assert.equal(rendersBefore, rendersAfter, 'Idle page must not continuously render');
  const sourceProbe = await page.request.get(base + '/source/scene.max'); assert.equal(sourceProbe.status(), 404);
  if (process.env.TWIN_TEST_GLB) {
    await page.locator('#file').setInputFiles(process.env.TWIN_TEST_GLB);
    await page.waitForFunction(() => document.querySelector('#badge').textContent.includes('模型待验收'));
    assert.equal(await page.locator('#entity option').count(), 4, 'Multi-material primitives must share the original building entity');
    await page.selectOption('#entity', 'fixture-B');
    assert.equal(await page.locator('#twinId').inputValue(), 'fixture-B');
    await page.screenshot({ path: path.join(output, 'multimaterial-textured-model.png') });
  }
  assert.deepEqual(errors, []);
  const result = { passed: true, fixture: true, realParkVerified: false, idleSeconds: 2, additionalIdleFrames: rendersAfter - rendersBefore, cameraMoved: true, modelTransformsUnchanged: true, textSpacePreserved: true, sourceFileNotExposed: true, mappingRoundtrip: true, multimaterialTest: Boolean(process.env.TWIN_TEST_GLB), browserErrors: errors };
  await fs.writeFile(path.join(output, 'browser-results.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
