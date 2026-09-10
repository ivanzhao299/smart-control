// Opt-in local candidate only. No production settings, device control, or admin bypass.
const map=document.getElementById('parkMap');
document.body.classList.add('twin-screen');
const css=document.createElement('link');css.rel='stylesheet';css.href=new URL('./park-ops-twin.css',import.meta.url).href;document.head.append(css);
const frame=document.createElement('iframe');frame.id='parkTwinFrame';frame.title='园区真实模型多视角 · 本地验收';
frame.src=new URL('./twin-view/index.html?embedded=1',import.meta.url).href;
frame.setAttribute('sandbox','allow-scripts allow-same-origin allow-downloads');map.prepend(frame);
function sendLighting(){frame.contentWindow?.postMessage({type:'park-twin-lighting',value:document.body.dataset.scene==='night'?'night':'day'},location.origin);}
window.addEventListener('message',event=>{if(event.origin!==location.origin||event.source!==frame.contentWindow)return;if(event.data?.type==='park-twin-ready')sendLighting();});
new MutationObserver(sendLighting).observe(document.body,{attributes:true,attributeFilter:['data-scene']});
const entry=document.getElementById('openCalibration');entry.textContent='模型标注';entry.title='编辑当前相机视角标注，仅保存本机草稿';
entry.onclick=()=>frame.contentWindow?.postMessage({type:'park-twin-edit'},location.origin);
const title=map.closest('.park').querySelector('h3');title.textContent='园区空间总览';
const small=document.createElement('small');small.textContent='真实模型 · 另一侧相机 · 低功耗视角切换';title.append(small);
document.querySelector('.demo').textContent='本地候选 · 演示数据';
document.querySelector('.status b').textContent='设备未连接';
for(const badge of document.querySelectorAll('.cam .live'))badge.textContent='占位 / 未接入';
document.querySelector('.footerline').textContent='金湖科创产业园 · 本地大屏验收版 / 业务指标为 DEMO / 绿化为补建示意 / 尚未发布生产';
window.PARK_3D={mode:'offline-real-3d-camera-cache',continuousRendering:false,productionEligible:false};
