// model.js — 真实 GLB 真机加载 + 真实感渲染（独立页，不动 P0 live）
import * as THREE from 'three';
import { GLTFLoader } from 'gltf-loader';
import { DRACOLoader } from 'draco-loader';
import { Sky } from 'sky';

const stage = document.getElementById('stage');
const note = document.getElementById('note');
const prog = document.getElementById('prog');
const hudBody = document.getElementById('hudBody');

// ---------- 渲染器：ACES 色调映射 + 软阴影 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const rendererStr = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 1, 30000);

// ---------- 大气天空 + 太阳 ----------
const ELEV = 26, AZIM = 135;
const sun = new THREE.Vector3();
sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - ELEV), THREE.MathUtils.degToRad(AZIM));
const sky = new Sky(); sky.scale.setScalar(20000);
const su = sky.material.uniforms;
su.turbidity.value = 6; su.rayleigh.value = 1.1; su.mieCoefficient.value = 0.002;
su.mieDirectionalG.value = 0.8; su.sunPosition.value.copy(sun);
scene.add(sky);

// ---------- 灯光：太阳方向光（投影）+ 半球填充 ----------
const hemi = new THREE.HemisphereLight(0xdfeeff, 0x6a7058, 0.4); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xfff0d2, 2.2);
dir.castShadow = true;
dir.shadow.mapSize.set(4096, 4096);
dir.shadow.bias = -0.0003; dir.shadow.normalBias = 0.6;
scene.add(dir); scene.add(dir.target);

// ---------- 环境反射：由天空场景生成 PMREM（与太阳一致） ----------
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(scene, 0.04, 1, 30000).texture;

// ---------- 材质分类与预设 ----------
function classify(name) {
  if (/白线|黄线|标线|车道线/i.test(name)) return 'other';
  if (/玻璃|glass|gl(?![a-z])/i.test(name)) return 'glass';
  if (/水|water|湖|河|pool|lake|river|sea|湾/i.test(name)) return 'water';
  if (/铝|alu|铝板/i.test(name)) return 'alu';
  if (/草|grass|草坪|lawn|植草/i.test(name)) return 'grass';
  if (/道路|路|road|asphalt|铺地|pavement|地面|ground|outer/i.test(name)) return 'ground';
  if (/白|white|墙|wall|顶板/i.test(name)) return 'wall';
  return 'other';
}
const matCache = {};
function getMat(cls, orig) {
  if (matCache[cls]) return matCache[cls];
  let m;
  switch (cls) {
    case 'glass':
      m = new THREE.MeshPhysicalMaterial({ color: 0xc2dcea, metalness: 0, roughness: 0.06,
        envMapIntensity: 1.5, transparent: true, opacity: 0.36, side: THREE.DoubleSide, depthWrite: false }); break;
    case 'water':
      m = new THREE.MeshPhysicalMaterial({ color: 0x17607e, roughness: 0.08, metalness: 0,
        envMapIntensity: 1.7, transparent: true, opacity: 0.85, side: THREE.DoubleSide }); break;
    case 'alu':
      m = new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.34, envMapIntensity: 1.2 });
      if (orig && orig.color) m.color.copy(orig.color); break;
    case 'grass':
      m = new THREE.MeshStandardMaterial({ color: 0x6f9c57, roughness: 0.95, metalness: 0 }); break;
    case 'ground':
      m = new THREE.MeshStandardMaterial({ color: 0x8b8e93, roughness: 0.95, metalness: 0 }); break;
    case 'wall':
      m = new THREE.MeshStandardMaterial({ color: 0xeae7e0, roughness: 0.72, metalness: 0 }); break;
    default: m = orig;
  }
  matCache[cls] = m; return m;
}

// ---------- 加载真实 GLB ----------
const TARGET = new THREE.Vector3();
const orbit = { theta: 0.62, phi: 0.9, radius: 900, tTheta: 0.62, tPhi: 0.9, tRadius: 900,
  min: 60, max: 5000, dragging: false, lastX: 0, lastY: 0, lastInteract: performance.now() };
let loaded = false, loadMs = 0, totalBytes = 0;

const draco = new DRACOLoader(); draco.setDecoderPath('../../vendor/draco/gltf/');
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
const t0 = performance.now();
loader.load('../assets/park.glb',
  (gltf) => {
    const matLog = {};
    gltf.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const name = o.material.name || '';
      const cls = classify(name);
      matLog[name] = matLog[name] || { cls, n: 0 }; matLog[name].n++;
      if (cls !== 'other') o.material = getMat(cls, o.material);
      o.castShadow = (cls !== 'glass' && cls !== 'water');
      o.receiveShadow = true;
    });
    window.__mats = matLog;
    scene.add(gltf.scene);

    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()); box.getCenter(TARGET);
    const base = Math.max(size.x, size.z), span = size.length();
    orbit.radius = orbit.tRadius = base * 0.72; orbit.min = base * 0.08; orbit.max = base * 2.6;

    // 收紧太阳阴影锥到园区
    const half = base * 0.5, c = dir.shadow.camera;
    c.left = -half; c.right = half; c.top = half; c.bottom = half; c.near = 1; c.far = span * 2.2;
    c.updateProjectionMatrix();
    dir.target.position.copy(TARGET);
    dir.position.copy(TARGET).addScaledVector(sun, span * 1.3);

    loaded = true; loadMs = Math.round(performance.now() - t0);
    note.classList.add('hidden');
  },
  (ev) => {
    if (ev.total) totalBytes = ev.total;
    prog.textContent = ev.total
      ? `${Math.round(ev.loaded / ev.total * 100)}%  ${(ev.loaded / 1048576).toFixed(1)}/${(ev.total / 1048576).toFixed(1)} MB`
      : `${(ev.loaded / 1048576).toFixed(1)} MB`;
  },
  (err) => { note.querySelector('.note-main').textContent = '模型加载失败'; prog.textContent = String(err && err.message || err); }
);

// ---------- 轨道交互 ----------
const el = renderer.domElement;
el.addEventListener('pointerdown', (e) => {
  orbit.dragging = true; orbit.lastX = e.clientX; orbit.lastY = e.clientY;
  orbit.lastInteract = performance.now(); el.setPointerCapture && el.setPointerCapture(e.pointerId);
});
el.addEventListener('pointermove', (e) => {
  if (!orbit.dragging) return;
  orbit.tTheta -= (e.clientX - orbit.lastX) * 0.005;
  orbit.tPhi -= (e.clientY - orbit.lastY) * 0.005;
  orbit.tPhi = Math.max(0.12, Math.min(1.5, orbit.tPhi));
  orbit.lastX = e.clientX; orbit.lastY = e.clientY; orbit.lastInteract = performance.now();
});
const end = () => { orbit.dragging = false; };
el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
el.addEventListener('wheel', (e) => {
  orbit.tRadius *= 1 + Math.sign(e.deltaY) * 0.09;
  orbit.tRadius = Math.max(orbit.min, Math.min(orbit.max, orbit.tRadius));
  orbit.lastInteract = performance.now();
}, { passive: true });

function updateOrbit(dt, now) {
  if (!orbit.dragging && now - orbit.lastInteract > 12000) orbit.tTheta += dt * 0.03;
  const k = 1 - Math.pow(0.0015, dt);
  orbit.theta += (orbit.tTheta - orbit.theta) * k;
  orbit.phi += (orbit.tPhi - orbit.phi) * k;
  orbit.radius += (orbit.tRadius - orbit.radius) * k;
  const sp = Math.sin(orbit.phi), cp = Math.cos(orbit.phi);
  camera.position.set(
    TARGET.x + orbit.radius * sp * Math.sin(orbit.theta),
    TARGET.y + orbit.radius * cp,
    TARGET.z + orbit.radius * sp * Math.cos(orbit.theta));
  camera.lookAt(TARGET);
}

// ---------- 尺寸 ----------
function resize() {
  const w = stage.clientWidth || innerWidth, h = stage.clientHeight || innerHeight;
  renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
}
resize(); new ResizeObserver(resize).observe(stage); addEventListener('resize', resize);

// ---------- 渲染循环 + fps + HUD ----------
let frames = 0, fpsT = performance.now(), fps = 0, lastT = performance.now();
const dbuf = new THREE.Vector2();
function row(k, v, cls) { return `<tr><td class="k">${k}</td><td class="v ${cls || ''}">${v}</td></tr>`; }
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  frames++;
  if (now - fpsT >= 1000) { fps = Math.round(frames * 1000 / (now - fpsT)); frames = 0; fpsT = now; updateHud(); }
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  if (loaded) updateOrbit(dt, now);
  renderer.render(scene, camera);
}
function updateHud() {
  const info = renderer.info;
  renderer.getDrawingBufferSize(dbuf);
  const fpsCls = fps >= 24 ? 'ok' : fps >= 18 ? 'warn' : '';
  hudBody.innerHTML =
    row('fps', `<b>${fps}</b>`, fpsCls) +
    row('draw calls', info.render.calls) +
    row('triangles', info.render.triangles.toLocaleString()) +
    row('geometries', info.memory.geometries) +
    row('textures', info.memory.textures) +
    row('programs', info.programs.length) +
    row('sun', `${ELEV}°/${AZIM}°`) +
    row('DPR', renderer.getPixelRatio()) +
    row('drawbuffer', `${dbuf.x}×${dbuf.y}`) +
    row('load', loadMs ? `${loadMs} ms` : '…') +
    row('glb size', totalBytes ? (totalBytes / 1048576).toFixed(2) + ' MB' : '…') +
    row('renderer', rendererStr.length > 28 ? rendererStr.slice(0, 28) + '…' : rendererStr);
}
loop();
