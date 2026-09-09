import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const base=process.env.TWIN_URL ?? 'http://127.0.0.1:5199';
const out=process.env.TWIN_EVIDENCE;
if(!out) throw Error('TWIN_EVIDENCE required');
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
 const page=await browser.newPage({viewport:{width:1600,height:1100},deviceScaleFactor:1});
 const errors=[],requests=[];
 page.on('pageerror', e=>errors.push(e.message));
 page.on('request', r=>requests.push(r.url()));
 await page.goto(base+'/compare.html');
 await page.waitForFunction(()=>[...document.images].every(i=>i.complete&&i.naturalWidth===1280&&i.naturalHeight===884));
 await page.waitForFunction(()=>document.querySelector('#fitStatus').textContent.includes('处人工参照点'));
 assert.equal(await page.locator('canvas').count(),0);
 await page.screenshot({path:path.join(out,'comparison-split.png'),fullPage:true});
 await page.click('[data-mode=overlay]');
 const imageRects=await page.locator('img').evaluateAll(imgs=>imgs.map(i=>{const r=i.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};}));
 assert.deepEqual(imageRects[0],imageRects[1]);
 assert.ok(Math.abs(imageRects[0].width/imageRects[0].height-1280/884)<.0001);
 await page.locator('#opacity').fill('65');
 assert.equal(await page.locator('#opacityValue').textContent(),'65%');
 assert.equal(await page.locator('#modelImage').evaluate(el=>getComputedStyle(el).opacity),'0.65');
 await page.screenshot({path:path.join(out,'comparison-overlay.png'),fullPage:true});
 await page.click('[data-mode=reference]');
 assert.equal(await page.locator('#modelFigure').isVisible(),false);
 await page.click('[data-mode=model]');
 assert.equal(await page.locator('#referenceFigure').isVisible(),false);
 await page.setViewportSize({width:390,height:844});
 await page.click('[data-mode=split]');
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.screenshot({path:path.join(out,'comparison-mobile.png'),fullPage:true});
 assert.deepEqual(errors,[]);
 assert.deepEqual(requests.filter(u=>!u.startsWith(base+'/')),[]);
 assert.deepEqual(requests.filter(u=>/\.glb(?:$|\?)/.test(u)),[]);
 for(const route of ['/comparison/comparison.blend','/comparison/evidence.json','/comparison/../source/scene.max']) {
   assert.equal((await page.request.get(base+route)).status(),404);
 }
 const report={status:'PASS',sameImageDimensions:true,overlayAligned:true,noStretch:true,
   noWebGL:true,noModelDownload:true,externalRequests:[],pageErrors:errors,
   mobileOverflow:false,sourceFilesNotExposed:true,productionEligible:false};
 await fs.writeFile(path.join(out,'browser-result.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify(report));
} finally {await browser.close();}
