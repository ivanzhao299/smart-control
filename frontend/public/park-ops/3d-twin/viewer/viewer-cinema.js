const $=id=>document.getElementById(id),button=$('tour');
let manifest,metadata,playing=false,loading=false,generation=0,callback=0,fallbackTimer=0,anchorUpdates=0;
const movie=document.createElement('video');movie.id='cameraFilm';movie.hidden=true;movie.muted=true;movie.playsInline=true;movie.preload='none';movie.disablePictureInPicture=true;
$('picture').insertBefore(movie,$('markers'));
const detail=document.createElement('section');detail.id='assetDetail';detail.hidden=true;detail.setAttribute('aria-label','空间对象信息');$('viewport').append(detail);
function available(){const s=window.TWIN_VIEW_DEBUG?.state;return !!manifest&&s.activeView==='opposite'&&s.lighting==='day'&&s.mode==='landscape'&&!s.editing;}
function controls(){button.disabled=!available();button.setAttribute('aria-pressed',String(playing||loading));button.textContent=loading?'准备巡游…':playing?'停止巡游':'相机巡游 · 6秒';}
function restoreMarkers(){
 const state=window.TWIN_VIEW_DEBUG?.state;if(!state?.activeView)return;
 for(const label of window.TWIN_VIEW_DEBUG.draft.views[state.activeView]||[]){const el=[...$('markers').children].find(e=>e.dataset.id===label.id);if(el){el.hidden=false;el.style.left=`${label.x}%`;el.style.top=`${label.y}%`;}}
}
function stop(reason=''){
 generation++;playing=false;loading=false;
 if(callback&&movie.cancelVideoFrameCallback)movie.cancelVideoFrameCallback(callback);callback=0;
 clearTimeout(fallbackTimer);movie.pause();movie.removeAttribute('src');movie.load();movie.hidden=true;
 $('picture').classList.remove('cinema-active');restoreMarkers();controls();
 if(reason)$('status').textContent=reason;
}
function frame(time){
 if(!playing)return;const index=Math.min(metadata.frames.length-1,Math.max(0,time*metadata.fps));
 const a=metadata.frames[Math.floor(index)],b=metadata.frames[Math.min(Math.ceil(index),metadata.frames.length-1)],t=index-Math.floor(index);
 const original=manifest.views.find(v=>v.id==='opposite');const labels=window.TWIN_VIEW_DEBUG.draft.views.opposite;
 for(const el of $('markers').children){
  const anchor=a.anchors[el.dataset.id],end=b.anchors[el.dataset.id],label=labels.find(l=>l.id===el.dataset.id),base=original.labels[el.dataset.id];
  // Arbitrary image-space text has no 3D anchor; don't imply that it tracks a real building.
  if(!anchor||!base||!label){el.hidden=true;continue;}
  el.style.left=`${anchor.x+(end.x-anchor.x)*t+label.x-base.x}%`;el.style.top=`${anchor.y+(end.y-anchor.y)*t+label.y-base.y}%`;
 }anchorUpdates++;
 if(movie.requestVideoFrameCallback)callback=movie.requestVideoFrameCallback((_,info)=>frame(info.mediaTime));
 else fallbackTimer=setTimeout(()=>frame(movie.currentTime),100);
}
button.onclick=async()=>{
 if(playing||loading){stop('巡游已停止 · 恢复低功耗静态展示');return;}
 if(!available())return;loading=true;controls();detail.hidden=true;const token=++generation;
 try{
  if(!metadata){const r=await fetch('./realism/camera-tour.json');if(!r.ok)throw Error('巡游资源尚未就绪');metadata=await r.json();}
  if(token!==generation)return;
  if(metadata.revision!==manifest.revision||metadata.source!=='offline-true-camera-render'||metadata.frames.length!==96||metadata.fps!==16)throw Error('巡游与当前场景版本不一致');
  movie.src=new URL('./realism/camera-tour.mp4',location.href).href;await movie.play();
  if(token!==generation){movie.pause();return;}
  loading=false;playing=true;movie.hidden=false;$('picture').classList.add('cinema-active');controls();frame(0);
  $('status').textContent='真实相机巡游 · 6秒后恢复静态 · 自定义无锚点文字暂时隐藏';
 }catch(error){if(token===generation)stop(`${error.message} · 已保留静态画面，可重试`);}
};
movie.addEventListener('ended',()=>stop('巡游完成 · 已恢复低功耗静态展示'));
movie.addEventListener('error',()=>{if(playing||loading)stop('巡游加载失败 · 已恢复静态画面，可重试');});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&(playing||loading))stop('页面隐藏，巡游已停止');});
document.addEventListener('twin-view-changing',()=>{stop();detail.hidden=true;});
document.addEventListener('twin-editing',event=>{if(event.detail){stop('编辑期间暂停巡游');detail.hidden=true;}controls();});
document.addEventListener('twin-view-ready',event=>{manifest=event.detail.manifest;controls();});
window.addEventListener('message',event=>{if(event.origin===location.origin&&event.source===parent&&event.data?.type==='park-twin-visibility'&&!event.data.visible&&(playing||loading))stop('离开总览页面，巡游已停止');});
$('markers').addEventListener('click',event=>{
 if(window.TWIN_VIEW_DEBUG.state.editing||playing)return;
 const marker=event.target.closest('.marker');if(!marker)return;
 const anchor=manifest.anchors.find(a=>a.id===marker.dataset.id);
 detail.replaceChildren();const eyebrow=document.createElement('div');eyebrow.className='eyebrow';eyebrow.textContent='SPATIAL OBJECT / 空间对象';detail.append(eyebrow);
 const title=document.createElement('h2');title.textContent=marker.textContent;detail.append(title);
 const dl=document.createElement('dl');
 for(const [key,value] of [['模型构件',anchor?.sourceObject||'自定义图面文字'],['几何来源',anchor?'原 MAX 恢复模型':'用户标注'],['业务绑定','待正式标定'],['设备数据','未连接 / 非实时']]){const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=key;dd.textContent=value;dl.append(dt,dd);}detail.append(dl);
 const close=document.createElement('button');close.id='closeDetail';close.textContent='×';close.setAttribute('aria-label','关闭空间对象信息');close.onclick=()=>detail.hidden=true;detail.append(close);
 const edit=document.createElement('button');edit.textContent='编辑此标注';edit.onclick=()=>$('edit').click();detail.append(edit);detail.hidden=false;
});
manifest=window.TWIN_VIEW_DEBUG?.manifest;controls();
window.TWIN_CINEMA_DEBUG={get state(){return {playing,loading,anchorUpdates,videoTime:movie.currentTime,videoSource:movie.getAttribute('src'),available:available()};},stop};
