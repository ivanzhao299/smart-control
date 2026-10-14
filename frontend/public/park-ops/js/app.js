const BASE_W=3612,BASE_H=1462,app=document.getElementById('app');
function fit(){const sx=innerWidth/BASE_W,sy=innerHeight/BASE_H,mode=window.PARK_FIT_MODE||'stretch';let tx=sx,ty=sy,left=0,top=0;if(mode!=='stretch'){const s=mode==='cover'?Math.max(sx,sy):Math.min(sx,sy);tx=ty=s;left=(innerWidth-BASE_W*s)/2;top=(innerHeight-BASE_H*s)/2}app.style.transform=`scale(${tx},${ty})`;app.style.left=left+'px';app.style.top=top+'px'}addEventListener('resize',fit);fit();
document.getElementById('openCalibration').onclick=()=>{if(window.PARK_OPEN_CALIBRATION){window.PARK_OPEN_CALIBRATION();return}const next=new URL(location.href);next.searchParams.set('edit','1');location.href=next.toString()};
let buildings=[{id:'b01',number:'01#',phase:'1',name:'智能制造示范企业',x:18,y:38,people:86,energy:94,status:'正常',fontSize:11,color:'#c7e5ef'},{id:'b02',number:'02#',phase:'1',name:'高端装备示范企业',x:26,y:29,people:72,energy:91,status:'正常',fontSize:11,color:'#c7e5ef'},{id:'b03',number:'03#',phase:'1',name:'新材料示范企业',x:34,y:36,people:61,energy:88,status:'正常',fontSize:11,color:'#c7e5ef'},{id:'b04',number:'04#',phase:'1',name:'电子信息示范企业',x:42,y:28,people:53,energy:96,status:'正常',fontSize:11,color:'#c7e5ef'},{id:'b05',number:'05#',phase:'2',name:'精密制造示范企业',x:36,y:55,people:58,energy:92,status:'正常',fontSize:11,color:'#c7e5ef'},{id:'b06',number:'06#',phase:'2',name:'自动化示范企业',x:47,y:47,people:72,energy:89,status:'正常',fontSize:11,color:'#c7e5ef'},{id:'b07',number:'07#',phase:'2',name:'新能源示范企业',x:51,y:65,people:31,energy:87,status:'重点巡检',fontSize:11,color:'#c7e5ef'},{id:'b08',number:'08#',phase:'2',name:'科创孵化中心',x:58,y:57,people:48,energy:95,status:'正常',fontSize:11,color:'#c7e5ef'},{id:'b09',number:'09#',phase:'future',name:'生命健康示范企业',x:67,y:35,people:39,energy:93,status:'正常',fontSize:11,color:'#ffe7a8'},{id:'b10',number:'10#',phase:'future',name:'数字经济示范企业',x:75,y:43,people:48,energy:97,status:'正常',fontSize:11,color:'#ffe7a8'},{id:'b11',number:'11#',phase:'future',name:'园区运营中心',x:68,y:60,people:26,energy:96,status:'正常',fontSize:11,color:'#ffe7a8'},{id:'b12',number:'12#',phase:'future',name:'招商展示中心',x:82,y:55,people:24,energy:90,status:'招商中',fontSize:11,color:'#ffe7a8'}];
const buildingLayer=document.getElementById('buildingLayer'),detail=document.getElementById('buildingDetail');function safeText(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}function phaseLabel(id){const phase=window.PARK_RUNTIME?.config?.phases?.find(x=>x.id===id);return phase?phase.name+phase.zoneName:(id==='future'?'远期科创区':id==='2'?'二期研发区':'一期智造区')}function selectBuilding(b,el){document.querySelectorAll('.building-marker').forEach(x=>x.classList.remove('selected'));if(el)el.classList.add('selected');detail.innerHTML=`<div class="eyebrow">BUILDING DIGITAL PROFILE · ${safeText(phaseLabel(b.phase))}</div><h4>${safeText(b.number)} · ${safeText(b.name)}</h4><p>入驻企业：${safeText(b.tenant||'金湖科创')} · 产业类型：${safeText(b.industry||'智能制造')}</p><div class="detail-stats"><span><b>${Number(b.people)||0}</b>在园人员</span><span><b>${Number(b.energy)||0}%</b>能耗健康</span><span><b class="${b.status==='正常'?'ok':'warn'}">${safeText(b.status||'正常')}</b>设备状态</span></div>`}function renderBuildings(){buildingLayer.innerHTML='';buildings.forEach((b,i)=>{const el=document.createElement('button');el.className='building-marker';el.dataset.id=b.id;el.dataset.phase=b.phase;el.style.left=b.x+'%';el.style.top=b.y+'%';el.innerHTML=`<span class="pin"><b class="num" style="font-size:${b.fontSize}px;color:${b.color}">${safeText(b.number)}</b><span class="tenant" style="font-size:${b.fontSize}px;color:${b.color}">${safeText(b.name)}</span></span>`;el.onclick=()=>selectBuilding(b,el);buildingLayer.appendChild(el);if(i===0)selectBuilding(b,el)})}renderBuildings();
document.getElementById('phaseFilters').addEventListener('click',e=>{const btn=e.target.closest('[data-phase]');if(!btn)return;const phase=btn.dataset.phase;document.querySelectorAll('#phaseFilters .map-chip').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.phase').forEach(x=>{x.classList.toggle('dim',phase!=='all'&&x.dataset.phase!==phase);x.classList.toggle('active',phase!=='all'&&x.dataset.phase===phase)});document.querySelectorAll('.building-marker').forEach(x=>x.classList.toggle('dim',phase!=='all'&&x.dataset.phase!==phase));const first=buildings.find(x=>phase==='all'||x.phase===phase);if(first)selectBuilding(first,document.querySelector(`.building-marker[data-id="${CSS.escape(first.id)}"]`))});
const requestedScene=new URLSearchParams(location.search).get('scene');let sceneMode=['day','night'].includes(requestedScene)?requestedScene:'auto',lastScene='';function sceneForTime(d){const h=d.getHours()+d.getMinutes()/60;if(h>=7&&h<17.5)return'day';if((h>=5.3&&h<7)||(h>=17.5&&h<19.2))return'dusk';return'night'}function applyScene(d=new Date()){const scene=sceneMode==='auto'?sceneForTime(d):sceneMode;if(scene===lastScene&&sceneMode!=='auto')return;lastScene=scene;document.body.dataset.scene=scene;const names={day:'日景运行',dusk:'晨昏过渡',night:'夜景运行'};document.getElementById('sceneName').textContent=(sceneMode==='auto'?'自动 · ':'')+names[scene];document.getElementById('sceneIcon').className='scene-icon scene-'+scene;document.getElementById('sceneReadout').textContent=sceneMode==='auto'?`系统时间 ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} · ${names[scene]}`:`手动预览 · ${names[scene]}`}
document.querySelectorAll('#sceneControls .map-chip').forEach(x=>x.classList.toggle('active',x.dataset.mode===sceneMode));document.getElementById('sceneControls').addEventListener('click',e=>{const btn=e.target.closest('[data-mode]');if(!btn)return;sceneMode=btn.dataset.mode;document.querySelectorAll('#sceneControls .map-chip').forEach(x=>x.classList.toggle('active',x===btn));lastScene='';applyScene()});function tick(){const d=new Date();const y=d.getFullYear();const m=String(d.getMonth()+1).padStart(2,'0');const day=String(d.getDate()).padStart(2,'0');const h=String(d.getHours()).padStart(2,'0');const min=String(d.getMinutes()).padStart(2,'0');const s=String(d.getSeconds()).padStart(2,'0');document.getElementById('clock').textContent=`${y}年${m}月${day}日 ${h}:${min}:${s}`;const updateEl=document.getElementById('dataUpdateTime');if(updateEl)updateEl.textContent=`${h}:${min}:${s}`;applyScene(d)}tick();setInterval(tick,1000);
const pages=[...document.querySelectorAll('.page')];let idx=0,timer=null,switching=false;function render(){document.getElementById('pageIndicator').innerHTML=`${String(idx+1).padStart(2,'0')} / ${String(pages.length).padStart(2,'0')} · ${pages[idx].dataset.name}<span class="page-dots">${pages.map((_,i)=>`<i class="${i===idx?'on':''}"></i>`).join('')}</span>`}
// 科技感翻页音效（Web Audio API生成5种 + 玻璃敲击音频1种，共6种风格可选）
let audioCtx=null;let currentSoundType=6; // 默认使用第6种玻璃敲击音效
function ensureAudio(){if(!audioCtx){audioCtx=new(window.AudioContext||window.webkitAudioContext)()}if(audioCtx.state==='suspended'){audioCtx.resume()}return audioCtx}
// 音效1：科技UI风 - 清脆双音电子音，科幻电影界面切换感
function playSound1(){const ctx=ensureAudio();const t=ctx.currentTime;
const o1=ctx.createOscillator(),g1=ctx.createGain();o1.type='sine';o1.frequency.setValueAtTime(660,t);o1.frequency.exponentialRampToValueAtTime(990,t+0.06);g1.gain.setValueAtTime(0.06,t);g1.gain.exponentialRampToValueAtTime(0.001,t+0.1);o1.connect(g1);g1.connect(ctx.destination);o1.start(t);o1.stop(t+0.1);
const o2=ctx.createOscillator(),g2=ctx.createGain();o2.type='sine';o2.frequency.setValueAtTime(1320,t+0.05);g2.gain.setValueAtTime(0.04,t+0.05);g2.gain.exponentialRampToValueAtTime(0.001,t+0.12);o2.connect(g2);g2.connect(ctx.destination);o2.start(t+0.05);o2.stop(t+0.12)}
// 音效2：柔和滑动风 - 平滑频率上滑，页面滑动感，柔和不刺耳（推荐）
function playSound2(){const ctx=ensureAudio();const t=ctx.currentTime;
const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(300,t);o.frequency.exponentialRampToValueAtTime(600,t+0.12);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(0.05,t+0.02);g.gain.exponentialRampToValueAtTime(0.001,t+0.15);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+0.15);
const o2=ctx.createOscillator(),g2=ctx.createGain();o2.type='triangle';o2.frequency.setValueAtTime(150,t);o2.frequency.exponentialRampToValueAtTime(300,t+0.12);g2.gain.setValueAtTime(0.02,t);g2.gain.exponentialRampToValueAtTime(0.001,t+0.15);o2.connect(g2);g2.connect(ctx.destination);o2.start(t);o2.stop(t+0.15)}
// 音效3：未来脉冲风 - 带延迟感的脉冲，未来科技设备反馈
function playSound3(){const ctx=ensureAudio();const t=ctx.currentTime;
const o=ctx.createOscillator(),g=ctx.createGain();o.type='sawtooth';o.frequency.setValueAtTime(440,t);o.frequency.exponentialRampToValueAtTime(880,t+0.08);g.gain.setValueAtTime(0.03,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.1);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+0.1);
const delay=ctx.createDelay();delay.delayTime.value=0.08;const fb=ctx.createGain();fb.gain.value=0.3;const o2=ctx.createOscillator(),g2=ctx.createGain();o2.type='sine';o2.frequency.setValueAtTime(880,t);g2.gain.setValueAtTime(0.02,t);g2.gain.exponentialRampToValueAtTime(0.001,t+0.15);o2.connect(g2);g2.connect(delay);delay.connect(ctx.destination);delay.connect(fb);fb.connect(delay);o2.start(t);o2.stop(t+0.2)}
// 音效4：极简水滴风 - 非常简短的水滴声，干净利落
function playSound4(){const ctx=ensureAudio();const t=ctx.currentTime;
const o=ctx.createOscillator(),g=ctx.createGain();o.type='sine';o.frequency.setValueAtTime(1200,t);o.frequency.exponentialRampToValueAtTime(400,t+0.08);g.gain.setValueAtTime(0.05,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.1);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+0.1)}
// 音效5：机械按键风 - 短促机械感，类似高端键盘反馈
function playSound5(){const ctx=ensureAudio();const t=ctx.currentTime;
const o=ctx.createOscillator(),g=ctx.createGain();o.type='square';o.frequency.setValueAtTime(200,t);o.frequency.exponentialRampToValueAtTime(100,t+0.04);g.gain.setValueAtTime(0.03,t);g.gain.exponentialRampToValueAtTime(0.001,t+0.06);o.connect(g);g.connect(ctx.destination);o.start(t);o.stop(t+0.06);
const noise=ctx.createBufferSource(),buf=ctx.createBuffer(1,ctx.sampleRate*0.03,ctx.sampleRate),data=buf.getChannelData(0);for(let i=0;i<data.length;i++){data[i]=(Math.random()*2-1)*Math.exp(-i/(ctx.sampleRate*0.01))}noise.buffer=buf;const ng=ctx.createGain();ng.gain.value=0.02;noise.connect(ng);ng.connect(ctx.destination);noise.start(t)}
// 音效6：玻璃敲击 - 两声清脆水晶玻璃音，高端触屏反馈（默认）
let pageTurnAudio=null;
function playSound6(){if(!pageTurnAudio){pageTurnAudio=new Audio('./sounds/page-turn-glass-tap.wav');pageTurnAudio.preload='auto'}try{pageTurnAudio.currentTime=0;pageTurnAudio.volume=0.7;pageTurnAudio.play()}catch(e){}}
// 统一播放接口
function playPageSwitchSound(){try{const fns=[playSound1,playSound2,playSound3,playSound4,playSound5,playSound6];fns[(currentSoundType-1+6)%6]()}catch(e){}}
// 测试函数：在控制台输入 playTestSounds() 依次试听6种音效
function playTestSounds(){console.log('依次播放6种翻页音效...');const names=['1-科技UI风','2-柔和滑动风','3-未来脉冲风','4-极简水滴风','5-机械按键风','6-玻璃敲击(默认)'];const fns=[playSound1,playSound2,playSound3,playSound4,playSound5,playSound6];fns.forEach((fn,i)=>{setTimeout(()=>{console.log(`正在播放: ${names[i]}`);fn()},i*500)})}
// 切换音效类型：在控制台输入 setSoundType(1~6)
function setSoundType(n){currentSoundType=Math.max(1,Math.min(6,parseInt(n)||6));console.log(`已切换到音效${currentSoundType}`);playPageSwitchSound()}
function go(n){if(switching)return;const next=(n+pages.length)%pages.length;if(next===idx)return;try{playPageSwitchSound();switching=true;const direction=next>idx?'right':'left';const oldPage=pages[idx],newPage=pages[next];
oldPage.classList.remove('active');oldPage.classList.add(direction==='right'?'slide-out-left':'slide-out-right');oldPage.querySelectorAll('video').forEach(v=>{if(!v.paused)v.pause()});if(oldPage.dataset.name==='人车管理'&&window.ParkOpsHls)window.ParkOpsHls.stop(oldPage);newPage.classList.remove('slide-out-left','slide-out-right');newPage.classList.add('active');newPage.querySelectorAll('video').forEach(v=>{if(v.paused&&v.dataset.hlsInitialized==='true')v.play().catch(()=>{})});if(newPage.dataset.name==='人车管理'&&window.ParkOpsHls)void window.ParkOpsHls.start(newPage);if(newPage.dataset.name==='人车管理'&&window.LprPanel)window.LprPanel.refresh();idx=next;render();if(newPage.dataset.name==='视频监控'&&typeof fetchAiStats==='function'){setTimeout(fetchAiStats,100)}setTimeout(()=>{oldPage.classList.remove('slide-out-left','slide-out-right');switching=false},550)}catch(e){console.error('[ParkOps] 翻页出错:',e);switching=false}finally{setTimeout(()=>{if(switching){switching=false;console.warn('[ParkOps] 翻页超时保护: switching已强制重置')}},2000)}}document.getElementById('prev').onclick=()=>go(idx-1);document.getElementById('next').onclick=()=>go(idx+1);document.addEventListener('keydown',e=>{const target=e.target;if(e.defaultPrevented||e.isComposing||document.body.classList.contains('park-editing')||(target instanceof Element&&target.closest('input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),.park-editor-shell')))return;if(e.key==='ArrowLeft')go(idx-1);if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();go(idx+1)}});
document.getElementById('auto').onclick=function(){if(timer){clearInterval(timer);timer=null;this.textContent='自动轮播：关';this.classList.remove('on')}else{timer=setInterval(()=>go(idx+1),12000);this.textContent='自动轮播：开';this.classList.add('on')}};render();
// 远程翻页控制 (PWA播放控制卡片 → 运营大屏)
(function initRemoteControl(){
  let lastPage = idx;
  let lastAuto = !!timer;
  let lastRefreshTs = 0;
  let wasClaimed = false;
  // 停止本地自动轮播并复位按钮（接管释放 / TTL 自动还权时调用）。
  function stopAutoTimer(){
    if(timer){ clearInterval(timer); timer=null; }
    const b = document.getElementById('auto');
    if(b){ b.textContent='自动轮播：关'; b.classList.remove('on'); }
  }
  async function poll(){
    try{
      const r = await fetch('/api/park-ops-control/state?consumeRefresh=true',{cache:'no-store'});
      const j = await r.json();
      if(!j.success||!j.data)return;
      const {page, autoPlay, claimed, refreshRequested, refreshTimestamp} = j.data;
      // 强制刷新指令不要求接管（现场与远程均可触发）。
      if(refreshRequested && refreshTimestamp && refreshTimestamp !== lastRefreshTs){
        lastRefreshTs = refreshTimestamp;
        // 延迟500ms执行刷新，确保API响应返回后再刷新
        setTimeout(()=>{ window.location.reload(true); }, 500);
        return;
      }
      if(claimed){
        // 正被远程接管：才跟随其翻页与自动轮播指令。
        // Only acknowledge a remote page after go() accepted it. During the
        // 550ms transition go() deliberately returns early; acknowledging first
        // permanently dropped a command that arrived in that window.
        if(page !== lastPage){ go(page); if(idx === page) lastPage = page; }
        if(autoPlay !== lastAuto){
          lastAuto = autoPlay;
          const btn = document.getElementById('auto');
          if(autoPlay && !timer){ timer=setInterval(()=>go(idx+1),12000); if(btn){btn.textContent='自动轮播：开';btn.classList.add('on');} }
          else if(!autoPlay && timer){ clearInterval(timer); timer=null; if(btn){btn.textContent='自动轮播：关';btn.classList.remove('on');} }
        }
      }else{
        // 现场主控（默认 / 接管已释放 / TTL 到期）：忽略远程翻页，
        // 停掉接管期遗留的轮播，并把基线重置为本地当前页，避免接管瞬间误跳。
        if(wasClaimed) stopAutoTimer();
        lastPage = idx;
        lastAuto = !!timer;
      }
      wasClaimed = claimed;
    }catch(e){/* 网络异常时静默, 不影响本地操作 */}
  }
  setInterval(poll, 500);
})();
// 低功耗模式不启动全屏粒子 canvas；保留节点只为兼容旧版样式和校准器选择器。
document.getElementById('ambient').hidden=true;
// 明日摄像头接入预留：把 HLS/WebRTC/厂商 SDK 地址映射到 CAM-001/018/043/067 即可。
window.PARK_DEMO={version:'2026-09-08-camera-hotfix',resolution:'3612x1462',phases:['一期','二期','远期'],buildingCount:buildings.length,cameraSlots:['CAM-001','CAM-018','CAM-043','CAM-067']};
window.PARK_RUNTIME={get buildings(){return buildings},set buildings(value){buildings=value;renderBuildings()},renderBuildings,selectBuilding,fit,config:null};

// 摄像头HLS流畅视频流
(function initCameraHls(){
  // 全局常驻集合：排除“人车管理”视频墙的 lpr-cam（那 8 路只在翻到该页时按需拉流、翻走即停）
  const cams=document.querySelectorAll('.cam-hls[data-camera]:not(.lpr-cam)');
  if(!cams.length)return;

  const API_BASE='/api/cameras';
  const hlsInstances=new Map();

  async function startHlsStream(channel){
    try{
      const response=await fetch(`${API_BASE}/${channel}/hls/ensure`,{method:'POST'});
      const data=await response.json();
      return data.success?data.data:null;
    }catch(e){
      console.warn(`[ParkOps] 启动HLS转码失败 (${channel}):`,e.message);
      return null;
    }
  }

  // 销毁某个 <video> 上绑定的 Hls 实例及其定时器/监听（内存泄漏根治）。
  // 背景：ops-content 每 15s 用 innerHTML 重建第一页视频面板、视频健康检查也会重建，
  // 若不显式 destroy，旧实例的 transmuxer Worker / MSE SourceBuffer / 已缓冲分片会变成
  // 孤儿无法 GC（曾因此约 52 分钟泄漏 5.6GB，渲染进程 OOM 崩溃，LED 白屏“此页存在问题”）。
  function destroyHlsForVideo(video){
    if(!video)return;
    if(video._hls){ try{video._hls.destroy()}catch(e){} video._hls=null }
    if(video._playAbort){ try{video._playAbort.abort()}catch(e){} video._playAbort=null }
    if(Array.isArray(video._hlsTimers)){ video._hlsTimers.forEach(t=>{clearTimeout(t);clearInterval(t)}); video._hlsTimers=[] }
  }
  // 供 ops-content.js 在 innerHTML 重建视频容器“之前”调用：释放容器内所有旧实例。
  window.teardownHlsWithin=function(root){
    if(!root||!root.querySelectorAll)return;
    root.querySelectorAll('video').forEach(destroyHlsForVideo);
  };

  // 视频墙（人车管理页 lpr-cam）按需拉流：翻到该页 start，翻走 stop。
  // 不进全局常驻集合，避免 8 路一进大屏就常驻；stop 后由后端空闲停止兜底真正停 ffmpeg。
  //
  // 单路自愈：8 路并发拉 RTSP 时，个别路可能因首帧慢/竞态在首轮没出画。10s 后仍黑屏的，
  // 重新 ensure 并重建播放器一次；timer 挂在 video._hlsTimers，stop 时随 destroyHlsForVideo 清掉。
  function armWallRetry(cam){
    const video=cam.querySelector('.cam-video');
    if(!video)return;
    const channel=cam.dataset.camera;
    video.dataset.wallArmed='1';
    const retry=setTimeout(async ()=>{
      if(video.dataset.wallArmed!=='1')return; // 已翻走 stop
      if(video.videoWidth>0)return;          // 已出画，无需自愈
      console.warn(`[ParkOps] 视频墙 ${channel} 首帧未出画，重新拉起一次`);
      try{ await startHlsStream(channel); }catch(e){}
      if(video.dataset.wallArmed!=='1')return;
      destroyHlsForVideo(video);
      video.removeAttribute('data-hls-initialized');
      video.style.display='';
      initHlsPlayer(cam);
    },10000);
    video._hlsTimers=Array.isArray(video._hlsTimers)?video._hlsTimers:[];
    video._hlsTimers.push(retry);
  }
  // 单路冷启动等待：先轮询 playlist 直到后端 ffmpeg 产出（冷启动约 20-30s），再初始化播放器。
  // 解决“200ms 就 loadSource → playlist 不存在 → HLS 重试放弃/10s 重建时还没 ready → 50s 才出画”的时序问题。
  // 翻走 stop 时 video.dataset.wallArmed='0'，立即中止等待，不初始化残留播放器。
  async function waitPlaylistAndInit(cam){
    const video=cam.querySelector('.cam-video');
    const channel=cam.dataset.camera;
    const start=Date.now();
    const WAIT_MS=30000;
    let ready=false;
    while(Date.now()-start<WAIT_MS){
      if(video&&video.dataset.wallArmed!=='1')return;
      try{
        const r=await fetch(`${API_BASE}/${channel}/hls/playlist.m3u8`);
        if(r.ok){
          // 确认 playlist 已引用至少一个分片（ffmpeg 可能先建空 playlist）
          const text=await r.text();
          if(/\.ts/.test(text)){ready=true;break;}
        }
      }catch(e){}
      await new Promise(r=>setTimeout(r,1500));
    }
    if(video&&video.dataset.wallArmed!=='1')return;
    if(!ready)console.warn(`[ParkOps] 等待playlist超时仍尝试初始化 (${channel})`);
    initHlsPlayer(cam);
    armWallRetry(cam);
  }
  window.ParkOpsHls={
    async start(root){
      if(!root)return;
      const list=Array.from(root.querySelectorAll('.cam-hls.lpr-cam[data-camera]'));
      if(!list.length)return;
      // 进入即标记 armed、置“正在连接”，避免冷启动期间显示旧的黑屏/信号中断
      list.forEach((cam)=>{
        const video=cam.querySelector('.cam-video');
        const mock=cam.querySelector('.mock');
        if(video){video.dataset.wallArmed='1';video.style.display='none';}
        if(mock){mock.classList.remove('signal-lost');mock.textContent=`${cam.dataset.name||''} · 正在连接相机…`;mock.style.display='flex';}
      });
      // 第一步：并行拉起后端转码（冷启动 ensure 可能等待至 ffmpeg 产出；失败也不影响，ffmpeg 已在后台继续启动）
      await Promise.all(list.map(async (cam)=>{
        try{ await startHlsStream(cam.dataset.camera); }catch(e){}
      }));
      // 第二步：每路独立轮询 playlist 直到 200，就绪后再初始化播放器（先 ready 的先出画，不再过早 loadSource）
      await Promise.all(list.map((cam)=>waitPlaylistAndInit(cam)));
    },
    stop(root){
      if(!root)return;
      root.querySelectorAll('.lpr-cam').forEach((cam)=>{
        const video=cam.querySelector('.cam-video');
        const mock=cam.querySelector('.mock');
        const name=cam.dataset.name||'';
        if(video)video.dataset.wallArmed='0';
        destroyHlsForVideo(video);
        if(video){ video.pause(); video.removeAttribute('data-hls-initialized'); video.style.display='none'; }
        if(mock){ mock.classList.remove('signal-lost'); mock.textContent=`${name} · HLS已停止`; mock.style.display='flex'; }
        const liveEl=cam.querySelector('.live');
        if(liveEl){ liveEl.classList.remove('live-offline'); liveEl.innerHTML='<span class="live-indicator"></span>LIVE'; }
      });
    }
  };

  function initHlsPlayer(cam){
    const channel=cam.dataset.camera;
    const name=cam.dataset.name||channel;
    const video=cam.querySelector('.cam-video');
    const mock=cam.querySelector('.mock');
    if(!video)return;

    // 防重复初始化：如果已经成功加载过，直接返回（避免重试机制导致多个hls实例冲突）
    // 注意：如果初始化过但未成功加载（readyState<2），允许重新初始化
    if(video.dataset.hlsInitialized==='true' && video.readyState >= 2 && video.videoWidth > 0){
      console.log(`[ParkOps] 视频已成功加载，跳过 (${channel})`);
      return;
    }
    video.dataset.hlsInitialized='true';

    // 同一 video 重建/重入前，先彻底释放旧实例（按 video 精确销毁，不影响同 channel 其它页面的 video）
    destroyHlsForVideo(video);
    video._hlsTimers=[];
    const trackTimer=(id)=>{video._hlsTimers.push(id);return id};

    // 15秒超时处理：如果视频未成功播放，显示"信号中断"状态
    const connectTimeout=trackTimer(setTimeout(()=>{
      if(video.readyState<2||video.videoWidth===0){
        console.warn(`[ParkOps] HLS连接超时 (${channel})，显示信号中断`);
        if(mock){mock.textContent=`${name} · 信号中断`;mock.style.display='block';mock.classList.add('signal-lost')}
        if(video)video.style.display='none';
        const liveEl=cam.querySelector('.live');
        if(liveEl){liveEl.classList.add('live-offline');liveEl.innerHTML='<span class="live-indicator" style="background:#ef4444;box-shadow:0 0 8px rgba(239,68,68,.8)"></span>OFFLINE'}
      }
    },15000));

    const playlistUrl=`${API_BASE}/${channel}/hls/playlist.m3u8`;

    // 统一使用hls.js播放（优化版：低延迟+智能缓冲+错误恢复+内存管理）
    if(window.Hls&&window.Hls.isSupported()){
      const hls=new window.Hls({
        // 基础配置
        enableWorker:true,
        lowLatencyMode:true,
        // 直播延迟优化（关键）
        liveSyncDurationCount:1,      // 直播同步延迟1个分片（减少延迟）
        liveMaxLatencyDurationCount:3, // 直播最大延迟3个分片
        liveDurationInfinity:true,      // 直播无限时长（避免seek到末尾）
        // 缓冲管理优化（减少内存占用，提高启动速度）
        backBufferLength:5,             // 后退缓冲5秒（减小内存占用）
        maxBufferLength:5,               // 最大缓冲5秒（减少启动等待）
        maxMaxBufferLength:10,           // 最大最大缓冲10秒
        maxBufferSize:60*1000*1000,     // 最大缓冲大小60MB（防止内存溢出）
        // 码率自适应优化
        startLevel:-1,                   // 自动选择起始码率
        abrEwmaDefaultEstimate:500000,  // 默认带宽估计500kbps（子码流）
        abrBandWidthFactor:0.95,         // 带宽估计因子（保守估计，避免卡顿）
        abrBandWidthUpFactor:0.7,        // 升档带宽因子（更保守）
        // 错误恢复优化
        maxBufferHole:0.5,               // 最大缓冲间隙0.5秒
        maxSeekHole:2,                    // 最大seek间隙2秒
        nudgeOffset:0.1,                  // 微调偏移
        nudgeMaxRetry:3,                  // 微调最大重试
        // 网络优化
        manifestLoadingMaxRetry:3,       // manifest最大重试3次
        levelLoadingMaxRetry:3,           // 级别最大重试3次
        fragLoadingMaxRetry:3,            // 分片最大重试3次
        manifestLoadingRetryDelay:500,    // manifest重试延迟500ms
        levelLoadingRetryDelay:500,       // 级别重试延迟500ms
        fragLoadingRetryDelay:500,        // 分片重试延迟500ms
        // 性能优化
        enableSoftwareAES:false,          // 禁用软件AES解密（提高性能）
        renderTextTracksNatively:false,   // 禁用原生字幕渲染
      });

      // manifest 解析后显式 play（hls.js 官方推荐；不依赖 HTML autoplay，解决视频墙翻页后
      // video 仍 display:none / 未触发 playing 的问题；已在播放时为幂等无影响）
      hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{
        const pr=video.play();
        if(pr&&pr.catch)pr.catch(()=>{});
      });

      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{
        video.play().catch(()=>{});
        // 持续检测5秒，确保视频稳定播放（防止浏览器自动播放策略暂停）
        let playCheckCount=0;
        const playCheck=trackTimer(setInterval(()=>{
          playCheckCount++;
          if(video.paused&&video.readyState>=2){
            video.play().catch(()=>{});
          }
          if(playCheckCount>=10||(!video.paused&&video.currentTime>0)){
            clearInterval(playCheck);
          }
        },500));
      });

      hls.on(window.Hls.Events.ERROR,(event,data)=>{
        if(data.fatal){
          console.warn(`[ParkOps] HLS致命错误 (${channel}):`,data.type,data.details);
          switch(data.type){
            case window.Hls.ErrorTypes.NETWORK_ERROR:
              hls.startLoad();
              break;
            case window.Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              hls.destroy();
              break;
          }
        }
      });

      const playAbort=new AbortController(); video._playAbort=playAbort;
      video.addEventListener('playing',()=>{
        clearTimeout(connectTimeout);
        video.style.display='block';
        if(mock){mock.style.display='none';mock.classList.remove('signal-lost')}
        const liveEl=cam.querySelector('.live');
        if(liveEl){liveEl.classList.remove('live-offline');liveEl.innerHTML='<span class="live-indicator"></span>LIVE'}
      },{signal:playAbort.signal});

      video._hls=hls;
      hlsInstances.set(channel,hls);
      console.log(`[ParkOps] 使用hls.js播放 (${channel})`);
    }else{
      console.warn(`[ParkOps] 浏览器不支持HLS播放 (${channel})`);
      if(mock)mock.textContent=`${name} · 浏览器不支持HLS`;
    }
  }

  // 逐个启动HLS转码并初始化播放器（避免同时启动多个FFmpeg进程）
  // 并行启动所有HLS转码（使用-c:v copy后CPU负载极低，可并行启动）
  // 优化：第一页已预启动4路+2路额外通道，切换到视频页时6路转码都已在运行
  async function initAllCams(){
    console.log(`[ParkOps] 启动 ${cams.length} 路HLS转码（大部分已在第一页预启动）...`);
    // 第一步：并行启动所有FFmpeg转码进程（已运行的会直接返回）
    await Promise.all(Array.from(cams).map(async (cam) => {
      const channel=cam.dataset.camera;
      const name=cam.dataset.name||channel;
      try{
        await startHlsStream(channel);
      }catch(e){
        console.warn(`[ParkOps] 转码启动失败: ${channel}`, e);
      }
    }));
    // 第二步：等待200ms让FFmpeg生成第一个分片（大部分已在运行，减少等待）
    await new Promise(resolve=>setTimeout(resolve,200));
    // 第三步：并行初始化所有HLS播放器
    await Promise.all(Array.from(cams).map(async (cam) => {
      initHlsPlayer(cam);
    }));
    console.log(`[ParkOps] 已并行启动 ${cams.length} 路HLS流畅视频流`);
  }

  // 页面加载时立即初始化所有HLS播放器（首页4路 + 视频监控页6路）
  let hlsInitialized=false;
  function tryInitHls(){
    if(hlsInitialized) return;
    const allCams=document.querySelectorAll('.cam-hls[data-camera]:not(.lpr-cam)');
    if(allCams.length>0){
      hlsInitialized=true;
      initAllCams().then(()=>{
        setTimeout(()=>{
          document.querySelectorAll('.cam-hls video').forEach(v=>{
            if(v.paused&&v.src) v.play().catch(()=>{});
          });
        },500);
      });
    }
  }
  // DOM加载完成后立即尝试
  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',tryInitHls);
  }else{
    tryInitHls();
  }
  // 兜底：如果DOM还没完全渲染，用MutationObserver等待
  const hlsObserver=new MutationObserver(()=>{
    if(hlsInitialized){ hlsObserver.disconnect(); return; }
    tryInitHls();
  });
  hlsObserver.observe(document.body,{childList:true,subtree:true});

  // ==================== 视频流健康检查与自动恢复（优化版） ====================
  let videoHealthCheckCount=0;
  const VIDEO_HEALTH_CHECK_INTERVAL=30000; // 每30秒检查一次

  function videoHealthCheck(){
    videoHealthCheckCount++;
    const videos=document.querySelectorAll('.cam-hls video');
    let stalledCount=0;

    videos.forEach((video,index)=>{
      const cam=video.closest('.cam-hls');
      const channel=cam?.dataset.camera||`cam-${index}`;

      // 检查视频是否卡顿（readyState<2或videoWidth=0或paused）
      const isStalled=video.readyState<2||video.videoWidth===0||video.paused;
      if(isStalled){
        stalledCount++;
        // 只在第2次检查时才恢复（避免误判）
        if(videoHealthCheckCount>=2&&video.dataset.hlsInitialized==='true'){
          console.warn(`[ParkOps] 视频流卡顿，尝试恢复 (${channel})`);
          // 尝试重新播放
          video.play().catch(()=>{
            // 播放失败：按 video 精确销毁旧实例后重建（不影响同 channel 其它页面的 video）
            destroyHlsForVideo(video);
            hlsInstances.delete(channel);
            video.dataset.hlsInitialized='false';
            // 延迟重新初始化
            setTimeout(()=>{
              if(cam) initHlsPlayer(cam);
            },1000);
          });
        }
      }
    });

    if(stalledCount>0){
      console.log(`[ParkOps] 视频健康检查：${stalledCount}/${videos.length}路卡顿`);
    }
  }

  // 启动视频流健康检查
  setInterval(videoHealthCheck,VIDEO_HEALTH_CHECK_INTERVAL);
  console.log('[ParkOps] 视频流健康检查已启动，30秒检查一次');

  // 页面可见性变化时恢复视频播放（避免后台标签页暂停）
  document.addEventListener('visibilitychange',()=>{
    if(!document.hidden){
      setTimeout(()=>{
        document.querySelectorAll('.cam-hls video').forEach(v=>{
          if(v.paused&&v.src) v.play().catch(()=>{});
        });
      },500);
    }
  });

  // ==================== AI视频分析数据实时获取（优化版：增量更新+指数退避+防抖） ====================
  // 同源：走后端 /api/ai 反代到 AI 分析器（生产 GK 同源可达；本地经 SSH 隧道 + AI_ANALYZER_URL 也能看）
  const AI_API_BASE='/api/ai';
  const GATE_MAP={
    'd37':{name:'北大门',element:null},
    'd57':{name:'西大门',element:null},
    'p3-d37':{name:'东大门',element:null}
  };
  // “当前在园人数 / 当前在场车辆”以该基线为锚点，叠加各门实时净增(进-出)做动态变化。
  // AI 的 in/out 为分析服务启动以来累计计数，净增即这段时间相对基线的增减。
  // 基线来自服务端共享运营数据 (PWA「运营数据」卡片可改, GET /api/park-ops-metrics),
  // 拉取前用 window.PARK_OPS_BASELINE 或内置 486/127 兜底；下限钳制为 0，不出现负数。
  let ONSITE_PEOPLE_BASELINE=Number(window.PARK_OPS_BASELINE?.people??486);
  let ONSITE_VEHICLE_BASELINE=Number(window.PARK_OPS_BASELINE?.vehicles??127);
  async function loadOpsBaseline(){
    try{
      const br=await fetch('/api/park-ops-metrics',{cache:'no-store',headers:{'Accept':'application/json'}});
      if(!br.ok)return;
      const bj=await br.json(),bm=bj?.data?.metrics;
      if(!bm)return;
      let changed=false;
      if(Number.isFinite(Number(bm.people))&&ONSITE_PEOPLE_BASELINE!==Number(bm.people)){ONSITE_PEOPLE_BASELINE=Number(bm.people);changed=true;}
      if(Number.isFinite(Number(bm.vehicles))&&ONSITE_VEHICLE_BASELINE!==Number(bm.vehicles)){ONSITE_VEHICLE_BASELINE=Number(bm.vehicles);changed=true;}
      window.PARK_OPS_BASELINE={people:ONSITE_PEOPLE_BASELINE,vehicles:ONSITE_VEHICLE_BASELINE};
      // 基线首次到达/被PWA修改时可能晚于首帧AI数据; 用最近一帧AI数据立即重算, 避免onsite停在旧基线
      if(changed&&aiLastData&&typeof updateAiPanel==='function'){try{updateAiPanel(aiLastData);}catch{/* noop */}}
    }catch{/* 服务端不可用时保留当前/默认基线 */}
  }
  loadOpsBaseline(); setInterval(loadOpsBaseline,15000);
  // 光伏发电已迁移至「能源管理」页，由能源中心 dashboard 统一渲染（见文件末尾 initEnergyCenter）。
  let aiLastData=null;
  let aiErrorCount=0;
  let aiFetching=false;
  let aiLastFetchTime=0;
  const AI_FETCH_INTERVAL=5000; // 优化：从3秒改为5秒，减少服务器压力
  const AI_FETCH_TIMEOUT=8000;

  async function fetchAiStats(){
    // 防抖：避免并发请求
    if(aiFetching) return;
    const now=Date.now();
    if(now-aiLastFetchTime<AI_FETCH_INTERVAL*0.8) return;
    aiFetching=true;
    aiLastFetchTime=now;

    try{
      const controller=new AbortController();
      const timeoutId=setTimeout(()=>controller.abort(),AI_FETCH_TIMEOUT);
      const response=await fetch(`${AI_API_BASE}/stats`,{
        cache:'no-store',
        signal:controller.signal,
        headers:{'Accept':'application/json'}
      });
      clearTimeout(timeoutId);
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const data=await response.json();

      // 增量更新：只在数据变化时更新DOM
      if(!aiLastData||JSON.stringify(data)!==JSON.stringify(aiLastData)){
        aiLastData=data;
        updateAiPanel(data);
      }
      aiErrorCount=0;
    }catch(e){
      aiErrorCount++;
      // 指数退避：错误次数越多，等待时间越长
      if(aiErrorCount<=5){
        const waitTime=Math.min(aiErrorCount*2000,30000);
        console.warn(`[ParkOps] AI分析数据获取失败 (${aiErrorCount}/5)，${waitTime/1000}秒后重试:`,e.message);
      }
    }finally{
      aiFetching=false;
    }
  }

  function updateAiPanel(data){
    if(!data) return;
    let totalPersonIn=0,totalPersonOut=0,totalVehicleIn=0,totalVehicleOut=0;
    let totalCarIn=0,totalCarOut=0,totalTruckIn=0,totalTruckOut=0;
    let totalBusIn=0,totalBusOut=0,totalMotoIn=0,totalMotoOut=0;
    let totalBikeIn=0,totalBikeOut=0;

    Object.keys(GATE_MAP).forEach(gateId=>{
      const gateData=data[gateId];
      const gateEl=document.querySelector(`.ai-gate[data-gate="${gateId}"]`);
      if(!gateEl||!gateData) return;

      const pin=gateData.person_in||0,pout=gateData.person_out||0;
      const vin=gateData.vehicle_in||0,vout=gateData.vehicle_out||0;

      gateEl.querySelector('.person-in').textContent=pin;
      gateEl.querySelector('.person-out').textContent=pout;
      gateEl.querySelector('.vehicle-in').textContent=vin;
      gateEl.querySelector('.vehicle-out').textContent=vout;

      totalPersonIn+=pin;
      totalPersonOut+=pout;
      totalVehicleIn+=vin;
      totalVehicleOut+=vout;

      // 累加细分车辆类型
      totalCarIn+=gateData.car_in||0;
      totalCarOut+=gateData.car_out||0;
      totalTruckIn+=gateData.truck_in||0;
      totalTruckOut+=gateData.truck_out||0;
      totalBusIn+=gateData.bus_in||0;
      totalBusOut+=gateData.bus_out||0;
      totalMotoIn+=gateData.motorcycle_in||0;
      totalMotoOut+=gateData.motorcycle_out||0;
      totalBikeIn+=gateData.bicycle_in||0;
      totalBikeOut+=gateData.bicycle_out||0;
    });

    // 更新汇总（显示累计通行量=进+出，确保数字随动不为0；当前在场=进-出受初始基准影响暂不准确）
    const totalPeopleTraffic=totalPersonIn+totalPersonOut;
    const totalVehicleTraffic=totalVehicleIn+totalVehicleOut;

    const peopleEl=document.getElementById('aiTotalPeople');
    const vehiclesEl=document.getElementById('aiTotalVehicles');
    if(peopleEl) peopleEl.textContent=totalPeopleTraffic;
    if(vehiclesEl) vehiclesEl.textContent=totalVehicleTraffic;

    // 更新车辆分类统计（显示累计通行量=进+出）
    const carEl=document.getElementById('aiCarCount');
    const truckEl=document.getElementById('aiTruckCount');
    const busEl=document.getElementById('aiBusCount');
    const motoEl=document.getElementById('aiMotoCount');
    const bikeEl=document.getElementById('aiBikeCount');
    const carCount=totalCarIn+totalCarOut;
    const truckCount=totalTruckIn+totalTruckOut;
    const busCount=totalBusIn+totalBusOut;
    const motoCount=totalMotoIn+totalMotoOut;
    const bikeCount=totalBikeIn+totalBikeOut;
    const totalVehicleClass=carCount+truckCount+busCount+motoCount+bikeCount;
    if(carEl) carEl.textContent=carCount;
    if(truckEl) truckEl.textContent=truckCount;
    if(busEl) busEl.textContent=busCount;
    if(motoEl) motoEl.textContent=motoCount;
    if(bikeEl) bikeEl.textContent=bikeCount;
    // 更新车辆分类进度条（按占比显示）
    const carBar=document.getElementById('aiCarBar');
    const truckBar=document.getElementById('aiTruckBar');
    const busBar=document.getElementById('aiBusBar');
    const motoBar=document.getElementById('aiMotoBar');
    const bikeBar=document.getElementById('aiBikeBar');
    if(totalVehicleClass>0){
      if(carBar) carBar.style.width=`${Math.min(100,(carCount/totalVehicleClass)*100)}%`;
      if(truckBar) truckBar.style.width=`${Math.min(100,(truckCount/totalVehicleClass)*100)}%`;
      if(busBar) busBar.style.width=`${Math.min(100,(busCount/totalVehicleClass)*100)}%`;
      if(motoBar) motoBar.style.width=`${Math.min(100,(motoCount/totalVehicleClass)*100)}%`;
      if(bikeBar) bikeBar.style.width=`${Math.min(100,(bikeCount/totalVehicleClass)*100)}%`;
    }

    // 顶栏 + 各面板“当前在园人数 / 当前在场车辆”：以服务端共享运营数据为基线（PWA「运营数据」可配，缺省 486/127），
    // 叠加各门实时净增(进-出)动态变化，而非显示累计通行量(进+出)。
    const onsitePeople=Math.max(0, ONSITE_PEOPLE_BASELINE+(totalPersonIn-totalPersonOut));
    const onsiteVehicles=Math.max(0, ONSITE_VEHICLE_BASELINE+(totalVehicleIn-totalVehicleOut));
    // 顶栏 KPI（同时兼容静态 HTML 的 id 与 ops-content.js 生成的 data-ops-metric 属性）
    const kpiPeopleEl=document.getElementById('kpiPeopleCount')||document.querySelector('[data-ops-metric="people"]');
    const kpiVehicleEl=document.getElementById('kpiVehicleCount')||document.querySelector('[data-ops-metric="vehicles"]');
    if(kpiPeopleEl) kpiPeopleEl.textContent=onsitePeople;
    if(kpiVehicleEl) kpiVehicleEl.textContent=onsiteVehicles;
    // 综合态势 / 人车管理各面板内同名指标统一随动（data-onsite-people / data-onsite-vehicle）
    document.querySelectorAll('[data-onsite-people]').forEach(el=>{el.textContent=onsitePeople;});
    document.querySelectorAll('[data-onsite-vehicle]').forEach(el=>{el.textContent=onsiteVehicles;});
  }

  // 启动AI数据定时获取（优化版：5秒刷新，增量更新，指数退避）
  fetchAiStats();
  setInterval(fetchAiStats,AI_FETCH_INTERVAL);
  console.log('[ParkOps] AI视频分析数据实时获取已启动，5秒刷新（优化版）');

  // ==================== AI检测框可视化叠加（优化版：1秒刷新，防抖，只在视频页激活） ====================
  const AI_GATE_IDS=['d37','d57','p3-d37'];
  let aiDetectionsData={};
  let aiDetFetching=false;
  let aiDetLastTime=0;
  const AI_DET_INTERVAL=1000; // 优化：从500ms改为1秒，减少CPU占用
  const AI_DET_TIMEOUT=3000;
  // AI 检测框全局开关：由后台「视频绑定」统一配置（LED/投影/手机一处设置全终端一致），
  // 大屏不再保留本机悬浮按钮。每 12s 从后端只读口同步（读后端 JSON、不依赖 AI 是否在线），
  // 默认开，拉取失败保持上次状态。只控制浏览器端 canvas 叠加，不影响后端 AI 分析。
  let AI_BOX_ENABLED=true;
  let aiOverlayCfg={cameras:{}};
  async function fetchAiOverlayConfig(){
    try{
      const r=await fetch(`${AI_API_BASE}/overlay-config`,{cache:'no-store',headers:{'Accept':'application/json'}});
      if(!r.ok) return;
      const j=await r.json();
      const d=j&&j.data?j.data:j;
      if(d&&typeof d.aiBoxEnabled==='boolean') AI_BOX_ENABLED=d.aiBoxEnabled;
      if(d&&d.cameras) aiOverlayCfg=d.cameras;
      if(!AI_BOX_ENABLED) clearAiBoxes();
    }catch{/* 保持上次状态 */}
  }
  fetchAiOverlayConfig();
  setInterval(fetchAiOverlayConfig,12000);
  function clearAiBoxes(){
    AI_GATE_IDS.forEach(cid=>{
      const c=document.querySelector(`.cam[data-camera="${cid}"] .ai-overlay`);
      const x=c&&c.getContext('2d'); if(c&&x)x.clearRect(0,0,c.width,c.height);
    });
  }
  async function fetchAiDetections(){
    // 只在视频监控页激活时获取检测数据
    const videoPage=document.querySelector('[data-name="视频监控"].active');
    if(!videoPage) return;
    // 开关关闭：不请求数据并清空残留框线
    if(!AI_BOX_ENABLED){ clearAiBoxes(); return; }

    // 防抖：避免并发请求
    if(aiDetFetching) return;
    const now=Date.now();
    if(now-aiDetLastTime<AI_DET_INTERVAL*0.8) return;
    aiDetFetching=true;
    aiDetLastTime=now;

    try{
      const controller=new AbortController();
      const timeoutId=setTimeout(()=>controller.abort(),AI_DET_TIMEOUT);
      const response=await fetch(`${AI_API_BASE}/detections`,{
        cache:'no-store',
        signal:controller.signal,
        headers:{'Accept':'application/json'}
      });
      clearTimeout(timeoutId);
      if(!response.ok) throw new Error(`HTTP ${response.status}`);
      const data=await response.json();
      aiDetectionsData=data;
      AI_GATE_IDS.forEach(camId=>{
        if(data[camId]&&data[camId].detections){
          drawAiDetections(camId,data[camId]);
        }
      });
    }catch(e){
      // 静默失败，不影响视频播放
    }finally{
      aiDetFetching=false;
    }
  }

  function drawAiDetections(camId,camData){
    if(!AI_BOX_ENABLED) return;
    // 只在“视频监控”页作用域内定位：其它页（综合态势/人车管理等）也可能有同名 data-camera
    // 的小预览窗且排在 DOM 前面、内部并无 ai-overlay；全局选择器会误命中它然后 return，导致框画不上。
    const videoRoot=document.querySelector('[data-name="视频监控"]');
    const camEl=videoRoot
      ? videoRoot.querySelector(`.cam[data-camera="${camId}"]`)
      : document.querySelector(`.cam[data-camera="${camId}"]`);
    if(!camEl) return;
    const canvas=camEl.querySelector('.ai-overlay');
    if(!canvas) return;
    const video=camEl.querySelector('.cam-video');
    if(!video||video.style.display==='none') return;

    // 设置Canvas尺寸为元素实际尺寸
    const rect=camEl.getBoundingClientRect();
    if(canvas.width!==rect.width||canvas.height!==rect.height){
      canvas.width=rect.width;
      canvas.height=rect.height;
    }
    const ctx=canvas.getContext('2d');
    ctx.clearRect(0,0,canvas.width,canvas.height);

    const detections=camData.detections||[];
    const countLine=camData.count_line;

    // 绘制虚拟计数线
    if(countLine&&countLine.length===2){
      ctx.strokeStyle='rgba(255,200,0,0.6)';
      ctx.lineWidth=2;
      ctx.setLineDash([6,4]);
      ctx.beginPath();
      ctx.moveTo(countLine[0].x*canvas.width,countLine[0].y*canvas.height);
      ctx.lineTo(countLine[1].x*canvas.width,countLine[1].y*canvas.height);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 绘制检测区域 ROI（青色多边形；区域外目标 AI 本就不下发，这里只做可视化对位）
    const roiPoly=camData.roi_polygon;
    if(Array.isArray(roiPoly)&&roiPoly.length>=3){
      ctx.beginPath();
      roiPoly.forEach((pp,i)=>{
        const px=pp.x*canvas.width, py=pp.y*canvas.height;
        if(i===0) ctx.moveTo(px,py); else ctx.lineTo(px,py);
      });
      ctx.closePath();
      ctx.fillStyle='rgba(74,222,210,0.07)';
      ctx.fill();
      ctx.strokeStyle='rgba(74,222,210,0.55)';
      ctx.lineWidth=1.5;
      ctx.setLineDash([5,4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 绘制检测框
    detections.forEach(det=>{
      const x=det.x1*canvas.width;
      const y=det.y1*canvas.height;
      const w=(det.x2-det.x1)*canvas.width;
      const h=(det.y2-det.y1)*canvas.height;

      // 根据类别选择颜色和标签
      let color='#00ff88'; // person - 绿色
      let label='人';
      if(det.class==='car'){
        color='#00bfff'; label='轿车';
      }else if(det.class==='truck'){
        color='#ff9f6b'; label='货车';
      }else if(det.class==='bus'){
        color='#c7a8ff'; label='客车';
      }else if(det.class==='motorcycle'){
        color='#62e6a8'; label='电动车';
      }else if(det.class==='bicycle'){
        color='#f0c040'; label='自行车';
      }

      // 绘制框
      ctx.strokeStyle=color;
      ctx.lineWidth=2;
      ctx.strokeRect(x,y,w,h);

      // 绘制标签背景
      const labelText=`${label} ${Math.round(det.conf*100)}%`;
      ctx.font='12px monospace';
      const textWidth=ctx.measureText(labelText).width;
      ctx.fillStyle=color;
      ctx.fillRect(x,y-16,textWidth+8,16);

      // 绘制标签文字
      ctx.fillStyle='#000';
      ctx.fillText(labelText,x+4,y-4);
    });
  }

  // 启动检测框定时获取（优化版：1秒刷新，防抖，只在视频页激活）
  setInterval(fetchAiDetections,AI_DET_INTERVAL);
  console.log('[ParkOps] AI检测框可视化叠加已启动，1秒刷新（优化版）');

  // 如果当前已经在视频监控页，直接启动
  const currentVideoPage=document.querySelector('[data-name="视频监控"].active');
  if(currentVideoPage){
    hlsInitialized=true;
    initAllCams();
  }

  // 页面卸载时清理：实例表 + 每个 video 绑定的实例/定时器/监听，全部释放
  window.addEventListener('beforeunload',()=>{
    hlsInstances.forEach(hls=>{try{hls.destroy()}catch(e){}});
    document.querySelectorAll('.cam-hls video').forEach(destroyHlsForVideo);
  });

  // Kiosk 兜底：无人值守大屏长期运行，每 4 小时在非编辑状态静默重载一次，
  // 回收任何潜在累积内存，规避渲染进程长期膨胀崩溃（编辑/校准中不打断）。
  setInterval(()=>{
    if(document.body.classList.contains('park-editing'))return;
    window.location.reload();
  },4*60*60*1000);

  // 暴露全局函数，供ops-content.js动态生成视频元素后调用（第一页4路安防画面）
  window.startHlsTranscoding = startHlsStream;
  window.initHlsPlayer = initHlsPlayer;
})();

/* ===== 能源中心：一次拉取后端 /api/energy/dashboard（真实光伏+云计量 / 园区全口径模型），60s 自动刷新 ===== */
(function initEnergyCenter(){
  const $=id=>document.getElementById(id);
  const CAT_COLORS={lighting:'#fbbf24',hvac:'#60a5fa',power:'#a78bfa',elevator:'#22d3ee',socket:'#f472b6'};
  const padN=n=>String(n).padStart(2,'0');
  function esc(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
  function fmt(v,d){const x=Number(v);if(!isFinite(x))return '--';d=(d===undefined?0:d);return x.toLocaleString('en-US',{minimumFractionDigits:d,maximumFractionDigits:d});}
  function loadColor(rate){return rate>=85?'#f87171':rate>=60?'#fbbf24':'#34d399';}
  // 确定性“日系数”（以日期串为种子），让历史序列稳定、不随刷新跳变。
  function seedFrom(s){let h=0;for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))>>>0;}return h;}
  function dayFactor(dateStr,weekendDip,amp){const d=new Date(dateStr+'T00:00:00');const dow=d.getDay();const base=(dow===0||dow===6)?(1-weekendDip):1;const jitter=1+(((seedFrom(dateStr)%1000)/1000-0.5)*2*amp);return Math.max(0.05,base*jitter);}
  function localDateStr(dt){return dt.getFullYear()+'-'+padN(dt.getMonth()+1)+'-'+padN(dt.getDate());}

  async function fetchDashboard(){
    try{
      const r=await fetch('/api/energy/dashboard',{cache:'no-store',headers:{'Accept':'application/json'}});
      const j=await r.json();
      if(j&&j.data)return j.data;
      throw new Error((j&&j.message)||'dashboard error');
    }catch(e){console.warn('[EnergyCenter] dashboard fetch fail',e.message);return null;}
  }

  // 近30天全口径序列（模型演示：购电按工作日/波动，光伏按天气波动）；接入历史计量后替换。
  function buildSeries(d){
    const parkDay=d.park.totals.todayKwh;
    const pvDay=(d.pv&&d.pv.totals)?d.pv.totals.todayKwh:0;
    const out=[];
    for(let i=29;i>=0;i--){
      const dt=new Date();dt.setDate(dt.getDate()-i);
      const ds=localDateStr(dt);
      const total=Math.max(0,parkDay*dayFactor(ds,0.22,0.08));
      const pv=Math.max(0,pvDay*dayFactor(ds,0,0.28));
      out.push({date:ds,grid:Math.max(0,total-Math.min(pv,total)),pv:Math.min(pv,total)});
    }
    return out;
  }

  function render(d){
    const h=d.headline,pv=d.pv,park=d.park;
    // 顶部 KPI
    $('ehParkToday').textContent=fmt(h.parkTodayKwh);
    $('ehParkMonth').textContent=fmt(h.parkMonthKwh);
    $('ehPvToday').textContent=fmt(h.pvTodayKwh);
    $('ehGridToday').textContent=fmt(h.gridTodayKwh);
    $('ehMonthCost').textContent=fmt(h.monthCost);
    $('ehCarbon').textContent=fmt(h.carbonMonthT,1);

    // 光伏
    if(pv&&pv.totals){
      const t=pv.totals;
      $('ehPvPower').textContent=fmt(t.currentPowerKw,1);
      $('ehPvBadge').textContent=(pv.offlineCount>0?'部分离线 · 逆变器 ':'运行中 · 逆变器 ')+t.inverterOnline+'/'+t.inverterTotal;
      $('ehPvTodayKwh').textContent=fmt(t.todayKwh);
      $('ehPvMonthKwh').textContent=fmt(t.monthKwh);
      $('ehPvTotal').textContent=fmt(t.totalKwh/10000,1);
      $('ehPvUtil').textContent=fmt(t.utilization*100,1)+'%';
      $('ehPvFoot').textContent='锦浪云 · 装机'+fmt(t.capacityKw/1000,1)+'MWp · 累计减碳约'+fmt(t.totalCarbonEstT,0)+'吨 · 等效植树'+fmt(t.treesEquivalent/10000,2)+'万棵'+(pv.weather?' · '+pv.weather:'');
    }

    // 趋势（堆叠：光伏 + 购电）
    const series=buildSeries(d);
    const maxTotal=Math.max(1,...series.map(s=>s.grid+s.pv));
    $('ehTrend').innerHTML=series.map((s,i)=>{
      const hg=(s.grid/maxTotal)*100, hp=(s.pv/maxTotal)*100;
      const lab=(i%5===0)?s.date.slice(5):'';
      return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;min-width:0">'+
        '<div style="flex:1;display:flex;flex-direction:column;justify-content:flex-end;width:70%;max-width:30px">'+
        '<div title="'+s.date+' 光伏 '+fmt(s.pv)+' kWh" style="background:linear-gradient(180deg,#34d399,rgba(52,211,153,.4));height:'+hp+'%"></div>'+
        '<div title="'+s.date+' 购电 '+fmt(s.grid)+' kWh" style="background:linear-gradient(180deg,#60a5fa,rgba(96,165,250,.3));height:'+hg+'%"></div>'+
        '</div><span style="font-size:11px;color:#64748b;height:14px">'+lab+'</span></div>';
    }).join('');

    // 变压器
    $('ehTransformers').innerHTML=park.transformers.map(t=>{
      const capKw=Math.round(t.capacityKva*0.92);
      const c=loadColor(t.loadRatePct);
      return '<div>'+
        '<div style="display:flex;justify-content:space-between;font-size:15px;margin-bottom:3px">'+
        '<span style="color:#e2e8f0;font-weight:600">'+esc(t.name)+'<small style="color:#64748b;font-weight:400"> · '+esc(t.zoneLabel)+'</small></span>'+
        '<span style="color:'+c+';font-weight:700">'+fmt(t.loadRatePct,0)+'%</span></div>'+
        '<div class="bar" style="margin:0;height:12px"><i style="width:'+Math.max(t.loadRatePct,1.5)+'%;background:linear-gradient(90deg,'+c+','+c+'aa)"></i></div>'+
        '<div style="font-size:11px;color:#64748b;margin-top:3px">容量 '+t.capacityKva+' kVA / '+capKw+' kW · 峰值负荷 '+fmt(t.peakKw)+' kW · 今日 '+fmt(t.todayKwh)+' kWh</div>'+
      '</div>';
    }).join('');
    const totalCap=park.transformers.reduce((s,t)=>s+t.capacityKva,0);
    const totalPeak=park.transformers.reduce((s,t)=>s+t.peakKw,0);
    const avgRate=park.transformers.reduce((s,t)=>s+t.loadRatePct,0)/park.transformers.length;
    $('ehTrSummary').textContent='装机总容量 '+fmt(totalCap)+' kVA · 估算同时最大负荷 '+fmt(totalPeak)+' kW · 平均负载率 '+fmt(avgRate,1)+'%（规划口径）';

    // 分类
    $('ehCategories').innerHTML=park.categories.map(c=>{
      const col=CAT_COLORS[c.key]||'#38bdf8';
      return '<div>'+
        '<div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:3px">'+
        '<span style="color:#e2e8f0">'+esc(c.label)+'</span>'+
        '<span style="color:#cbd5e1">'+fmt(c.monthKwh)+' kWh · '+fmt(c.sharePct,1)+'%</span></div>'+
        '<div class="bar" style="margin:0;height:12px"><i style="width:'+Math.max(c.sharePct,1.5)+'%;background:linear-gradient(90deg,'+col+','+col+'aa)"></i></div>'+
      '</div>';
    }).join('');

    // 楼栋 Top8
    const topB=[...park.buildings].sort((a,b)=>b.todayKwh-a.todayKwh).slice(0,8);
    const maxB=Math.max(1,...topB.map(b=>b.todayKwh));
    $('ehBuildings').innerHTML=topB.map(b=>{
      const pct=(b.todayKwh/maxB)*100;
      return '<div style="display:flex;align-items:center;gap:10px">'+
        '<div style="flex:0 0 118px;font-size:14px;color:#e2e8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(b.name)+'</div>'+
        '<div class="bar" style="margin:0;flex:1"><i style="width:'+Math.max(pct,2)+'%"></i></div>'+
        '<div style="flex:0 0 78px;text-align:right;font-size:14px;color:#cbd5e1">'+fmt(b.todayKwh)+'</div>'+
      '</div>';
    }).join('');
    $('ehZones').innerHTML=park.totals.byZone.map(z=>
      '<div style="padding:8px 10px;background:rgba(99,217,255,.05);border:1px solid rgba(99,217,255,.1);border-radius:8px">'+
      '<div style="font-size:12px;color:#7898ab">'+esc(z.zoneLabel)+'</div>'+
      '<div style="font-size:18px;font-weight:700;color:#e2e8f0">'+fmt(z.monthKwh)+'<small style="font-size:11px;color:#64748b"> kWh/月</small></div></div>'
    ).join('');

    // 电梯
    $('ehElevators').innerHTML=park.elevators.map(e=>
      '<tr><td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(e.name)+'</td>'+
      '<td style="color:#94a3b8;font-size:13px">'+esc(e.kindLabel)+'·'+e.stops+'层</td>'+
      '<td style="text-align:right;font-weight:600">'+fmt(e.monthKwh)+'</td></tr>'
    ).join('');

    // 已接入云计量（真实）
    const bd=d.measured.breakdown||[];
    $('ehMeasured').innerHTML=bd.length?bd.map(b=>
      '<tr><td style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+esc(b.name)+'</td>'+
      '<td style="text-align:right">'+fmt(b.peakPowerW)+'</td>'+
      '<td style="text-align:right;font-weight:600">'+fmt(b.kwh)+'</td></tr>'
    ).join(''):'<tr><td colspan="3" style="color:#64748b">云计量同步中…</td></tr>';
  }

  // 判定一次 dashboard 是否“完整”：园区模型各维齐全；若光伏已启用则必须有 totals。
  function isReady(d){
    if(!d||!d.park)return false;
    const k=d.park;
    if(!(k.transformers.length&&k.categories.length&&k.buildings.length&&k.elevators.length))return false;
    if(d.pv&&d.pv.enabled&&!d.pv.totals)return false;
    return true;
  }
  let got=false;
  async function tick(){
    const d=await fetchDashboard();
    if(!d)return null;
    try{render(d);}catch(e){console.warn('[EnergyCenter] render error',e.message);}
    if(isReady(d))got=true;
    return d;
  }
  async function boot(){
    await tick();
    // 首次若不完整（如锦浪首次刷新未完成），按递增间隔持续补拉，直到完整。
    for(const dl of [5000,10000,18000,30000,45000]){
      if(got)break;
      await new Promise(r=>setTimeout(r,dl));
      await tick();
    }
    setInterval(tick,60000);
  }
  window.__energyCenter=tick;
  boot();
})();
