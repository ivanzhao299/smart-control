import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const base=process.env.TWIN_URL||'http://127.0.0.1:5199',out=process.env.TWIN_EVIDENCE;
if(!out)throw Error('TWIN_EVIDENCE required');await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
const measurements=[];
try{
 const page=await browser.newPage({viewport:{width:1920,height:1080},deviceScaleFactor:1});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(process.env.TWIN_PREVIEW){
  const preview=process.env.TWIN_PREVIEW;
  await page.route('**/assets/display-manifest.json',async route=>route.fulfill({contentType:'application/json',body:await fs.readFile(path.join(preview,'display-manifest.json'))}));
  await page.route('**/assets/*-day.webp',async route=>route.fulfill({contentType:'image/png',body:await fs.readFile(path.join(preview,path.basename(new URL(route.request().url()).pathname).replace('.webp','.png')))}));
 }
 await page.goto(base+'/screen/index.html?twin=1');
 const frame=page.frameLocator('#parkTwinFrame');
 for(const size of [{width:1920,height:1080},{width:3612,height:1462},{width:1366,height:768}]){
  await page.setViewportSize(size);
  for(const id of ['opposite','reference','left','right','top']){
   await frame.locator(`[data-view=${id}]`).click();
   await page.waitForFunction(id=>{const w=document.querySelector('#parkTwinFrame')?.contentWindow;return w?.TWIN_VIEW_DEBUG?.state?.activeView===id&&w.document.querySelector('#loading').hidden;},id);
   await page.waitForTimeout(100);
   const metric=await frame.locator('#viewport').evaluate(async el=>{
    const m=await(await fetch('./assets/display-manifest.json')).json();
    const view=m.views.find(v=>v.id===TWIN_VIEW_DEBUG.state.activeView),b=view.subjectBounds;
    const i=document.querySelector('#image'),r=i.getBoundingClientRect(),v=el.getBoundingClientRect();
    return {view:view.id,viewport:{width:v.width,height:v.height},picture:{width:r.width,height:r.height},
     subject:{left:r.x+b[0]*r.width-v.x,right:r.x+b[2]*r.width-v.x,top:r.y+b[1]*r.height-v.y,bottom:r.y+b[3]*r.height-v.y},
     widthFill:(b[2]-b[0])*r.width/v.width,heightFill:(b[3]-b[1])*r.height/v.height,
     ratioError:Math.abs(r.width/r.height-i.naturalWidth/i.naturalHeight)};
   });
   assert.ok(metric.picture.width>=metric.viewport.width-1&&metric.picture.height>=metric.viewport.height-1,'Background must cover viewport');
   assert.ok(metric.subject.left>=-1&&metric.subject.top>=-1&&metric.subject.right<=metric.viewport.width+1&&metric.subject.bottom<=metric.viewport.height+1,'Measured subject must not be clipped');
   assert.ok(Math.max(metric.widthFill,metric.heightFill)>.925,'Subject must fill at least 92.5% of its limiting axis');
   assert.ok(metric.ratioError<.001,'Image must not stretch');
   measurements.push({screen:size,...metric});
   if(size.width!==1366)await page.screenshot({path:path.join(out,`${size.width}-${id}.png`)});
  }
 }
 assert.deepEqual(errors,[]);
 await fs.writeFile(path.join(out,'framing-result.json'),JSON.stringify({status:'PASS',measurements,errors,productionEligible:false},null,2));
 console.log(JSON.stringify({status:'PASS',cases:measurements.length,noSubjectClipping:true,noLetterboxing:true,noStretch:true,minLimitingAxisFill:Math.min(...measurements.map(m=>Math.max(m.widthFill,m.heightFill)))}));
}finally{await browser.close();}
