// model.js — 真实 GLB 真机加载 + 真实感渲染（独立页，不动 P0 live）
import * as THREE from 'three';
window.THREE = THREE;
import { GLTFLoader } from 'gltf-loader';
import { DRACOLoader } from 'draco-loader';
import { Sky } from 'sky';
import { EffectComposer } from './addons/postprocessing/EffectComposer.js';
import { RenderPass } from './addons/postprocessing/RenderPass.js';
import { GTAOPass } from './addons/postprocessing/GTAOPass.js';
import { OutputPass } from './addons/postprocessing/OutputPass.js';

const stage = document.getElementById('stage');
const note = document.getElementById('note');
const prog = document.getElementById('prog');
const hudBody = document.getElementById('hudBody');

// ---------- 渲染器：ACES 色调映射 + 软阴影 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.12;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.appendChild(renderer.domElement);
const gl = renderer.getContext();
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
const rendererStr = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';

const scene = new THREE.Scene();
window.__scene = scene;
window.__renderer = renderer;
const camera = new THREE.PerspectiveCamera(31, 1, 1, 5500);

// ---------- 大气天空 + 太阳 ----------
const ELEV = 35, AZIM = 350;
const sun = new THREE.Vector3();
sun.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - ELEV), THREE.MathUtils.degToRad(AZIM));
const sky = new Sky(); sky.scale.setScalar(3800);
const su = sky.material.uniforms;
su.turbidity.value = 10; su.rayleigh.value = 0.3; su.mieCoefficient.value = 0.002;
su.mieDirectionalG.value = 0.8; su.sunPosition.value.copy(sun);
scene.add(sky);

// ---------- 灯光：太阳方向光（投影）+ 半球填充 ----------
const hemi = new THREE.HemisphereLight(0xfdf2e0, 0x6a7058, 0.15); scene.add(hemi);
const dir = new THREE.DirectionalLight(0xffe8c0, 3.0);
dir.castShadow = true;
dir.shadow.mapSize.set(2048, 2048);
dir.shadow.bias = -0.0004; dir.shadow.normalBias = 0.08;
scene.add(dir); scene.add(dir.target);

// ---------- 环境反射：由天空场景生成 PMREM（与太阳一致） ----------
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(scene, 0.04, 1, 30000).texture;
scene.environmentIntensity = 0.12;

// ---------- 后处理：GTAO 环境光遮蔽（立体感/接触阴影） ----------
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const gtao = new GTAOPass(scene, camera);
gtao.output = GTAOPass.OUTPUT.Default;
gtao.blendIntensity = 0.55;
if (new URLSearchParams(location.search).has('ao')) composer.addPass(gtao);
composer.addPass(new OutputPass());

// ---------- 材质分类与预设 ----------
function classify(name) {
  if (/白线|黄线|标线|车道线/i.test(name)) return 'other';
  if (/玻璃|glass|gl(?![a-z])/i.test(name)) return 'glass';
  if (/水|water|湖|河|pool|lake|river|sea|湾/i.test(name)) return 'water';
  if (/铝|alu|铝板/i.test(name)) return 'alu';
  if (/asphalt/i.test(name)) return 'asphalt';
  if (/铺地|人行道|pavement/i.test(name)) return 'pavement';
  if (/草|grass|草坪|lawn|植草/i.test(name)) return 'grass';
  if (/道路|路|road|地面|ground|outer/i.test(name)) return 'ground';
  if (/白|white|墙|wall|顶板/i.test(name)) return 'wall';
  return 'other';
}
function makeShrubTexture(){
  const s=1024,cv=document.createElement('canvas');cv.width=cv.height=s;
  const c=cv.getContext('2d');
  c.fillStyle='#3a6631';c.fillRect(0,0,s,s);
  const blobs=[];
  for(let i=0;i<560;i++)blobs.push({x:Math.random()*s,y:Math.random()*s,r:12+Math.random()*32});
  blobs.forEach(b=>{
    const g=Math.random();
    const col=g<0.28?'#2c5528':g<0.58?'#45753a':g<0.82?'#548542':'#6b9c4c';
    for(let dx=-s;dx<=s;dx+=s)for(let dy=-s;dy<=s;dy+=s){
      c.fillStyle=col;c.beginPath();c.arc(b.x+dx,b.y+dy,b.r,0,7);c.fill();
    }
  });
  for(let i=0;i<2600;i++){
    const g=Math.random();
    c.fillStyle=g<0.5?'#35602e':'#5e9248';
    const x=Math.random()*s,y=Math.random()*s,r=1+Math.random()*2.5;
    for(let dx=-s;dx<=s;dx+=s)for(let dy=-s;dy<=s;dy+=s){c.beginPath();c.arc(x+dx,y+dy,r,0,7);c.fill();}
  }
  return new THREE.CanvasTexture(cv);
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
        envMapIntensity: 1.7, transparent: true, opacity: 0.93, side: THREE.DoubleSide }); break;
    case 'alu':
      m = new THREE.MeshStandardMaterial({ metalness: 0.9, roughness: 0.34, envMapIntensity: 1.2 });
      if (orig && orig.color) m.color.copy(orig.color); break;
    case 'grass': {
      const gtex = makeShrubTexture();
      gtex.wrapS=gtex.wrapT=THREE.RepeatWrapping;gtex.repeat.set(1/14,1/14);
      gtex.anisotropy=8;gtex.colorSpace=THREE.SRGBColorSpace;
      m = new THREE.MeshStandardMaterial({ map: gtex, roughness: 1, metalness: 0 }); break;
    }
    case 'asphalt':
      m = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.95, metalness: 0 }); break;
    case 'pavement':
      m = new THREE.MeshStandardMaterial({ color: 0xb3ad9e, roughness: 0.9, metalness: 0 }); break;
    case 'ground':
      m = new THREE.MeshStandardMaterial({ color: 0x8b8e93, roughness: 0.95, metalness: 0 }); break;
    case 'wall':
      m = new THREE.MeshStandardMaterial({ color: 0xf2f0ea, roughness: 0.72, metalness: 0 }); break;
    default: m = orig;
  }
  const _po = { asphalt: [-4,-4], water: [-2,-2], pavement: [-1,-1], grass: [2,2], ground: [3,3] };
  if (_po[cls]) { m.polygonOffset = true; m.polygonOffsetFactor = _po[cls][0]; m.polygonOffsetUnits = _po[cls][1]; }
  matCache[cls] = m; return m;
}

// ---------- 在指定 mesh 三角形上按面积采样世界坐标点 ----------
function samplePointsOnMeshes(meshes, N, minArea) {
  const tris = []; let total = 0;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
  const ab = new THREE.Vector3(), ac = new THREE.Vector3();
  meshes.forEach((o) => {
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const cnt = idx ? idx.count : pos.count;
    for (let i = 0; i < cnt; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      va.fromBufferAttribute(pos, ia); vb.fromBufferAttribute(pos, ib); vc.fromBufferAttribute(pos, ic);
      o.localToWorld(va); o.localToWorld(vb); o.localToWorld(vc);
      ab.subVectors(vb, va); ac.subVectors(vc, va);
      const area = ab.cross(ac).length() * 0.5;
      if (area < (minArea || 0.3)) continue;
      total += area; tris.push({ a: va.clone(), b: vb.clone(), c: vc.clone(), cu: total });
    }
  });
  const pts = [];
  for (let k = 0; k < N; k++) {
    const r = Math.random() * total;
    let lo = 0, hi = tris.length - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (tris[mid].cu < r) lo = mid + 1; else hi = mid; }
    const t = tris[lo];
    let u = Math.random(), v = Math.random();
    if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const p = t.a.clone().addScaledVector(ab.subVectors(t.b, t.a), u).addScaledVector(ac.subVectors(t.c, t.a), v);
    pts.push(p);
  }
  return pts;
}

// ---------- 在给定点位实例化低模树（3 部件，3 draw call） ----------
function plantTreePoints(scene, pts) {
  const n = pts.length; if (!n) return 0;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.26, 0.4, 3.6, 6),
    new THREE.MeshStandardMaterial({ color: 0x6a4a2e, roughness: 1 }), n);
  const crownLo = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(3.0, 1),
    new THREE.MeshStandardMaterial({ color: 0x4c7d39, roughness: 0.9, flatShading: true }), n);
  const crownHi = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(2.0, 1),
    new THREE.MeshStandardMaterial({ color: 0x558a3e, roughness: 0.9, flatShading: true }), n);
  trunk.castShadow = crownLo.castShadow = crownHi.castShadow = true;
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(),
    pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const p = pts[i], sc = 0.9 + Math.random() * 0.6;
    q.setFromAxisAngle(up, Math.random() * Math.PI * 2);
    pos.set(p.x, p.y + 1.8 * sc, p.z); s.set(sc, sc, sc); m.compose(pos, q, s); trunk.setMatrixAt(i, m);
    pos.set(p.x, p.y + 4.4 * sc, p.z);
    s.set(sc * (1 + Math.random() * 0.18), sc * (0.85 + Math.random() * 0.2), sc * (1 + Math.random() * 0.18));
    m.compose(pos, q, s); crownLo.setMatrixAt(i, m);
    const ox = (Math.random() - 0.5) * 1.1 * sc, oz = (Math.random() - 0.5) * 1.1 * sc;
    pos.set(p.x + ox, p.y + 6.4 * sc, p.z + oz); s.set(sc, sc * (0.9 + Math.random() * 0.2), sc);
    m.compose(pos, q, s); crownHi.setMatrixAt(i, m);
    col.setHSL(0.27 + Math.random() * 0.06, 0.42 + Math.random() * 0.16, 0.32 + Math.random() * 0.1); crownLo.setColorAt(i, col);
    col.setHSL(0.27 + Math.random() * 0.06, 0.42 + Math.random() * 0.16, 0.36 + Math.random() * 0.1); crownHi.setColorAt(i, col);
  }
  trunk.instanceMatrix.needsUpdate = crownLo.instanceMatrix.needsUpdate = crownHi.instanceMatrix.needsUpdate = true;
  if (crownLo.instanceColor) crownLo.instanceColor.needsUpdate = true;
  if (crownHi.instanceColor) crownHi.instanceColor.needsUpdate = true;
  scene.add(trunk); scene.add(crownLo); scene.add(crownHi);
  return n;
}

// ---------- 主干道延伸（合并为 1 mesh / 1 draw call） ----------
function extendRoads(scene, segments) {
  const positions = [], indices = []; let v = 0; const y = 0.05;
  segments.forEach((s) => {
    const hw = s.w / 2; let ax, az, bx, bz;
    if (s.axis === 'z') { ax = s.fixed - hw; az = s.from; bx = s.fixed + hw; bz = s.to; }
    else { ax = s.from; az = s.fixed - hw; bx = s.to; bz = s.fixed + hw; }
    positions.push(ax, y, az, bx, y, az, bx, y, bz, ax, y, bz);
    indices.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.95 }));
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
}

// ---------- 程序化城市道路网纹理（周边 context 用，极低资源） ----------
function makeCityTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 1024;
  const g = c.getContext('2d');
  g.fillStyle = '#a6a9ae'; g.fillRect(0, 0, 1024, 1024);
  const ROAD = 128, W = 13;
  for (let p = 0; p <= 1024; p += ROAD) {
    g.fillStyle = '#5d6269';
    g.fillRect(p - W / 2, 0, W, 1024); g.fillRect(0, p - W / 2, 1024, W);
  }
  for (let bx = 0; bx < 1024; bx += ROAD) for (let bz = 0; bz < 1024; bz += ROAD) {
    g.fillStyle = `rgba(255,255,255,${(Math.random() * 0.07).toFixed(3)})`;
    g.fillRect(bx + W, bz + W, ROAD - W, ROAD - W);
    g.fillStyle = `rgba(60,70,80,${(Math.random() * 0.05).toFixed(3)})`;
    g.fillRect(bx + W, bz + W, ROAD - W, ROAD - W);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return tex;
}

// ---------- 地表分类栅格（材质替换前构建，name 仍在） ----------
function buildGroundGrid(root) {
  const cell = 3, x0 = -120, x1 = 680, z0 = -320, z1 = 520;
  const w = Math.ceil((x1 - x0) / cell), h = Math.ceil((z1 - z0) / cell);
  const occ = new Int8Array(w * h).fill(9); // 0建筑/水 1道路 2铺地 3草地 9外部
  const codeFor = (cls) => (cls === 'bldg' || cls === 'water') ? 0
    : (cls === 'asphalt' || cls === 'road') ? 1 : cls === 'pavement' ? 2 : cls === 'grass' ? 3 : 9;
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), ctr = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const code = codeFor(classify(o.name || ''));
    if (code === 9) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index, cnt = idx ? idx.count : pos.count;
    for (let i = 0; i < cnt; i += 3) {
      const a = idx ? idx.getX(i) : i, b = idx ? idx.getX(i + 1) : i + 1, c = idx ? idx.getX(i + 2) : i + 2;
      va.fromBufferAttribute(pos, a); vb.fromBufferAttribute(pos, b); vc.fromBufferAttribute(pos, c);
      ctr.addVectors(va, vb).add(vc).multiplyScalar(1 / 3); o.localToWorld(ctr);
      const gx = Math.round((ctr.x - x0) / cell), gz = Math.round((ctr.z - z0) / cell);
      if (gx < 0 || gx >= w || gz < 0 || gz >= h) continue;
      const k = gz * w + gx; if (code < occ[k]) occ[k] = code;
    }
  });
  return {
    occ, w, h, cell, x0, z0,
    codeAt(x, z) {
      const gx = Math.round((x - x0) / cell), gz = Math.round((z - z0) / cell);
      if (gx < 0 || gx >= w || gz < 0 || gz >= h) return 9;
      return occ[gz * w + gx];
    },
    isGrass(x, z) { return this.codeAt(x, z) === 3; },
  };
}

// ---------- 栅格驱动绿化：行道树吸附路边草地 + 随机填充，保持间距 ----------
function populateGreenery(scene, grid, hRoads, vRoads, targetN) {
  const used = new Uint8Array(grid.w * grid.h);
  const pts = [];
  const tryAdd = (x, z) => {
    if (!grid.isGrass(x, z)) return false;
    const gx = Math.round((x - grid.x0) / grid.cell), gz = Math.round((z - grid.z0) / grid.cell);
    for (let da = -2; da <= 2; da++) for (let db = -2; db <= 2; db++) {
      const ax = gx + da, az = gz + db;
      if (ax >= 0 && ax < grid.w && az >= 0 && az < grid.h && used[az * grid.w + ax]) return false;
    }
    used[gz * grid.w + gx] = 1; pts.push(new THREE.Vector3(x, 0, z)); return true;
  };
  hRoads.forEach((r) => { for (let x = r.x0; x <= r.x1; x += 15) for (const s of [-1, 1])
    for (let o = 8; o <= 24; o += 3) if (tryAdd(x, r.z + s * o)) break; });
  vRoads.forEach((r) => { for (let z = r.z0; z <= r.z1; z += 15) for (const s of [-1, 1])
    for (let o = 8; o <= 24; o += 3) if (tryAdd(r.x + s * o, z)) break; });
  let guard = 0;
  while (pts.length < targetN && guard++ < targetN * 50)
    tryAdd(grid.x0 + Math.random() * grid.w * grid.cell, grid.z0 + Math.random() * grid.h * grid.cell);
  return plantTreePoints(scene, pts);
}

// ---------- 加载真实 GLB ----------
const TARGET = new THREE.Vector3();
const orbit = { theta: -0.7555, phi: 0.83, radius: 900, tTheta: -0.7555, tPhi: 0.83, tRadius: 900,
  min: 60, max: 5000, dragging: false, lastX: 0, lastY: 0, lastInteract: performance.now() };
let loaded = false, loadMs = 0, totalBytes = 0;

const draco = new DRACOLoader(); draco.setDecoderPath('../../vendor/draco/gltf/');
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
const t0 = performance.now();
const _glbCb = new URLSearchParams(location.search).get('cb') || Date.now();
const _glbName = new URLSearchParams(location.search).get('glb') || 'park.glb';
loader.load('../assets/' + _glbName + '?cb=' + _glbCb,
  (gltf) => {
    const matLog = {};
    const keepMat = new URLSearchParams(location.search).has('keepmat');
    const grid = buildGroundGrid(gltf.scene);
    window.__grid = grid;
    gltf.scene.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const name = o.name || '';
      const cls = classify(name);
      matLog[name] = matLog[name] || { cls, n: 0 }; matLog[name].n++;
      const isJZ = /JZ-/.test(name);
      if (!keepMat) {
        if (cls === 'glass' || cls === 'water') o.material = getMat(cls, o.material);
        else if (!isJZ && !o.material.map &&
                 (cls === 'asphalt' || cls === 'pavement' || cls === 'grass' || cls === 'ground'))
          o.material = getMat(cls, o.material);
      }
      if (!keepMat && cls === 'other' && /线|xian/i.test(name)) {
        o.material.polygonOffset = true; o.material.polygonOffsetFactor = -6; o.material.polygonOffsetUnits = -6;
      }
      o.castShadow = (cls !== 'glass' && cls !== 'water');
      o.receiveShadow = true;
    });

    // ---- 修正贴图错位：R_Display_lawn 同时含【地面绿化 y=0】与【屋顶绿化 y14-21】，
    //      按高度拆分；屋顶绿化隐藏以露出正常屋顶 R_JZ-顶板，仅保留地面灌木绿化带 ----
    (function splitLawn(){
      let src=null;
      gltf.scene.traverse((o)=>{ if(o.isMesh && o.name==='R_Display_lawn') src=o; });
      if(!src) return;
      const sg=src.geometry, sp=sg.attributes.position, sidx=sg.index, suv=sg.attributes.uv;
      const G={p:[],u:[],i:[]}, R={p:[],u:[],i:[]}, mG={}, mR={};
      function push(S,M,vi){
        if(M[vi]===undefined){ M[vi]=S.p.length/3; S.p.push(sp.getX(vi),sp.getY(vi),sp.getZ(vi));
          if(suv)S.u.push(suv.getX(vi),suv.getY(vi)); }
        return M[vi];
      }
      const n=sidx?sidx.count:sp.count;
      for(let i=0;i<n;i+=3){
        const a=sidx?sidx.getX(i):i,b=sidx?sidx.getX(i+1):i+1,c=sidx?sidx.getX(i+2):i+2;
        const cy=(sp.getY(a)+sp.getY(b)+sp.getY(c))/3;
        const isRoof=cy>=8, S=isRoof?R:G, M=isRoof?mR:mG;
        S.i.push(push(S,M,a),push(S,M,b),push(S,M,c));
      }
      function mk(S,mat,name){
        const ng=new THREE.BufferGeometry();
        ng.setAttribute('position',new THREE.Float32BufferAttribute(S.p,3));
        if(S.u.length)ng.setAttribute('uv',new THREE.Float32BufferAttribute(S.u,2));
        ng.setIndex(S.i);
        const m=new THREE.Mesh(ng,mat);m.name=name;m.receiveShadow=true;
        gltf.scene.add(m);return m;
      }
      const gLo=mk(G,src.material,'lawn_ground');
      const gRoof=mk(R,new THREE.MeshStandardMaterial({color:0x76a85f,roughness:1}),'lawn_roof');
      gRoof.visible=false; src.visible=false;
      window.__lawnSplit={lo:gLo,roof:gRoof,orig:src};
      window.__roofLawnTris=R.i.length/3;
    })();

    // ---- 分系统材质精修：外墙/基座/玻璃/栈道/围栏/楼体配色/屋顶 ----
    (function refineJZ(){
      gltf.scene.traverse((o)=>{
        if(!o.isMesh||!o.material)return; const n=o.name||'';
        [].concat(o.material).forEach((m)=>{
          // 1. 外墙系统：保留 MAP 贴图，叠暖白提亮（color*map 不丢贴图）
          if(/JZ-白色(?!条)/.test(n)){m.color.setHex(0xf5f2ec);}
          if(/JZ-白色条/.test(n)){m.color.setHex(0xe6e0dd);}
          if(/JZ-装饰线-BAI/.test(n)){m.color.setHex(0xa8a8a8);}
          if(/JZ-屋顶檐子/.test(n)){m.color.setHex(0xe2dcd9);}
          // 2. 基座系统：保留木板 MAP，叠暖灰棕去红提亮
          if(/下墙-MU/.test(n)){m.color.setHex(0xc4a882);}
          // 3. 玻璃系统：兜底（若有具名玻璃材质）
          if(/玻璃/.test(n)){m.transparent=true;m.opacity=0.40;m.envMapIntensity=2.2;
            m.roughness=0.06;m.metalness=0;
            if(!m.emissive)m.emissive=new THREE.Color(0x1a2a3a);
            m.emissive.setHex(0x1a2a3a);m.emissiveIntensity=0.15;}
          // 4. 木栈道：DX-铺地2 偏橙红(#a96d43)，叠自然木色降饱和
          if(/DX-铺地2/.test(n)){m.color.setHex(0xb8956a);m.roughness=0.8;}
          // 5. 金属围栏代理：提亮可见
          if(/PROXY_railing/.test(n)){m.color.setHex(0xcccccc);}
          if(/PROXY_windowgrid/.test(n)){m.color.setHex(0xbbbbbb);}
          // 6. 楼体配色统一：消除脏色与跳色
          if(/建筑＝金属_铝板_黄色/.test(n)){m.color.setHex(0x8a7e72);m.metalness=0.6;m.roughness=0.5;}
          if(/黄色金属02/.test(n)){m.color.setHex(0xc9a86e);m.metalness=0.85;m.roughness=0.3;}
          if(/黄色金属(?!02|03)/.test(n)){m.color.setHex(0xd4b87a);m.metalness=0.7;m.roughness=0.35;}
          // 7. 屋顶顶板：保留 MAP，轻微提亮干净浅灰
          if(/JZ-顶板/.test(n)){m.color.setHex(0xf0f0f0);}
        });
      });
      // 玻璃共享材质直调：getMat('glass') 已替换原玻璃为 matCache['glass']（name 为空，traverse 匹配不到）
      var gm=matCache['glass'];
      if(gm){
        gm.opacity=0.40;gm.envMapIntensity=2.2;gm.roughness=0.06;gm.metalness=0;
        if(!gm.emissive)gm.emissive=new THREE.Color(0x1a2a3a);
        gm.emissive.setHex(0x1a2a3a);gm.emissiveIntensity=0.15;
      }
    })();

    // ---- alpha 镂空贴图：栏杆+铝板格栅代理 ----
    (function applyAlpha(){
      const tl = new THREE.TextureLoader();
      const railTex = tl.load('../assets/alpha_railings.png');
      railTex.wrapS = railTex.wrapT = THREE.RepeatWrapping;
      railTex.repeat.set(8, 1);
      const gridTex = tl.load('../assets/alpha_grid.png');
      gridTex.wrapS = gridTex.wrapT = THREE.RepeatWrapping;
      gridTex.repeat.set(4, 2);
      gltf.scene.traverse((o)=>{
        if(!o.isMesh||!o.material)return;
        const n=o.name||'';
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if(/栏杆_alpha/.test(n)){
          m.map = railTex; m.alphaTest = 0.5; m.transparent = true;
          m.side = THREE.DoubleSide; m.color.setHex(0xd4b87a);
          m.metalness=0.6; m.roughness=0.5; m.needsUpdate=true;
        }
        if(/铝板_alpha/.test(n)){
          m.map = gridTex; m.alphaTest = 0.5; m.transparent = true;
          m.side = THREE.DoubleSide; m.color.setHex(0xc9a86e);
          m.metalness=0.7; m.roughness=0.4; m.needsUpdate=true;
        }
      });
    })();

    window.__mats = matLog;
    window.__gltfScene = gltf.scene;
    window.__cam = { camera, orbit, TARGET };

    scene.add(gltf.scene);

    // 大地底色：垫住 context 区与边缘白地（在面层下方）
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000),
      new THREE.MeshStandardMaterial({ color: 0x9aa18c, roughness: 1, metalness: 0 }));
    ground.rotation.x = -Math.PI / 2; ground.position.set(445, -2.5, -106);
    ground.receiveShadow = true; scene.add(ground);

    // 周边城市地面：程序化道路网纹理（1 纹理 1 平面，道路在街区之间）
    const cityTex = makeCityTexture();
    cityTex.repeat.set(1.63, 1.35);
    const city = new THREE.Mesh(new THREE.PlaneGeometry(1700, 1400),
      new THREE.MeshStandardMaterial({ map: cityTex, roughness: 1, metalness: 0 }));
    city.rotation.x = -Math.PI / 2; city.position.set(400, -1.6, 120);
    city.receiveShadow = true; scene.add(city);

    // ---- 绿化模块：合并实例十字 billboard 树（1 draw call、沿外围/道路统一生成）----
    function makeTreeTexture(){
      const s=128,cv=document.createElement('canvas');cv.width=cv.height=s;
      const x=cv.getContext('2d');x.clearRect(0,0,s,s);const c=s/2;
      for(let i=0;i<26;i++){
        const a=Math.random()*Math.PI*2,r=Math.random()*s*0.22;
        const px=c+Math.cos(a)*r,py=c+Math.sin(a)*r,rr=s*(0.16+Math.random()*0.12);
        const g=x.createRadialGradient(px,py,1,px,py,rr),lit=0.7+Math.random()*0.3;
        g.addColorStop(0,'rgba(255,255,255,'+lit+')');g.addColorStop(1,'rgba(255,255,255,0)');
        x.fillStyle=g;x.beginPath();x.arc(px,py,rr,0,7);x.fill();
      }
      x.globalCompositeOperation='destination-in';
      const g2=x.createRadialGradient(c,c,s*0.1,c,c,s*0.5);
      g2.addColorStop(0,'rgba(255,255,255,1)');g2.addColorStop(0.78,'rgba(255,255,255,1)');g2.addColorStop(1,'rgba(255,255,255,0)');
      x.fillStyle=g2;x.fillRect(0,0,s,s);x.globalCompositeOperation='source-over';
      const t=new THREE.CanvasTexture(cv);t.colorSpace=THREE.SRGBColorSpace;t.anisotropy=4;return t;
    }
    function makeTreeGeometry(){
      const w=12,h=13,v=[],uv=[],idx=[];
      function quad(rot){
        const cs=Math.cos(rot),sn=Math.sin(rot),base=v.length/3;
        [[-w/2,0],[w/2,0],[w/2,h],[-w/2,h]].forEach(([lx,y])=>{
          v.push(lx*cs,y,-lx*sn);
        });
        uv.push(0,0,1,0,1,1,0,1);idx.push(base,base+1,base+2,base,base+2,base+3);
      }
      quad(0);quad(Math.PI/2);
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.Float32BufferAttribute(v,3));
      g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);return g;
    }
    window.buildTrees=function(){
      const mat=new THREE.MeshStandardMaterial({map:makeTreeTexture(),alphaTest:0.38,
        roughness:0.95,metalness:0,side:THREE.DoubleSide});
      const spots=[];const push=(x,z,s)=>spots.push([x,z,s||1]);
      for(let i=0;i<280;i++)push(-40-Math.random()*320,-260+Math.random()*1060,0.85+Math.random()*0.6);
      for(let i=0;i<280;i++)push(-260+Math.random()*1240,430+Math.random()*330,0.85+Math.random()*0.6);
      // 前景（屏幕底部中央）浓密林：沿屏幕 r / -f 坐标系加密
      const RVx=0.728,RVz=0.686,FXx=-0.686,FXz=0.728;
      const fcx=193.7+FXx*370,fcz=214.99+FXz*370;
      for(let i=0;i<210;i++){
        const a=(Math.random()*2-1)*320,b=(Math.random()*2-1)*110;
        push(fcx+RVx*a+FXx*b,fcz+RVz*a+FXz*b,0.95+Math.random()*0.5);
      }
      for(let i=0;i<50;i++)push(-150+Math.random()*450,-230-Math.random()*70,0.8+Math.random()*0.5);
      for(let i=0;i<50;i++)push(585+Math.random()*235,0+Math.random()*450,0.8+Math.random()*0.5);
      [{z:60,x0:-40,x1:590},{z:140,x0:-50,x1:580}].forEach(rd=>{
        for(let x=rd.x0;x<=rd.x1;x+=13){
          push(x+Math.random()*3-1.5,rd.z+11,0.85+Math.random()*0.3);
          push(x+Math.random()*3-1.5,rd.z-11,0.85+Math.random()*0.3);
        }
      });
      const greens=[0x2f6b32,0x3a7a38,0x478a3f,0x57934b,0x6b9a44,0x8aa83f,0xc9a23a];
      const N=spots.length,trees=new THREE.InstancedMesh(makeTreeGeometry(),mat,N);
      const m4=new THREE.Matrix4(),q=new THREE.Quaternion(),sc=new THREE.Vector3(),ps=new THREE.Vector3(),ax=new THREE.Vector3(0,1,0);
      for(let i=0;i<N;i++){
        const sx=spots[i][0],sz=spots[i][1],ss=spots[i][2];
        ps.set(sx,0,sz);q.setFromAxisAngle(ax,Math.random()*Math.PI);sc.set(ss,ss,ss);
        m4.compose(ps,q,sc);trees.setMatrixAt(i,m4);
        const hi=Math.random()<0.13;
        trees.setColorAt(i,new THREE.Color(greens[(Math.random()*(hi?greens.length:greens.length-2))|0]));
      }
      trees.receiveShadow=true;trees.castShadow=false;trees.instanceMatrix.needsUpdate=true;
      if(trees.instanceColor)trees.instanceColor.needsUpdate=true;
      window.__scene.add(trees);window.__trees=trees;return trees;
    };
    // 树木已停用（用户判定立体树太假）：改用建筑周边绿化带地面贴图

    // 取景：只按真实建筑（JZ）核心园区，排除 context 灰块
    const core = new THREE.Box3();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const mn = ([].concat(o.material)[0] && [].concat(o.material)[0].name) || '';
      if (!/^(JZ-|cw_|T_cw)/.test(mn)) return;  // 只纳入真实建筑，排除道路/地形/立交/context
      o.geometry.computeBoundingBox();
      const b = o.geometry.boundingBox;
      core.expandByPoint(o.localToWorld(b.min.clone()));
      core.expandByPoint(o.localToWorld(b.max.clone()));
    });
    const size = core.getSize(new THREE.Vector3()); core.getCenter(TARGET);
    const base = Math.max(size.x, size.z);
    orbit.radius = orbit.tRadius = base * 1.15; orbit.min = base * 0.1; orbit.max = base * 3;

    // 太阳阴影锥覆盖整个场景（含 context）
    const gbox = new THREE.Box3().setFromObject(gltf.scene);
    const gsize = gbox.getSize(new THREE.Vector3()); const gspan = gsize.length();
    const gc = gbox.getCenter(new THREE.Vector3());
    const half = Math.max(gsize.x, gsize.z) * 0.5, c = dir.shadow.camera;
    c.left = -half; c.right = half; c.top = half; c.bottom = -half; c.near = 1; c.far = gspan * 2.2;
    c.updateProjectionMatrix();
    dir.target.position.copy(gc);
    dir.position.copy(gc).addScaledVector(sun, gspan * 1.3);

    // 内部正交道路中心线（基于道路点云识别合并）
    const STREET_H = [
      { z: 60, x0: -50, x1: 600 },
      { z: 140, x0: -60, x1: 590 },
      { z: 295, x0: -60, x1: 530 },
      { z: -200, x0: -40, x1: 820 },
      { z: -55, x0: -50, x1: 670 },
    ];
    const STREET_V = [
      { x: 50, z0: -230, z1: 460 },
      { x: 135, z0: -240, z1: 470 },
      { x: 180, z0: -240, z1: 450 },
      { x: 240, z0: -270, z1: 560 },
      { x: 278, z0: -280, z1: 690 },
    ];
    // 绿化模块暂缓：先补齐道路、做建筑真实感，最后统一做低资源绿化
    const treeN = 0; window.__treeN = treeN;

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
  if (!orbit.dragging && now - orbit.lastInteract > 120000) orbit.tTheta += dt * 0.03;
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
  composer.setSize(w, h);
  gtao.setSize(Math.floor(w / 2), Math.floor(h / 2));
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
  composer.render();
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
