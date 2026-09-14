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
// 从欢迎页切出：克隆大字飞升到标题栏位置（FLIP技术保持文字比例）
if(oldPage.classList.contains('welcome-page')){const title=oldPage.querySelector('.welcome-title');if(title){
// 获取大字实际字体大小和位置
const titleFontSize=parseFloat(getComputedStyle(title).fontSize);
const initialRect=title.getBoundingClientRect();
// 先获取原welcomeLine的准确位置和大小（临时显示）
const welcomeLine=document.getElementById('welcomeLine');
const wlDisplay=welcomeLine.style.display;
const wlOpacity=welcomeLine.style.opacity;
const wlTransform=welcomeLine.style.transform;
welcomeLine.style.display='block';
welcomeLine.style.opacity='1';
welcomeLine.style.transform='none';
const wlRect=welcomeLine.getBoundingClientRect();
const wlStyle=getComputedStyle(welcomeLine);
const wlFontSize=wlStyle.fontSize;
const wlLetterSpacing=wlStyle.letterSpacing;
const wlLineHeight=wlStyle.lineHeight;
const wlOffsetLeft=welcomeLine.offsetLeft;
const wlOffsetTop=welcomeLine.offsetTop;
const wlOffsetWidth=welcomeLine.offsetWidth;
welcomeLine.style.display=wlDisplay;
welcomeLine.style.opacity=wlOpacity;
welcomeLine.style.transform=wlTransform;
// 创建克隆元素，放到.title容器内部，与原welcomeLine完全同位置同缩放
const clone=document.createElement('div');
clone.className='welcome-clone';
clone.textContent=title.textContent;
clone.style.fontSize=wlFontSize;
clone.style.letterSpacing=wlLetterSpacing;
clone.style.lineHeight=wlLineHeight;
clone.style.textAlign='center';
clone.style.position='absolute';
clone.style.zIndex='9999';
clone.style.pointerEvents='none';
clone.style.whiteSpace='nowrap';
clone.style.transformOrigin='center';
// 使用原welcomeLine的offset位置（相对于.title容器），往下微调增加间距
clone.style.left=wlOffsetLeft+'px';
clone.style.top=(wlOffsetTop+20)+'px';
clone.style.width=wlOffsetWidth+'px';
welcomeLine.parentElement.appendChild(clone);
// 获取最终尺寸和中心点（相对于#app容器）
const finalRect=clone.getBoundingClientRect();
const finalCenterX=finalRect.left+finalRect.width/2;
const finalCenterY=finalRect.top+finalRect.height/2;
// 计算缩放比例（从大字缩小到小字）
const scale=titleFontSize/parseFloat(wlFontSize);
// 大字的中心点
const initialCenterX=initialRect.left+initialRect.width/2;
const initialCenterY=initialRect.top+initialRect.height/2;
// 初始transform：从最终位置移回大字位置，放大到大字大小（中心点对齐）
clone.style.transform=`translate(${initialCenterX-finalCenterX}px,${initialCenterY-finalCenterY}px) scale(${scale})`;
// 强制重排
clone.offsetHeight;
// 开始动画：过渡到最终位置，scale(1)
clone.style.transition='transform 1.2s cubic-bezier(.4,0,.2,1)';
clone.style.transform='translate(0,0) scale(1)';
// 动画完成后保持
setTimeout(()=>{clone.style.transition='none'},1250)}}
// 切回欢迎页：移除克隆大字，隐藏标题栏欢迎小字
if(newPage.classList.contains('welcome-page')){document.querySelectorAll('.welcome-clone').forEach(el=>el.remove());const title=newPage.querySelector('.welcome-title');if(title){title.classList.remove('zoom-out');title.style.animation='none';title.offsetHeight;title.style.animation=''}const welcomeSub=document.querySelector('.title .sub');if(welcomeSub)welcomeSub.style.display='none'}else{// 切换到其他页面：隐藏原始.title .sub，只显示克隆大字动画结束后的状态
const welcomeSub=document.querySelector('.title .sub');if(welcomeSub)welcomeSub.style.display='none'}
oldPage.classList.remove('active');oldPage.classList.add(direction==='right'?'slide-out-left':'slide-out-right');newPage.classList.remove('slide-out-left','slide-out-right');newPage.classList.add('active');idx=next;render();if(newPage.dataset.name==='视频监控'&&typeof fetchAiStats==='function'){setTimeout(fetchAiStats,100)}setTimeout(()=>{oldPage.classList.remove('slide-out-left','slide-out-right');switching=false},550)}catch(e){console.error('[ParkOps] 翻页出错:',e);switching=false}finally{setTimeout(()=>{if(switching){switching=false;console.warn('[ParkOps] 翻页超时保护: switching已强制重置')}},2000)}}document.getElementById('prev').onclick=()=>go(idx-1);document.getElementById('next').onclick=()=>go(idx+1);document.addEventListener('keydown',e=>{const target=e.target;if(e.defaultPrevented||e.isComposing||document.body.classList.contains('park-editing')||(target instanceof Element&&target.closest('input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),.park-editor-shell')))return;if(e.key==='ArrowLeft')go(idx-1);if(e.key==='ArrowRight'||e.key===' '){e.preventDefault();go(idx+1)}});
document.getElementById('auto').onclick=function(){if(timer){clearInterval(timer);timer=null;this.textContent='自动轮播：关';this.classList.remove('on')}else{timer=setInterval(()=>go(idx+1),12000);this.textContent='自动轮播：开';this.classList.add('on')}};render();
// 初始化：欢迎页隐藏标题栏欢迎小字，其他页面显示
(function initWelcomeSub(){const currentPage=document.querySelector('.page.active');const welcomeSub=document.querySelector('.title .sub');const hasClone=document.querySelectorAll('.welcome-clone').length>0;if(welcomeSub){if(currentPage&&currentPage.classList.contains('welcome-page')){welcomeSub.style.display='none'}else{welcomeSub.style.display=hasClone?'none':'block'}}})();

// 远程翻页控制 (PWA播放控制卡片 → 运营大屏)
(function initRemoteControl(){
  let lastPage = idx;
  let lastAuto = !!timer;
  let lastRefreshTs = 0;
  async function poll(){
    try{
      const r = await fetch('/api/park-ops-control/state?consumeRefresh=true',{cache:'no-store'});
      const j = await r.json();
      if(!j.success||!j.data)return;
      const {page, autoPlay, refreshRequested, refreshTimestamp} = j.data;
      // 检测强制刷新指令
      if(refreshRequested && refreshTimestamp && refreshTimestamp !== lastRefreshTs){
        lastRefreshTs = refreshTimestamp;
        // 延迟500ms执行刷新，确保API响应返回后再刷新
        setTimeout(()=>{ window.location.reload(true); }, 500);
        return;
      }
      if(page !== lastPage){ lastPage = page; go(page); }
      if(autoPlay !== lastAuto){
        lastAuto = autoPlay;
        const btn = document.getElementById('auto');
        if(autoPlay && !timer){ timer=setInterval(()=>go(idx+1),12000); if(btn){btn.textContent='自动轮播：开';btn.classList.add('on');} }
        else if(!autoPlay && timer){ clearInterval(timer); timer=null; if(btn){btn.textContent='自动轮播：关';btn.classList.remove('on');} }
      }
    }catch(e){/* 网络异常时静默, 不影响本地操作 */}
  }
  setInterval(poll, 500);
})();
// 低功耗模式不启动全屏粒子 canvas；保留节点只为兼容旧版样式和校准器选择器。
document.getElementById('ambient').hidden=true;
// 系统品牌信息：欢迎称谓 + 来访者上墙照片，5s 轮询，照片换新/撤下即时生效
(function initBranding(){
  const API='http://localhost:3200';
  const app=document.getElementById('app');
  const qrBox=document.getElementById('welcomeQrBox');
  const qrLayer=document.getElementById('welcomeQr');
  let hasPhoto=false;
  const activeIsWelcome=()=>!!document.querySelector('.page.welcome-page.active');
  // 设计坐标系(3612x1462)内按原图比例放到最大, 框随图、不裁切不变形;
  // 聚焦(隐藏KPI、舞台增高)时可用空间更大, 照片同步放大
  function fitImg(img){
    const nw=img.naturalWidth,nh=img.naturalHeight; if(!nw||!nh)return;
    const focus=!!app&&app.classList.contains('photo-focus');
    const MAXW=focus?2360:2000, MAXH=focus?1050:860;
    let w=MAXW,h=(w*nh)/nw;
    if(h>MAXH){h=MAXH;w=(h*nw)/nh;}
    img.style.width=Math.round(w)+'px'; img.style.height=Math.round(h)+'px';
  }
  function applyFocus(){
    if(!app)return;
    const on=hasPhoto&&activeIsWelcome();
    const changed=app.classList.contains('photo-focus')!==on;
    app.classList.toggle('photo-focus',on);
    if(changed){const img=document.getElementById('welcomePhotoImg');if(img&&img.naturalWidth)fitImg(img);}
  }
  // 二维码内容用手机可达的局域网绝对地址(后端 serverOrigin), 永远指向"当前那张"
  function renderQr(text){
    if(!qrBox||!qrLayer)return;
    if(!text||!window.qrcode){qrLayer.hidden=true;return;}
    if(qrBox.dataset.text!==text){
      try{
        const q=window.qrcode(0,'M'); q.addData(text); q.make();
        qrBox.innerHTML=q.createSvgTag({cellSize:2,margin:1,scalable:true});
        qrBox.dataset.text=text;
      }catch{qrLayer.hidden=true;return;}
    }
    qrLayer.hidden=false;
  }
  async function syncBranding(){
    try{
      const r=await fetch(API+'/api/system-branding',{cache:'no-store'});
      const j=await r.json(); const d=j?.data||{};
      const g=(d.welcomeGuest||'').trim();
      const line=document.getElementById('welcomeLine');
      if(g&&line) line.textContent=`热烈欢迎 ${g} 莅临检查指导`;
      const wp=document.querySelector('.welcome-page');
      const box=document.getElementById('welcomePhoto');
      const img=document.getElementById('welcomePhotoImg');
      if(!wp||!box||!img) return;
      let url=d.welcomePhotoUrl||'';
      hasPhoto=!!url;
      if(url){
        if(!/^https?:/i.test(url)) url=API+url;
        img.onload=()=>fitImg(img);
        if(img.dataset.src!==url){ img.dataset.src=url; img.src=url; }
        fitImg(img);
        box.hidden=false; wp.classList.add('has-photo');
        img.onerror=()=>{ box.hidden=true; if(qrLayer)qrLayer.hidden=true; wp.classList.remove('has-photo'); hasPhoto=false; applyFocus(); img.dataset.src=''; };
        renderQr((d.serverOrigin||API)+'/api/system-branding/welcome-photo/file');
      }else{
        box.hidden=true; wp.classList.remove('has-photo'); img.removeAttribute('src'); img.dataset.src='';
        if(qrLayer) qrLayer.hidden=true;
      }
      applyFocus();
    }catch{/* 后端未就绪时静默, 保持默认欢迎布局 */}
  }
  // 任意翻页方式(按钮/自动轮播/远程 goto)切换 active 页都重新评估聚焦布局
  const stage=document.querySelector('.stage');
  if(stage&&window.MutationObserver){new MutationObserver(applyFocus).observe(stage,{subtree:true,attributes:true,attributeFilter:['class']});}
  syncBranding(); setInterval(syncBranding,5000);
})();
// 明日摄像头接入预留：把 HLS/WebRTC/厂商 SDK 地址映射到 CAM-001/018/043/067 即可。
window.PARK_DEMO={version:'2026-09-08-camera-hotfix',resolution:'3612x1462',phases:['一期','二期','远期'],buildingCount:buildings.length,cameraSlots:['CAM-001','CAM-018','CAM-043','CAM-067']};
window.PARK_RUNTIME={get buildings(){return buildings},set buildings(value){buildings=value;renderBuildings()},renderBuildings,selectBuilding,fit,config:null};

// 摄像头HLS流畅视频流
(function initCameraHls(){
  const cams=document.querySelectorAll('.cam-hls[data-camera]');
  if(!cams.length)return;

  const API_BASE='/api/cameras';
  const hlsInstances=new Map();

  async function startHlsStream(channel){
    try{
      const response=await fetch(`${API_BASE}/${channel}/hls/start`,{method:'POST'});
      const data=await response.json();
      return data.success?data.data:null;
    }catch(e){
      console.warn(`[ParkOps] 启动HLS转码失败 (${channel}):`,e.message);
      return null;
    }
  }

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

    // 15秒超时处理：如果视频未成功播放，显示"信号中断"状态
    const connectTimeout=setTimeout(()=>{
      if(video.readyState<2||video.videoWidth===0){
        console.warn(`[ParkOps] HLS连接超时 (${channel})，显示信号中断`);
        if(mock){mock.textContent=`${name} · 信号中断`;mock.style.display='block';mock.classList.add('signal-lost')}
        if(video)video.style.display='none';
        const liveEl=cam.querySelector('.live');
        if(liveEl){liveEl.classList.add('live-offline');liveEl.innerHTML='<span class="live-indicator" style="background:#ef4444;box-shadow:0 0 8px rgba(239,68,68,.8)"></span>OFFLINE'}
      }
    },15000);

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

      hls.loadSource(playlistUrl);
      hls.attachMedia(video);

      hls.on(window.Hls.Events.MANIFEST_PARSED,()=>{
        video.play().catch(()=>{});
        // 持续检测5秒，确保视频稳定播放（防止浏览器自动播放策略暂停）
        let playCheckCount=0;
        const playCheck=setInterval(()=>{
          playCheckCount++;
          if(video.paused&&video.readyState>=2){
            video.play().catch(()=>{});
          }
          if(playCheckCount>=10||(!video.paused&&video.currentTime>0)){
            clearInterval(playCheck);
          }
        },500);
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

      video.addEventListener('playing',()=>{
        clearTimeout(connectTimeout);
        video.style.display='block';
        if(mock){mock.style.display='none';mock.classList.remove('signal-lost')}
        const liveEl=cam.querySelector('.live');
        if(liveEl){liveEl.classList.remove('live-offline');liveEl.innerHTML='<span class="live-indicator"></span>LIVE'}
      });

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
    const allCams=document.querySelectorAll('.cam-hls[data-camera]');
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
            // 如果播放失败，重新初始化HLS
            const hls=hlsInstances.get(channel);
            if(hls){
              try{
                hls.destroy();
              }catch(e){}
              hlsInstances.delete(channel);
            }
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
  const AI_API_BASE='http://localhost:8000';
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
      const response=await fetch(`${AI_API_BASE}/api/stats`,{
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

  async function fetchAiDetections(){
    // 只在视频监控页激活时获取检测数据
    const videoPage=document.querySelector('[data-name="视频监控"].active');
    if(!videoPage) return;

    // 防抖：避免并发请求
    if(aiDetFetching) return;
    const now=Date.now();
    if(now-aiDetLastTime<AI_DET_INTERVAL*0.8) return;
    aiDetFetching=true;
    aiDetLastTime=now;

    try{
      const controller=new AbortController();
      const timeoutId=setTimeout(()=>controller.abort(),AI_DET_TIMEOUT);
      const response=await fetch(`${AI_API_BASE}/api/detections`,{
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
    const camEl=document.querySelector(`.cam[data-camera="${camId}"]`);
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

  // 页面卸载时清理
  window.addEventListener('beforeunload',()=>{
    hlsInstances.forEach(hls=>hls.destroy());
  });

  // 暴露全局函数，供ops-content.js动态生成视频元素后调用（第一页4路安防画面）
  window.startHlsTranscoding = startHlsStream;
  window.initHlsPlayer = initHlsPlayer;
})();
