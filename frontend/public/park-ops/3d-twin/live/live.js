// live.js — 3D 实时底座（P0 占位场景 + 缰绳接入 + 宿主通信）
// 零外部资产：程序化 low-poly 园区占位；P1 再替换为 3ds Max→glTF 的正式 GLB。
// 验证钩子（不影响默认）：?hud=1 显示调试HUD；?load=heavy 高负载触发自动降级；?force-level=L1|L2 指定档位。
import * as THREE from 'three';
import { StabilityReins, LEVELS, levelName } from './reins.js';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('liveStage');
const note = document.getElementById('liveNote');
const hud = document.getElementById('liveHud');
const hudFps = document.getElementById('hudFps');
const hudLevel = document.getElementById('hudLevel');
const hudState = document.getElementById('hudState');
if (params.get('hud') === '1') hud.hidden = false;

function detectWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}
function fail(msg) {
  note.textContent = msg;
  note.classList.remove('hidden');
  parent.postMessage({ type: 'park-twin-error', app: 'live', ts: Date.now(), error: msg }, '*');
}
if (!detectWebGL()) { fail('当前环境不支持 WebGL，已请求静态兜底'); throw new Error('webgl-unavailable'); }

// ---------- 渲染器 / 场景 / 相机 ----------
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power', stencil: false });
stage.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0a1626);
scene.fog = new THREE.Fog(0x0a1626, 160, 340);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
const TARGET = new THREE.Vector3(0, 6, 0);

// ---------- 灯光 ----------
const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x202833, 0.85);
scene.add(hemi);
const dir = new THREE.DirectionalLight(0xfff2d8, 1.6);
dir.position.set(60, 90, 40);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.camera.left = -120; dir.shadow.camera.right = 120;
dir.shadow.camera.top = 120; dir.shadow.camera.bottom = -120;
dir.shadow.camera.near = 1; dir.shadow.camera.far = 280;
dir.shadow.bias = -0.0004;
scene.add(dir);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---------- 地面 / 网格 ----------
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(240, 240),
  new THREE.MeshStandardMaterial({ color: 0x101d2e, roughness: 0.96, metalness: 0 })
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
const grid = new THREE.GridHelper(240, 48, 0x23476b, 0x16304a);
grid.material.transparent = true; grid.material.opacity = 0.55;
scene.add(grid);

// ---------- 楼栋占位 ----------
const buildingGroup = new THREE.Group();
scene.add(buildingGroup);
function buildBuildings() {
  if (params.get('load') === 'heavy') {
    // 压力场景：约 1100 栋独立 draw call，超 200–300 预算，用于在弱机/核显上触发 L0→L1→L2。
    // 注：P1 正式场景将以 InstancedMesh/LOD 把 draw call 压回预算，而非靠降级兜底。
    const n = 34, span = 200, step = span / n;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      if (Math.random() < 0.18) continue;
      const h = 4 + Math.random() * 26;
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.57 + Math.random() * 0.09, 0.45, 0.3 + Math.random() * 0.2),
        roughness: 0.85, metalness: 0.05,
      });
      const m = new THREE.Mesh(geo, mat);
      m.scale.set(step * 0.7, h, step * 0.7);
      m.position.set(-span / 2 + i * step + step / 2, h / 2, -span / 2 + j * step + step / 2);
      m.castShadow = true; m.receiveShadow = true;
      buildingGroup.add(m);
    }
    return;
  }
  const groups = [
    { x: -38, z: -22, n: 6, color: 0x2f6fb0 },
    { x: 32, z: -26, n: 5, color: 0x2e9c8f },
    { x: -6, z: 32, n: 7, color: 0x4a6bb5 },
    { x: 42, z: 26, n: 4, color: 0x7a5fb0 },
  ];
  groups.forEach((g) => {
    for (let k = 0; k < g.n; k++) {
      const col = k % 3, row = Math.floor(k / 3);
      const w = 7 + Math.random() * 5, d = 7 + Math.random() * 5, h = 10 + Math.random() * 26;
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: g.color, roughness: 0.8, metalness: 0.12 })
      );
      m.position.set(g.x + (col - 1) * 11 + Math.random() * 2, h / 2, g.z + (row - 1) * 11 + Math.random() * 2);
      m.castShadow = true; m.receiveShadow = true;
      buildingGroup.add(m);
    }
  });
}
buildBuildings();

// ---------- 光照预设（日/夜/黄昏） ----------
const LIGHT_PRESETS = {
  day:   { bg: 0x0a1626, hemi: 0.85, sky: 0xbfd8ff, ground2: 0x202833, dir: 1.6, dcol: 0xfff2d8, pos: [60, 90, 40] },
  dusk:  { bg: 0x1a1220, hemi: 0.5,  sky: 0xffb07a, ground2: 0x181018, dir: 1.1, dcol: 0xff8a4d, pos: [70, 28, 30] },
  night: { bg: 0x05080f, hemi: 0.28, sky: 0x3a5a8a, ground2: 0x05070b, dir: 0.5, dcol: 0x9fc0ff, pos: [-40, 80, -30] },
};
function applyLighting(mode) {
  const p = LIGHT_PRESETS[mode] || LIGHT_PRESETS.day;
  scene.background.set(p.bg);
  scene.fog.color.set(p.bg);
  hemi.intensity = p.hemi; hemi.color.set(p.sky); hemi.groundColor.set(p.ground2);
  dir.intensity = p.dir; dir.color.set(p.dcol); dir.position.set(...p.pos);
}

// ---------- 简易轨道交互（拖拽旋转 / 滚轮缩放 / 阻尼 / 空闲自动巡游） ----------
const orbit = {
  theta: 0.7, phi: 1.02, radius: 105,
  tTheta: 0.7, tPhi: 1.02, tRadius: 105,
  dragging: false, lastX: 0, lastY: 0, lastInteract: performance.now(),
};
const el = renderer.domElement;
el.addEventListener('pointerdown', (e) => {
  orbit.dragging = true; orbit.lastX = e.clientX; orbit.lastY = e.clientY;
  orbit.lastInteract = performance.now();
  el.setPointerCapture && el.setPointerCapture(e.pointerId);
});
el.addEventListener('pointermove', (e) => {
  if (!orbit.dragging) return;
  orbit.tTheta -= (e.clientX - orbit.lastX) * 0.005;
  orbit.tPhi -= (e.clientY - orbit.lastY) * 0.005;
  orbit.tPhi = Math.max(0.18, Math.min(1.45, orbit.tPhi));
  orbit.lastX = e.clientX; orbit.lastY = e.clientY;
  orbit.lastInteract = performance.now();
});
const endDrag = () => { orbit.dragging = false; };
el.addEventListener('pointerup', endDrag);
el.addEventListener('pointercancel', endDrag);
el.addEventListener('wheel', (e) => {
  orbit.tRadius *= 1 + Math.sign(e.deltaY) * 0.08;
  orbit.tRadius = Math.max(45, Math.min(190, orbit.tRadius));
  orbit.lastInteract = performance.now();
}, { passive: true });

function updateOrbit(dt, now) {
  // 空闲 8s 后缓慢自动巡游
  if (!orbit.dragging && now - orbit.lastInteract > 8000) orbit.tTheta += dt * 0.05;
  const k = 1 - Math.pow(0.0015, dt); // 阻尼
  orbit.theta += (orbit.tTheta - orbit.theta) * k;
  orbit.phi += (orbit.tPhi - orbit.phi) * k;
  orbit.radius += (orbit.tRadius - orbit.radius) * k;
  const sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
  camera.position.set(
    TARGET.x + orbit.radius * sp * Math.sin(orbit.theta),
    TARGET.y + orbit.radius * cp,
    TARGET.z + orbit.radius * sp * Math.cos(orbit.theta)
  );
  camera.lookAt(TARGET);
}

// ---------- 降级档画质 ----------
function applyLevel(level, reason, m = {}) {
  if (level === LEVELS.L0) {
    renderer.shadowMap.enabled = true;
    dir.castShadow = true;
  } else if (level === LEVELS.L1) {
    renderer.shadowMap.enabled = false; // L1：关阴影（最大单项开销之一）
    dir.castShadow = false;
  } else if (level === LEVELS.L2) {
    // L2：交给宿主切静态鸟瞰；viewer 冻结最后一帧、停止渲染循环
    parent.postMessage({ type: 'park-twin-degraded', app: 'live', ts: Date.now(), level: 'L2', reason, fps: m.fps }, '*');
    reins.stop();
    note.textContent = '实时渲染性能不足，已切回静态鸟瞰';
    note.classList.remove('hidden');
    return;
  }
  parent.postMessage({ type: 'park-twin-degraded', app: 'live', ts: Date.now(), level: levelName(level), reason, fps: m.fps }, '*');
  reins.renderOnce();
}

// ---------- 缰绳接入 ----------
const reins = new StabilityReins(renderer, { embedded: params.get('embedded') === '1' });
window.__reins = reins; // 调试探针（P0 验证用）
let readySent = false;
reins.onFrame = (dt, now) => {
  updateOrbit(dt, now);
  renderer.render(scene, camera);
  if (!readySent) sendReady();
};
reins.onLevelChange = applyLevel;
reins.onMetrics = (m) => {
  hudFps.innerHTML = '<b>' + m.fps + '</b> fps';
  hudLevel.textContent = levelName(m.level);
  hudState.textContent = m.state;
};

// ---------- 尺寸 ----------
function resize() {
  const w = stage.clientWidth || window.innerWidth;
  const h = stage.clientHeight || window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
resize();
new ResizeObserver(resize).observe(stage);
window.addEventListener('resize', resize);

reins.start();

// ---------- 宿主通信 ----------
const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const rendererStr = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

function sendReady() {
  readySent = true;
  note.classList.add('hidden');
  parent.postMessage({
    type: 'park-twin-ready', app: 'live', ts: Date.now(),
    renderer: rendererStr, level: 'L0',
    capabilities: { maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) },
  }, '*');
}
setInterval(() => {
  parent.postMessage({
    type: 'park-twin-heartbeat', app: 'live', ts: Date.now(),
    fps: Math.round(reins._fps), level: levelName(reins.level), state: reins.state,
  }, '*');
}, 5000);

window.addEventListener('message', (e) => {
  let d = e.data;
  if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
  if (!d || typeof d !== 'object') return;
  switch (d.type) {
    case 'park-twin-lighting':
      applyLighting(d.mode || d.lighting || d.value);
      reins.renderOnce();
      break;
    case 'park-twin-visibility':
      reins.setHostVisible(d.visible !== false);
      break;
  }
});

// ---------- 验证钩子：强制档位 ----------
const fl = params.get('force-level');
if (fl === 'L1' || fl === 'L2') {
  reins.level = fl === 'L1' ? LEVELS.L1 : LEVELS.L2;
  reins.applyDpr();
  applyLevel(reins.level, 'force', {});
}
