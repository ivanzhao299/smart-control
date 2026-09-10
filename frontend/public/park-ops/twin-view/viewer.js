const $=id=>document.getElementById(id);
const params=new URLSearchParams(location.search),embedded=params.get('embedded')==='1';
document.body.classList.toggle('embedded',embedded);
const names={reference:'原鸟瞰视角',opposite:'另一侧 · 180°',left:'侧向 A',right:'侧向 B',top:'俯视'};
let manifest,activeView,requestedView='opposite',mode='landscape',lighting='day',lightingMode=embedded?'day':'auto';
let editing=false,showLabels=true,selected='',draft,sequence=0,successfulLoads=0,currentImageKey='',history=[];
let lastDraftError='';
const draftKey=()=>`park.twin.annotations.${manifest.revision}`;
const list=()=>draft?.views?.[activeView]||[];
$('edit').disabled=true;
function announce(message){$('status').textContent=message;}
function save(){try{localStorage.setItem(draftKey(),JSON.stringify(draft));$('saveStatus').textContent='当前视角草稿已保存到本机；未写入生产。';lastDraftError='';}catch{lastDraftError='本机存储不可用，请下载 JSON 保存。';$('saveStatus').textContent=lastDraftError;}}
function checkpoint(){history.push(JSON.stringify(draft));if(history.length>20)history.shift();$('undo').disabled=!history.length;}
function defaultDraft(){return {version:1,revision:manifest.revision,views:Object.fromEntries(manifest.views.map(view=>[view.id,manifest.anchors.filter(a=>view.labels[a.id]?.visible).map(a=>({id:a.id,text:a.label,x:view.labels[a.id].x,y:view.labels[a.id].y,fontSize:12,color:'#d9fff5'}))]))};}
function validateDraft(value){
 if(!value||value.version!==1||value.revision!==manifest.revision||!value.views||Array.isArray(value.views))throw Error('标注版本与当前模型不一致');
 const clean={version:1,revision:manifest.revision,views:{}};
 for(const view of manifest.views){
  const labels=value.views[view.id];if(!Array.isArray(labels)||labels.length>100)throw Error('标注数量或格式不正确');
  const ids=new Set();clean.views[view.id]=labels.map(label=>{
   if(!label||typeof label.id!=='string'||!/^[-a-zA-Z0-9_]{1,100}$/.test(label.id)||ids.has(label.id))throw Error('标识无效或重复');ids.add(label.id);
   if(typeof label.text!=='string'||label.text.length>100||!/^#[0-9a-f]{6}$/i.test(label.color))throw Error('文字或颜色不正确');
   for(const [key,min,max] of [['x',0,100],['y',0,100],['fontSize',8,40]])if(typeof label[key]!=='number'||!Number.isFinite(label[key])||label[key]<min||label[key]>max)throw Error('标注坐标或字号超出范围');
   return {id:label.id,text:label.text,color:label.color,x:label.x,y:label.y,fontSize:label.fontSize};
  });
 }return clean;
}
function selectionForm(){
 const labels=list();if(!labels.some(x=>x.id===selected))selected=labels[0]?.id||'';
 $('selection').replaceChildren(...labels.map(label=>{const option=document.createElement('option');option.value=label.id;option.textContent=label.text||'空文字';return option;}));
 $('selection').value=selected;const label=labels.find(x=>x.id===selected);
 for(const [input,key] of [['labelText','text'],['fontSize','fontSize'],['color','color'],['posX','x'],['posY','y']]){
  $(input).disabled=!label;$(input).value=label?(typeof label[key]==='number'?Math.round(label[key]*10)/10:label[key]):(key==='color'?'#ffffff':'');
 }$('remove').disabled=!label;
}
function markers(){
 $('markers').replaceChildren();$('markers').hidden=!showLabels;
 for(const label of list()){
  const button=document.createElement('button');button.className='marker';button.classList.toggle('selected',editing&&selected===label.id);
  button.dataset.id=label.id;button.textContent=label.text;button.style.left=`${label.x}%`;button.style.top=`${label.y}%`;button.style.color=label.color;button.style.fontSize=`${label.fontSize}px`;
  button.onclick=()=>{selected=label.id;if(editing){selectionForm();markers();}};
  button.addEventListener('pointerdown',event=>{
   if(!editing||event.button!==0)return;event.preventDefault();checkpoint();selected=label.id;button.setPointerCapture(event.pointerId);
   const rect=$('picture').getBoundingClientRect(),start={x:event.clientX,y:event.clientY,lx:label.x,ly:label.y};
   const move=e=>{label.x=Math.max(0,Math.min(100,start.lx+(e.clientX-start.x)/rect.width*100));label.y=Math.max(0,Math.min(100,start.ly+(e.clientY-start.y)/rect.height*100));button.style.left=`${label.x}%`;button.style.top=`${label.y}%`;};
   const end=()=>{button.removeEventListener('pointermove',move);button.removeEventListener('pointerup',end);button.removeEventListener('pointercancel',end);save();selectionForm();markers();};
   button.addEventListener('pointermove',move);button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);
  });$('markers').append(button);
 }
}
function resize(){const viewport=$('viewport');const ratio=1600/1105;const width=Math.min(viewport.clientWidth,Math.max(1,viewport.clientHeight)*ratio);$('picture').style.width=`${width}px`;$('picture').style.height=`${width/ratio}px`;}
new ResizeObserver(resize).observe($('viewport'));
function controls(){for(const b of $('views').children)b.setAttribute('aria-pressed',String(b.dataset.view===activeView));$('clay').setAttribute('aria-pressed',String(mode==='clay'));for(const b of document.querySelectorAll('[data-light]'))b.setAttribute('aria-pressed',String(b.dataset.light===lightingMode));}
function filename(view){return mode==='clay'?view.clayImage:view.images[lighting];}
async function loadView(id){
 if(!manifest)return;const view=manifest.views.find(v=>v.id===id);if(!view)return;
 requestedView=id;const file=filename(view);if(!/^[-a-z0-9]+\.webp$/.test(file))throw Error('Unsafe view asset path');
 const key=`${id}/${file}`;const token=++sequence;if(key===currentImageKey){$('loading').hidden=true;$('retry').hidden=true;controls();return;}
 $('loading').hidden=false;$('loading').textContent=`正在加载${names[id]}…`;$('retry').hidden=true;
 try{
  const next=new Image();next.decoding='async';next.src=new URL(`./assets/${file}`,location.href).href;await next.decode();
  if(token!==sequence)return;
  const expected=mode==='clay'?[1280,884]:manifest.dimensions;
  if(next.naturalWidth!==expected[0]||next.naturalHeight!==expected[1])throw Error('图片尺寸与清单不符');
  const image=$('image');image.src=next.src;image.alt=`${names[id]}，${mode==='clay'?'真实模型白模':lighting==='night'?'夜景，补建绿化示意':'日景，补建绿化示意'}`;
  activeView=id;currentImageKey=key;successfulLoads++;selected='';markers();selectionForm();resize();controls();$('loading').hidden=true;$('edit').disabled=false;
  announce(`${names[id]} · ${mode==='clay'?'白模检查':lighting==='night'?'夜景模拟':'日景模拟'} · 按需加载，无持续三维计算`);
  parent.postMessage({type:'park-twin-state',view:id,mode,lighting},location.origin);
 }catch(error){if(token!==sequence)return;$('loading').textContent='视角加载失败，保留上一张有效画面。请重试。';$('retry').hidden=false;announce(error.message);controls();}
}
function setLighting(value){lightingMode=value;const hour=new Date().getHours();lighting=value==='auto'?(hour>=7&&hour<19?'day':'night'):value;loadView(requestedView);controls();}
$('clay').onclick=()=>{mode=mode==='clay'?'landscape':'clay';loadView(requestedView);};
$('labels').onclick=()=>{showLabels=!showLabels;$('labels').setAttribute('aria-pressed',String(showLabels));markers();};
$('edit').onclick=()=>{editing=!editing;$('inspector').hidden=!editing;$('workspace').classList.toggle('editing',editing);$('edit').setAttribute('aria-pressed',String(editing));markers();resize();};
$('selection').onchange=()=>{selected=$('selection').value;selectionForm();markers();};
for(const [id,key] of [['labelText','text'],['fontSize','fontSize'],['color','color'],['posX','x'],['posY','y']]){
 $(id).addEventListener('focus',checkpoint);
 $(id).addEventListener('input',()=>{const label=list().find(x=>x.id===selected);if(!label)return;const value=['x','y','fontSize'].includes(key)?Number($(id).value):$(id).value;
  if(key==='fontSize'&&(!Number.isFinite(value)||value<8||value>40))return;
  if(['x','y'].includes(key)&&(!Number.isFinite(value)||value<0||value>100))return;
  label[key]=value;if(key==='text')$('selection').selectedOptions[0].textContent=value||'空文字';save();markers();
 });
}
$('add').onclick=()=>{if(list().length>=100){$('saveStatus').textContent='当前视角最多 100 条标注。';return;}checkpoint();const label={id:`custom-${crypto.randomUUID()}`,text:'新标注',x:50,y:50,fontSize:12,color:'#d9fff5'};list().push(label);selected=label.id;save();selectionForm();markers();};
$('remove').onclick=()=>{checkpoint();draft.views[activeView]=list().filter(x=>x.id!==selected);selected='';save();selectionForm();markers();};
$('undo').onclick=()=>{if(!history.length)return;draft=JSON.parse(history.pop());save();selectionForm();markers();$('undo').disabled=!history.length;};
$('download').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(draft,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`${manifest.revision}-annotations.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('import').onchange=async event=>{try{const file=event.target.files[0];if(!file)return;if(file.size>200000)throw Error('文件超过 200 KB');const clean=validateDraft(JSON.parse(await file.text()));checkpoint();draft=clean;save();selectionForm();markers();}catch(error){$('saveStatus').textContent=`导入失败：${error.message}；现有标注未改动。`;}finally{event.target.value='';}};
$('retry').onclick=()=>manifest?loadView(requestedView):initialize();
for(const button of document.querySelectorAll('[data-light]'))button.onclick=()=>setLighting(button.dataset.light);
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==parent||!embedded)return;if(event.data?.type==='park-twin-lighting'&&['day','night','auto'].includes(event.data.value))setLighting(event.data.value);if(event.data?.type==='park-twin-edit'&&!editing)$('edit').click();});
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&lightingMode==='auto')setLighting('auto');});
setInterval(()=>{if(!document.hidden&&lightingMode==='auto')setLighting('auto');},60000);
async function initialize(){
 try{
  const response=await fetch('./assets/display-manifest.json');if(!response.ok)throw Error('模型视角包尚未就绪');
  manifest=await response.json();if(manifest.version!==1||manifest.renderMode!=='offline-real-3d-camera-cache')throw Error('不支持的模型视角包');
  draft=defaultDraft();try{const saved=localStorage.getItem(draftKey());if(saved)draft=validateDraft(JSON.parse(saved));}catch{$('saveStatus').textContent='本机旧草稿不可用，已载入默认标注；不会覆盖旧文件。';}
  $('views').replaceChildren(...manifest.views.map(view=>{const button=document.createElement('button');button.dataset.view=view.id;button.textContent=names[view.id];button.onclick=()=>loadView(view.id);button.setAttribute('aria-pressed','false');return button;}));
  $('budget').textContent=`完整视角包 ${(manifest.totalImageBytes/1e6).toFixed(2)} MB · 当前仅加载所选视角`;
  setLighting(lightingMode);parent.postMessage({type:'park-twin-ready'},location.origin);
 }catch(error){$('loading').textContent=error.message;$('retry').hidden=false;announce('加载失败，未替换为其它模型。');}
}
window.TWIN_VIEW_DEBUG={get state(){return {activeView,requestedView,lighting,mode,successfulLoads,currentImageKey,editing,lastDraftError};},get draft(){return JSON.parse(JSON.stringify(draft));}};
initialize();
