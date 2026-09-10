import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const base=process.env.TWIN_URL??'http://127.0.0.1:5199',out=process.env.TWIN_EVIDENCE;
if(!out)throw Error('TWIN_EVIDENCE required');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try{
 const page=await browser.newPage({viewport:{width:1600,height:1000},deviceScaleFactor:1});const errors=[],requests=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));
 await page.addInitScript(()=>{window.__webglCalls=0;const old=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(kind,...rest){if(String(kind).includes('webgl'))window.__webglCalls++;return old.call(this,kind,...rest);};});
 await page.goto(base+'/screen/twin-view/index.html');
 const ready=async(view)=>page.waitForFunction(v=>TWIN_VIEW_DEBUG.state.activeView===v&&document.querySelector('#loading').hidden,view);
 await ready('opposite');assert.equal(requests.filter(u=>u.endsWith('.webp')).length,1,'Initial load must request one image');
 await page.screenshot({path:path.join(out,'opposite-day.png'),fullPage:true});
 for(const view of ['reference','left','right','top','opposite']){await page.click(`[data-view=${view}]`);await ready(view);await page.screenshot({path:path.join(out,view+'-landscape.png'),fullPage:true});}
 await page.click('[data-light=night]');await page.waitForFunction(()=>TWIN_VIEW_DEBUG.state.currentImageKey.includes('night'));
 await page.screenshot({path:path.join(out,'opposite-night.png'),fullPage:true});
 await page.click('#clay');await page.waitForFunction(()=>TWIN_VIEW_DEBUG.state.currentImageKey.includes('clay'));
 await page.screenshot({path:path.join(out,'opposite-clay.png'),fullPage:true});await page.click('#clay');await page.waitForFunction(()=>TWIN_VIEW_DEBUG.state.currentImageKey.includes('night'));
 await page.click('#edit');await page.click('#add');await page.fill('#labelText','验收标注 A');await page.locator('#labelText').press('Space');
 assert.equal(await page.locator('#labelText').inputValue(),'验收标注 A ');
 await page.fill('#fontSize','18');await page.fill('#color','#ffcc88');await page.fill('#posX','42');await page.fill('#posY','39');
 const custom=await page.evaluate(()=>TWIN_VIEW_DEBUG.draft.views.opposite.at(-1));assert.equal(custom.text,'验收标注 A ');assert.equal(custom.x,42);
 await page.screenshot({path:path.join(out,'annotations.png'),fullPage:true});
 const marker=page.locator(`.marker[data-id="${custom.id}"]`),rect=await marker.boundingBox();
 await page.mouse.move(rect.x+10,rect.y+8);await page.mouse.down();await page.mouse.move(rect.x+40,rect.y+25,{steps:3});await page.mouse.up();
 assert.notEqual(await page.evaluate(()=>TWIN_VIEW_DEBUG.draft.views.opposite.at(-1).x),42);
 const saved=await page.evaluate(()=>TWIN_VIEW_DEBUG.draft);await page.click('#remove');assert.equal((await page.evaluate(()=>TWIN_VIEW_DEBUG.draft.views.opposite)).length,saved.views.opposite.length-1);
 await page.click('#undo');assert.deepEqual(await page.evaluate(()=>TWIN_VIEW_DEBUG.draft),saved);
 const download=page.waitForEvent('download');await page.click('#download');const jsonFile=path.join(out,'annotations.json');await(await download).saveAs(jsonFile);
 await page.click('#remove');await page.locator('#import').setInputFiles(jsonFile);await page.waitForFunction(n=>TWIN_VIEW_DEBUG.draft.views.opposite.length===n,saved.views.opposite.length);
 await page.locator('#import').setInputFiles({name:'bad.json',mimeType:'application/json',buffer:Buffer.from('{"version":1,"revision":"wrong"}')});
 await page.waitForFunction(()=>document.querySelector('#saveStatus').textContent.includes('导入失败'));assert.deepEqual(await page.evaluate(()=>TWIN_VIEW_DEBUG.draft),saved);
 await page.reload();await ready('opposite');assert.deepEqual(await page.evaluate(()=>TWIN_VIEW_DEBUG.draft),saved);
 // Race: delayed left image must not replace a newer request for the already-visible opposite image.
 await page.route('**/left-day.webp',async route=>{await new Promise(r=>setTimeout(r,500));await route.continue();});
 await page.click('[data-view=left]');await page.click('[data-view=opposite]');await page.waitForTimeout(800);await ready('opposite');
 await page.unroute('**/left-day.webp');
 // A failed image must leave the previous valid view intact and offer recovery.
 await page.route('**/right-day.webp',route=>route.abort());
 await page.click('[data-view=right]');await page.locator('#retry').waitFor({state:'visible'});
 assert.equal(await page.evaluate(()=>TWIN_VIEW_DEBUG.state.activeView),'opposite');
 await page.unroute('**/right-day.webp');await page.click('#retry');await ready('right');
 await page.click('[data-view=opposite]');await ready('opposite');
 const swaps=await page.evaluate(()=>TWIN_VIEW_DEBUG.state.successfulLoads);await page.waitForTimeout(2500);
 assert.equal(await page.evaluate(()=>TWIN_VIEW_DEBUG.state.successfulLoads),swaps,'Idle view must not render/swap');
 assert.equal(await page.evaluate(()=>window.__webglCalls),0);
 await page.setViewportSize({width:1920,height:1080});await page.goto(base+'/screen/index.html?twin=1');
 const frame=page.frameLocator('#parkTwinFrame');await frame.locator('#image').waitFor();
 await page.waitForFunction(()=>document.querySelector('#parkTwinFrame')?.contentWindow?.TWIN_VIEW_DEBUG?.state?.activeView==='opposite');
 await page.screenshot({path:path.join(out,'screen-1920.png'),fullPage:true});
 const ratioError=await frame.locator('#image').evaluate(i=>{const r=i.getBoundingClientRect();return Math.abs(r.width/r.height-i.naturalWidth/i.naturalHeight);});assert.ok(ratioError<.001);
 assert.equal(await page.locator('#app').evaluate(e=>getComputedStyle(e).transform),'none');
 await page.click('#sceneControls [data-mode=night]');await page.waitForFunction(()=>document.querySelector('#parkTwinFrame').contentWindow.TWIN_VIEW_DEBUG.state.currentImageKey.includes('night'));
 await page.screenshot({path:path.join(out,'screen-night.png'),fullPage:true});
 const pageBeforeEditing=await page.locator('.page.active').getAttribute('data-name');
 await page.click('#openCalibration');await frame.locator('#labelText').waitFor({state:'visible'});await frame.locator('#labelText').fill('空格 测试');await frame.locator('#labelText').press('Space');
 assert.equal(await page.locator('.page.active').getAttribute('data-name'),pageBeforeEditing);
 await frame.locator('#edit').click();await page.setViewportSize({width:3612,height:1462});await page.screenshot({path:path.join(out,'screen-led-native.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'screen-mobile.png'),fullPage:true});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.deepEqual(errors,[]);assert.deepEqual(requests.filter(u=>!u.startsWith(base+'/')),[]);
 assert.deepEqual(requests.filter(u=>/\.glb(?:$|\?)|three.*\.js/.test(u)),[]);
 // Fresh isolated browser context for user-facing screenshots, without test labels.
 const clean=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 await clean.goto(base+'/screen/index.html?twin=1');
 await clean.waitForFunction(()=>document.querySelector('#parkTwinFrame')?.contentWindow?.TWIN_VIEW_DEBUG?.state?.activeView==='opposite');
 await clean.screenshot({path:path.join(out,'screen-acceptance-day.png'),fullPage:true});
 await clean.click('#sceneControls [data-mode=night]');
 await clean.waitForFunction(()=>document.querySelector('#parkTwinFrame').contentWindow.TWIN_VIEW_DEBUG.state.currentImageKey.includes('night'));
 await clean.screenshot({path:path.join(out,'screen-acceptance-night.png'),fullPage:true});
 // Manifest failure must not expose a broken editor and must be recoverable.
 const failed=await browser.newPage();await failed.route('**/display-manifest.json',route=>route.abort());
 await failed.goto(base+'/screen/twin-view/index.html');await failed.locator('#retry').waitFor({state:'visible'});
 assert.equal(await failed.locator('#edit').isDisabled(),true);
 await failed.unroute('**/display-manifest.json');await failed.click('#retry');
 await failed.waitForFunction(()=>TWIN_VIEW_DEBUG.state.activeView==='opposite');
 assert.equal(await failed.locator('#edit').isEnabled(),true);
 const legacy=await browser.newPage();
 const oldDraft=JSON.stringify({version:1,revision:'jinhu-camera-20260910-v1',views:{reference:[],opposite:[{id:'user-old',text:'原有企业文字',x:40,y:50,fontSize:12,color:'#ffffff'}],left:[],right:[],top:[]}});
 await legacy.addInitScript(value=>localStorage.setItem('park.twin.annotations.jinhu-camera-20260910-v1',value),oldDraft);
 await legacy.goto(base+'/screen/twin-view/index.html');await legacy.waitForFunction(()=>TWIN_VIEW_DEBUG.state.activeView==='opposite');
 await legacy.click('#edit');await legacy.locator('#legacyDraft').waitFor({state:'visible'});
 const oldDownload=legacy.waitForEvent('download');await legacy.click('#legacyDraft');
 const backupFile=path.join(out,'legacy-backup.json');await(await oldDownload).saveAs(backupFile);
 assert.equal(await fs.readFile(backupFile,'utf8'),oldDraft);
 await legacy.click('#add');await legacy.fill('#labelText','新构图文字');
 assert.equal(await legacy.evaluate(()=>localStorage.getItem('park.twin.annotations.jinhu-camera-20260910-v1')),oldDraft);
 const result={status:'PASS',fiveRealCameraViews:true,dayNight:true,clayComparison:true,annotationCrudDragUndoAndJson:true,
   annotationSpaceNoPageTurn:true,legacyDraftPreservedAndDownloadable:true,lateImageRaceProtected:true,failedImageAndManifestRecovery:true,aspectRatioPreserved:true,nativeLedAnd1920Layouts:true,
   idleImageSwaps:0,webglContexts:0,externalRequests:[],pageErrors:errors,productionEligible:false};
 await fs.writeFile(path.join(out,'browser-result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}finally{await browser.close();}
