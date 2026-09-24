// model.js — 真实 GLB 真机加载验证（独立页，不动 P0 live）
// 测量：fps / draw calls / triangles / geometries / textures / programs / 加载耗时与体积 / renderer / DPR / 绘制分辨率
import * as THREE from 'three';
import { GLTFLoader } from 'gltf-loader';
import { DRACOLoader } from 'draco-loader';

const stage = document.getElementById('stage');
const note = document.getElementById('note');
const prog = document.getElementById('prog');
const hudBody = document.getElementById('hudBody');

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power', stencil: false });
stage.appendChild(renderer.domElement);
const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const rendererStr = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x93a9c0);
const camera = new THREE.PerspectiveCamera(50, 1, 1, 20000);

// ---------- 灯光 ----------
scene.add(new THREE.HemisphereLight(0xe2efff, 0x5a6350, 1.0));
scene.add(new THREE.AmbientLight(0xffffff, 0.22));
const dir = new THREE.DirectionalLight(0xfff4dd, 2.1);
dir.position.set(1, 1.5, 0.7);
scene.add(dir);

// ---------- 程序化环境反射（天→地渐变 equirect → PMREM） ----------
function makeEnv() {
  const w = 64, h = 32, d = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const t = y / (h - 1); // 0=top
    let r, g, b;
    if (t < 0.5) { const k = 1 - t * 2; r = 150 + 80 * k; g = 180 + 60 * k; b = 210 + 45 * k; }
    else { const k = (t - 0.5) * 2; r = 90 - 50 * k; g = 96 - 52 * k; b = 88 - 48 * k; }
    d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
  }
  const tex = new THREE.DataTexture(d, w, h, THREE.RGBAFormat);
  tex.mapping = THREE.EquirectangularReflectionMapping; tex.needsUpdate = true;
  return tex;
}
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromEquirectangular(makeEnv()).texture;

// ---------- 加载真实 GLB ----------
const TARGET = new THREE.Vector3();
const orbit = { theta: 0.85, phi: 1.02, radius: 900, tTheta: 0.85, tPhi: 1.02, tRadius: 900,
  min: 60, max: 4000, dragging: false, lastX: 0, lastY: 0, lastInteract: performance.now() };
let loaded = false, loadMs = 0, totalBytes = 0;

const draco = new DRACOLoader(); draco.setDecoderPath('../../vendor/draco/gltf/');
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
const t0 = performance.now();
loader.load('../assets/park.glb',
  (gltf) => {
    scene.add(gltf.scene);
    const box = new THREE.Box3().setFromObject(gltf.scene);
    const size = box.getSize(new THREE.Vector3()); box.getCenter(TARGET);
    const base = Math.max(size.x, size.z);
    orbit.radius = orbit.tRadius = base * 0.78; orbit.min = base * 0.1; orbit.max = base * 2.4;
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
  orbit.tPhi = Math.max(0.15, Math.min(1.5, orbit.tPhi));
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
  if (!orbit.dragging && now - orbit.lastInteract > 9000) orbit.tTheta += dt * 0.04;
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
    row('DPR', renderer.getPixelRatio()) +
    row('drawbuffer', `${dbuf.x}×${dbuf.y}`) +
    row('load', loadMs ? `${loadMs} ms` : '…') +
    row('glb size', totalBytes ? (totalBytes / 1048576).toFixed(2) + ' MB' : '…') +
    row('renderer', rendererStr.length > 30 ? rendererStr.slice(0, 30) + '…' : rendererStr);
}
loop();
