// 金湖园区 · 3D 数字孪生独立挂载器 (3d-twin)
// 口径: 仅在显式开关打开时替换 #parkMap 地图区; 默认关 = 静态鸟瞰/轻量3D。
// 任何加载失败/超时/崩溃自动撤下并回退静态鸟瞰; 不修改其它面板与设备状态文案。
const STORAGE_KEY = 'park-3d-twin';
const READY_TIMEOUT_MS = 8000;
const HEARTBEAT_TIMEOUT_MS = 12000;
const HEARTBEAT_CHECK_MS = 3000;

const params = new URLSearchParams(location.search);
const map = document.getElementById('parkMap');
if (!map) throw new Error('parkMap container not found');

const storage = {
  get() { try { return localStorage.getItem(STORAGE_KEY); } catch { return null; } },
  set(v) { try { localStorage.setItem(STORAGE_KEY, v); } catch { /* ignore */ } },
};
const isEnabled = () => params.get('twin') === '1' || storage.get() === '1';

let frame = null;
let cssLink = null;
let mounted = false;
let readyTimer = 0;
let heartbeatTimer = 0;
let lastHeard = 0;
let toggleBtn = null;

const send = (msg) => { try { frame?.contentWindow?.postMessage(msg, location.origin); } catch { /* ignore */ } };
const lightingValue = () => (document.body.dataset.scene === 'night' ? 'night' : 'day');

// 仅测试/调试: 用 ?twin-viewer=3d-twin/tests/xxx.html 覆盖 viewer 文档,
// 限定 3d-twin 目录内 .html (同源、不写存储、缺省仍是正式 viewer), 用于故障注入。
function resolveViewerUrl() {
  const override = params.get('twin-viewer');
  if (override && /^3d-twin\/[\w./-]+\.html(?:[?][\w=&.-]*)?$/.test(override)) {
    return new URL(override, new URL('../', import.meta.url)).href;
  }
  return new URL('./viewer/index.html?embedded=1', import.meta.url).href;
}

function teardown(reason) {
  if (!mounted) return;
  mounted = false;
  clearTimeout(readyTimer);
  clearInterval(heartbeatTimer);
  window.removeEventListener('message', onMessage);
  frame?.remove();
  frame = null;
  cssLink?.remove();
  cssLink = null;
  map.classList.remove('map-twin-active');
  map.dispatchEvent(new CustomEvent('park-twin-fallback', { detail: { reason } }));
  syncToggle();
}

function mount() {
  if (mounted) return;
  mounted = true;

  cssLink = document.createElement('link');
  cssLink.rel = 'stylesheet';
  cssLink.href = new URL('./bootstrap.css', import.meta.url).href;
  document.head.appendChild(cssLink);

  map.classList.add('map-twin-active');
  frame = document.createElement('iframe');
  frame.id = 'parkTwinFrame';
  frame.title = '园区数字孪生多视角';
  frame.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-downloads');
  frame.src = resolveViewerUrl();
  map.prepend(frame);

  lastHeard = Date.now();
  readyTimer = setTimeout(() => teardown('twin-ready-timeout'), READY_TIMEOUT_MS);
  heartbeatTimer = setInterval(() => {
    if (Date.now() - lastHeard > HEARTBEAT_TIMEOUT_MS) teardown('twin-heartbeat-timeout');
  }, HEARTBEAT_CHECK_MS);
  frame.addEventListener('error', () => teardown('twin-frame-error'));
  window.addEventListener('message', onMessage);
  syncToggle();
}

function onMessage(event) {
  if (event.origin !== location.origin || !frame || event.source !== frame.contentWindow) return;
  const type = event.data?.type;
  if (type === 'park-twin-ready') {
    clearTimeout(readyTimer);
    lastHeard = Date.now();
    send({ type: 'park-twin-lighting', value: lightingValue() });
  } else if (type === 'park-twin-state' || type === 'park-twin-heartbeat') {
    lastHeard = Date.now();
  }
}

// 日/夜光照同步
new MutationObserver(() => mounted && send({ type: 'park-twin-lighting', value: lightingValue() }))
  .observe(document.body, { attributes: true, attributeFilter: ['data-scene'] });

// 离开总览页 -> 通知 viewer
new IntersectionObserver((entries) => {
  send({ type: 'park-twin-visibility', visible: entries[0]?.isIntersecting === true });
}).observe(map);

// 手动开关（地图工具栏）
function buildToggle() {
  const toolbar = map.querySelector('.map-toolbar');
  if (!toolbar) return;
  const group = document.createElement('div');
  group.className = 'toolbar-group twin-toggle-group';
  toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.className = 'map-chip';
  toggleBtn.id = 'parkTwinToggle';
  toggleBtn.addEventListener('click', () => {
    if (mounted) { storage.set('0'); teardown('user-off'); }
    else { storage.set('1'); mount(); }
  });
  group.appendChild(toggleBtn);
  toolbar.appendChild(group);
  syncToggle();
}

function syncToggle() {
  if (!toggleBtn) return;
  toggleBtn.textContent = mounted ? '孪生 · 开' : '孪生 · 关';
  toggleBtn.classList.toggle('active', mounted);
}

function init() {
  buildToggle();
  if (isEnabled()) mount();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
