// live.js — 3D 实时底座（正式：加载真实 GLB park_lite_draco + 稳定性缰绳 + 宿主通信）
// 真实材质自足（keepmat 已验证）：直接 GLTFLoader + Draco 加载，不做 JS 材质替换。
// 仅在真实 GLB 加载并取景完成后才 park-twin-ready；失败/超时由宿主回退静态鸟瞰。
// 调试：?hud=1 显示HUD；?force-level=L1|L2 指定档位。
import * as THREE from 'three';
import { GLTFLoader } from 'gltf-loader';
import { DRACOLoader } from 'draco-loader';
import { Sky } from 'sky';
import { StabilityReins, LEVELS, levelName } from './reins.js';
import { createBuildingLayer, BUILDINGS } from './buildings.js';
import { createAnnotations } from './annotations.js';
import { createGreening } from './greening.js';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('liveStage');
const note = document.getElementById('liveNote');
const hud = document.getElementById('liveHud');
const hudFps = document.getElementById('hudFps');
const hudLevel = document.getElementById('hudLevel');
const hudState = document.getElementById('hudState');
if (params.get('hud') === '1') hud.hidden = false;

// ---------- 外观配置表（集中管理：改这里的值即可，无需重新审计）----------
// ?look=v1 默认（已达标底座）；?look=v2 对标地产高保真 showcase 的氛围增强。
const LOOK = params.get('look') || 'v1';
const LOOKS = {
  v1: {
    exposure: 1.12, env: 0.12, hemi: 0.15, sun: 3.0,
    sunPos: { elev: 35, azim: 350 },
    hemiColor: { sky: 0xfdf2e0, ground: 0x6a7058 }, sunColor: 0xffe8c0,
    sky: { turbidity: 10, rayleigh: 0.3, mie: 0.002, g: 0.8 },
    fog: { color: 0xe9e7e0, near: 1050, far: 2300 },
  },
  v2: {
    exposure: 1.04, env: 0.55, hemi: 0.38, sun: 2.7,
    sunPos: { elev: 35, azim: 350 },
    hemiColor: { sky: 0xfdf2e0, ground: 0x6a7058 }, sunColor: 0xffe8c0,
    sky: { turbidity: 6, rayleigh: 1.35, mie: 0.005, g: 0.85 },
    fog: { color: 0xe4e8ea, near: 1050, far: 2300 },
    // 材质微调（key 支持材质名前缀；color 为 tint，与原贴图相乘，不替换贴图）
    materials: {
      'Display asphalt':         { color: 0x484b4f, roughness: 0.95 },
      'Display lawn':            { map: '../assets/textures/grass.jpg', worldTile: 10, color: 0xa8c09f, roughness: 1.0 },
      'Display outer ground':    { color: 0x9b9484 },
      'Display water':           { color: 0x3a6480, roughness: 0.12, metalness: 0.0 },
      'cw_glass':                { roughness: 0.05, metalness: 0.0 },
      'JZ-玻璃-主':              { roughness: 0.06 },
      'JZ-玻璃-栏杆':            { roughness: 0.08 },
      'cw_roof':                 { color: 0xc9c6bd },
      'JZ-顶板':                 { color: 0xcfcabf },
    },
  },
  // v3：对标原鸟瞰 park-aerial.jpg —— 黄金时刻暖侧光、暖白墙面、深灰沥青、亮蓝水景、暗周边
  v3: {
    exposure: 1.1, env: 0.27, hemi: 0.17, sun: 3.5,
    sunPos: { elev: 26, azim: 95 },
    hemiColor: { sky: 0xd8e4f4, ground: 0x554b3a }, sunColor: 0xffe6bf,
    sky: { turbidity: 8, rayleigh: 1.0, mie: 0.004, g: 0.88 },
    fog: { color: 0xdfe5e9, near: 1050, far: 2300 },
    materials: {
      'Display asphalt':            { color: 0x2f3235, roughness: 0.96 },
      'Display lawn':               { map: '../assets/textures/grass.jpg', worldTile: 10, color: 0xa8c09f, roughness: 1.0 },
      'Display outer ground':       { map: '../assets/textures/forest.jpg', worldTile: 42, color: 0xffffff, roughness: 1.0 },
      'Display water':              { color: 0x4a80a8, roughness: 0.1, metalness: 0.0 },
      'Display context buildings':  { color: 0x5c6066 },
      'JZ-白色':                    { color: 0xf6f1e8, roughness: 0.78 },
      'JZ-白色条':                  { color: 0xede7db, roughness: 0.8 },
      'JZ-装饰线-BAI':              { color: 0xf4efe6 },
      'cw_roof':                    { color: 0xb8b2a9 },
      'JZ-顶板':                    { color: 0xbdb7ae },
      'cw_plinth':                  { color: 0xd8d2c6 },
      'cw_parapet':                 { color: 0xeee8dc },
      'cw_glass':                   { color: 0xb6c6d6, roughness: 0.05, metalness: 0.0 },
      'JZ-玻璃-主':                 { color: 0x5d7184, roughness: 0.08 },
      'JZ-玻璃-栏杆':               { color: 0xb8c8d8, roughness: 0.08 },
    },
  },
};
const LK = LOOKS[LOOK] || LOOKS.v1;
const _texLoader = new THREE.TextureLoader();
// 按顶点【世界坐标】重算 UV：合批后不同地块原 UV 尺度不一（世界尺度 / 0-1），
// 统一改为每 tile 世界单位平铺一张贴图，密度与颜色对所有地块一致（草坪均为 XZ 水平面）。
function retileByWorld(mesh, tile) {
  const geo = mesh.geometry, pos = geo.attributes.position, m = mesh.matrixWorld;
  const v = new THREE.Vector3();
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    uv[i * 2] = v.x / tile;
    uv[i * 2 + 1] = v.z / tile;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function tweakFor(name, map) {
  let best = null;
  for (const k of Object.keys(map)) {
    if (name === k || name.startsWith(k)) { if (!best || k.length > best.length) best = k; }
  }
  return best ? map[best] : null;
}
function applyMaterialTweaks(g, map) {
  if (!map) return;
  g.traverse((o) => {
    if (!o.isMesh) return;
    [].concat(o.material).forEach((m) => {
      const t = tweakFor(m.name, map);
      if (!t) return;
      if (t.color !== undefined) m.color.set(t.color);
      if (t.roughness !== undefined) m.roughness = t.roughness;
      if (t.metalness !== undefined) m.metalness = t.metalness;
      if (t.worldTile) retileByWorld(o, t.worldTile);
      if (t.map) {
        _texLoader.load(t.map, (tex) => {
          tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
          tex.repeat.set((t.repeat && t.repeat[0]) || 1, (t.repeat && t.repeat[1]) || 1);
          tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
          m.map = tex; m.needsUpdate = true;
        });
      } else m.needsUpdate = true;
    });
  });
}

// 必须保持双面的薄片材质（玻璃/栏杆/格栅/百叶/幕墙杆件等，无体积厚度、两面都可能可见）
const KEEP_DOUBLE_SIDE = /玻璃|glass|栏杆|railing|格栅|grating|百叶|louvers|mull|cw_grid|truss/i;
// 封闭实体（墙体/地面/道路/金属板等）背面永不可见，改单面渲染可省一半顶点；
// 若减面导致个别面法线翻转/破洞，真机截图核对后，命中破损的材质名加入 KEEP_DOUBLE_SIDE。
function applySideOptimization(g) {
  let front = 0, kept = 0;
  g.traverse((o) => {
    if (!o.isMesh) return;
    [].concat(o.material).forEach((m) => {
      if (m.transparent) { kept++; return; }              // 透明（玻璃）保持双面
      if (KEEP_DOUBLE_SIDE.test(m.name)) { kept++; return; } // 薄片保持双面
      if (m.side === THREE.DoubleSide) { m.side = THREE.FrontSide; m.needsUpdate = true; front++; }
    });
  });
  window.__sideOpt = { front, kept };
}
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

// ---------- 渲染器：ACES 色调映射 + 软阴影 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', stencil: false });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = LK.exposure;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);

const scene = new THREE.Scene();
if (LK.fog) scene.fog = new THREE.Fog(LK.fog.color, LK.fog.near, LK.fog.far);
const camera = new THREE.PerspectiveCamera(31, 1, 1, 5500);
const TARGET = new THREE.Vector3();

// ---------- 大气天空 + 太阳 ----------
const sun = new THREE.Vector3();
sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - LK.sunPos.elev), THREE.MathUtils.degToRad(LK.sunPos.azim));
const sky = new Sky(); sky.scale.setScalar(3800);
const su = sky.material.uniforms;
su.turbidity.value = LK.sky.turbidity; su.rayleigh.value = LK.sky.rayleigh; su.mieCoefficient.value = LK.sky.mie;
su.mieDirectionalG.value = LK.sky.g; su.sunPosition.value.copy(sun);
scene.add(sky);

// ---------- 灯光：太阳方向光（投影）+ 半球填充 ----------
const hemi = new THREE.HemisphereLight(LK.hemiColor.sky, LK.hemiColor.ground, LK.hemi); scene.add(hemi);
const dir = new THREE.DirectionalLight(LK.sunColor, LK.sun);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.bias = -0.0004; dir.shadow.normalBias = 0.08;
scene.add(dir); scene.add(dir.target);

// ---------- 环境反射：天空 PMREM ----------
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(scene, 0.04, 1, 30000).texture;
scene.environmentIntensity = LK.env;

// ---------- 加载占位（深色地面），GLB 成功后移除 ----------
const placeholder = new THREE.Group();
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshStandardMaterial({ color: 0x101d2e, roughness: 0.96 })
);
ground.rotation.x = -Math.PI / 2;
placeholder.add(ground);
scene.add(placeholder);

// ---------- 轨道交互（拖拽 / 滚轮 / 阻尼 / 空闲巡游） ----------
const orbit = {
  theta: -0.7555, phi: 0.83, radius: 900,
  tTheta: -0.7555, tPhi: 0.83, tRadius: 900,
  min: 60, max: 5000,
  dragging: false, lastX: 0, lastY: 0, lastInteract: performance.now(),
};
const el = renderer.domElement;
el.addEventListener('pointerdown', (e) => {
  orbit.dragging = true; orbit.lastX = e.clientX; orbit.lastY = e.clientY;
  orbit.downX = e.clientX; orbit.downY = e.clientY;
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
el.addEventListener('pointerup', (e) => {
  const moved = Math.hypot(e.clientX - orbit.downX, e.clientY - orbit.downY);
  orbit.dragging = false;
  if (moved < 6) {
    if (annotations && annotations.handleClick(e.clientX, e.clientY)) return;
    if (bldLayer) bldLayer.select(bldLayer.pickAt(e.clientX, e.clientY));
  }
});
el.addEventListener('pointercancel', () => { orbit.dragging = false; });
el.addEventListener('wheel', (e) => {
  orbit.tRadius *= 1 + Math.sign(e.deltaY) * 0.08;
  orbit.tRadius = Math.max(orbit.min, Math.min(orbit.max, orbit.tRadius));
  orbit.lastInteract = performance.now();
}, { passive: true });

function updateOrbit(dt, now) {
  // 空闲 120s 后缓慢自转
  if (!orbit.dragging && now - orbit.lastInteract > 120000) orbit.tTheta += dt * 0.03;
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
    // L2：请宿主切静态鸟瞰；viewer 停止渲染循环
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
let bldLayer = null, annotations = null;
const reins = new StabilityReins(renderer, { embedded: params.get('embedded') === '1' });
window.__reins = reins; window.__renderer = renderer; window.__camera = camera; window.THREE = THREE; window.__scene = scene;
reins.onFrame = (dt, now) => {
  updateOrbit(dt, now);
  if (bldLayer) bldLayer.update();
  if (annotations) annotations.update();
  renderer.render(scene, camera);
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

// ---------- ready：真实 GLB 取景完成后才发 ----------
let readySent = false;
function sendReady() {
  if (readySent) return;
  readySent = true;
  reins.setGraceMs(9000); // 首屏展示后再给9s预热，避免启动期低帧误降级到L2撤下
  note.classList.add('hidden');
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererStr = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  parent.postMessage({
    type: 'park-twin-ready', app: 'live', ts: Date.now(),
    renderer: rendererStr, level: 'L0',
    capabilities: { maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) },
  }, '*');
}

// ---------- 加载真实 GLB ----------
const draco = new DRACOLoader(); draco.setDecoderPath('../../vendor/draco/gltf/');
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
function onLoaded(gltf) {
  window.__glbReadyMs = Math.round(performance.now()); // 传输+Draco解码+场景构建完成（首帧前）
  const g = gltf.scene; window.__g = g;
  try {
  window.__step = 'add';
  scene.add(g);
  g.updateWorldMatrix(true, true); // 一次性更新全园世界矩阵，避免 localToWorld 反复向上递归
  applyMaterialTweaks(g, LK.materials); // 外观配置表 v2 的材质微调（v1 为空、跳过）
  applySideOptimization(g);             // 封闭实体改单面渲染（玻璃/薄片保持双面），省顶点
  // 周边 context 灰盒（简陋占位）：无条件压暗为远景剪影，避免中灰方块抢戏
  g.traverse((o) => {
    if (!o.isMesh) return;
    const mn = ([].concat(o.material)[0] || {}).name || '';
    if (/context buildings/.test(mn)) [].concat(o.material).forEach((m) => { m.color.set(0x33383e); m.roughness = 1; m.metalness = 0; });
  });
  // 取景：只按真实建筑核心（JZ / cw / T_cw），排除 context / 道路
  const core = new THREE.Box3();
  window.__step = 'traverse';
  g.traverse((o) => {
    if (!o.isMesh) return;
    const mn = ([].concat(o.material)[0] && [].concat(o.material)[0].name) || '';
    if (!/^(JZ-|cw_|T_cw)/.test(mn)) return;
    if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
    const b = o.geometry.boundingBox;
    core.expandByPoint(b.min.clone().applyMatrix4(o.matrixWorld));
    core.expandByPoint(b.max.clone().applyMatrix4(o.matrixWorld));
  });
  window.__step = 'traversed';
  const size = core.getSize(new THREE.Vector3()); core.getCenter(TARGET);
  const base = Math.max(size.x, size.z);
  orbit.radius = orbit.tRadius = base * 1.15;
  orbit.min = base * 0.1; orbit.max = base * 3;
  // 太阳阴影锥覆盖整个场景
  window.__step = 'box';
  const gbox = new THREE.Box3().setFromObject(g);
  window.__step = 'boxed';
  const gsize = gbox.getSize(new THREE.Vector3()); const gspan = gsize.length();
  const gc = gbox.getCenter(new THREE.Vector3());
  const half = Math.max(gsize.x, gsize.z) * 0.5, c = dir.shadow.camera;
  c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 1; c.far = gspan * 2.2;
  c.updateProjectionMatrix();
  dir.target.position.copy(gc);
  dir.position.copy(gc).addScaledVector(sun, gspan * 1.3);
  // 移除占位
  window.__step = 'ready';
  scene.remove(placeholder);
  const bldOpts = {
    getCompany: (id) => (annotations ? annotations.getCompany(id) : ''),
    onSelect: (slot, b) => { if (annotations) annotations.onSelect(slot, b); },
  };
  bldLayer = createBuildingLayer(scene, camera, renderer, bldOpts); // S1 楼栋标签/点击/信息卡
  window.__bldLayer = bldLayer;
  annotations = createAnnotations({ scene, camera, renderer, bldLayer }); // 标注编辑：企业名+自定义文字
  window.__annotations = annotations;
  bldLayer.refreshLabels(); // annotations 晚于标签创建，补刷新使已存企业名生效
  const greening = createGreening(scene, BUILDINGS);
  window.__greeningCtl = greening;
  greening.whenReady && greening.whenReady.then(() => reins.renderOnce());
  const _gof = reins.onFrame;
  reins.onFrame = function (dt, now) { greening.update(camera); _gof(dt, now); };
  sendReady();
  window.__step = 'done';
  } catch (err) {
    window.__onloadErr = (err.message || String(err)) + ' | ' + ((err.stack || '').split('\n')[1] || '');
    fail('取景初始化失败：' + (err.message || err));
  }
}
loader.load('../assets/park_lite_draco.glb', onLoaded,
  (ev) => { if (ev.total) note.textContent = `模型加载中 ${Math.round(ev.loaded / ev.total * 100)}%`; },
  () => fail('真实模型加载失败，已请求静态兜底'));

// ---------- 心跳 ----------
setInterval(() => {
  parent.postMessage({
    type: 'park-twin-heartbeat', app: 'live', ts: Date.now(),
    fps: Math.round(reins._fps), level: levelName(reins.level), state: reins.state,
  }, '*');
}, 5000);

// ---------- 日/夜光照（基础） ----------
function applyLighting(mode) {
  if (mode === 'night') {
    sky.visible = false;
    scene.background = new THREE.Color(0x05080f);
    hemi.intensity = 0.08; dir.intensity = 0.6;
    renderer.toneMappingExposure = 0.9;
  } else {
    sky.visible = true;
    scene.background = null;
    hemi.intensity = LK.hemi; dir.intensity = LK.sun;
    renderer.toneMappingExposure = LK.exposure;
  }
}

// ---------- 宿主通信 ----------
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
