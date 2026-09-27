// greening.js — 模块化绿化（确定性、轻量、单 draw call 乔木）：
//  1) 乔木：实例化 yaw-only billboard（单 quad 竖直立地、只水平转向、合批为 1 mesh）。
//     位置沿【车行路】两侧——车行路由材质名 asphalt / 路牙 精确勾勒（路牙只在车行路、不在景观步道）。
//     避开铺装、楼栋、水景开阔区。
//  2) 建筑基部贴地深林绿环（forest.jpg 俯视纹理）。
//  调参只改 GREEN_CONFIG，无需重新审计/漫长构建。
import * as THREE from 'three';

export const GREEN_CONFIG = {
  cell: 4,                          // 采样网格尺寸 m
  xMin: -400, zMin: -700, nx: 375, nz: 400, // 网格范围（覆盖全园+高速互通）
  treeTex: '../assets/textures/tree-canopy3.png',
  forestTex: '../assets/textures/forest.jpg',
  band: { min: 1, max: 3 },         // 乔木带：路牙外缘 dRoad 1..3（约 2–12m）
  minDBld: 2,                       // 离楼栋最小格距
  minDWater: 2,                     // 离水景最小格距（水景紧邻保持开阔）
  gap: 2,                           // 株距（格；cell*gap ≈ 8m，沿路单排）
  bw: 12, bh: 10.2,                 // billboard 宽/高（世界单位）
  alphaCut: 0.14,                   // 树冠 alpha 裁剪阈值
  ringW: 4.5, ringTile: 28,         // 建筑基部贴地绿环宽 / 纹理平铺
};

export function createGreening(scene, buildings, opts = {}) {
  const CFG = { ...GREEN_CONFIG, ...opts };
  const { cell, xMin, zMin, nx, nz } = CFG; const N = nx * nz;

  // --- 1. 从几何按材质名提取 road / hard / water ---
  const road = new Uint8Array(N), hard = new Uint8Array(N), water = new Uint8Array(N);
  const v = new THREE.Vector3();
  scene.updateWorldMatrix(true, false);
  scene.traverse((o) => {
    if (!o.material || !o.geometry || !o.geometry.attributes.position) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const nm = mats.map((m) => m.name || '').join('|');
    const isRoad = /asphalt|路牙/.test(nm),
      isHard = /DX-(路牙|人行道|铺地|白线|黄线)|asphalt/.test(nm),
      isWater = /Display water/.test(nm);
    if (!(isRoad || isHard || isWater)) return;
    const pos = o.geometry.attributes.position;
    for (let k = 0; k < pos.count; k++) {
      v.fromBufferAttribute(pos, k).applyMatrix4(o.matrixWorld);
      const gi = ((v.x - xMin) / cell) | 0, gj = ((v.z - zMin) / cell) | 0;
      if (gi < 0 || gj < 0 || gi >= nx || gj >= nz) continue;
      const p = gj * nx + gi;
      if (isRoad) road[p] = 1;
      if (isHard) hard[p] = 1;
      if (isWater) water[p] = 1;
    }
  });

  // --- 2. 楼栋 footprint 栅格 ---
  const bld = new Uint8Array(N);
  buildings.forEach((b) => {
    const i0 = ((b.wx - b.w / 2 - xMin) / cell) | 0, i1 = ((b.wx + b.w / 2 - xMin) / cell) | 0,
      j0 = ((b.wz - b.d / 2 - zMin) / cell) | 0, j1 = ((b.wz + b.d / 2 - zMin) / cell) | 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      if (i < 0 || j < 0 || i >= nx || j >= nz) continue;
      bld[j * nx + i] = 1;
    }
  });

  // --- 3. 距离场（全域 4 邻域 BFS） ---
  function bfs(src) {
    const d = new Int32Array(N).fill(-1), q = []; let h = 0;
    for (let p = 0; p < N; p++) if (src[p]) { d[p] = 0; q.push(p); }
    while (h < q.length) {
      const p = q[h++], i = p % nx, j = (p / nx) | 0, dd = d[p];
      for (const [u, w] of [[i - 1, j], [i + 1, j], [i, j - 1], [i, j + 1]]) {
        if (u < 0 || w < 0 || u >= nx || w >= nz) continue;
        const pp = w * nx + u;
        if (d[pp] === -1) { d[pp] = dd + 1; q.push(pp); }
      }
    }
    return d;
  }
  const dR = bfs(road), dW = bfs(water), dB = bfs(bld);

  // --- 4. 乔木候选点位 ---
  const cand = [];
  for (let p = 0; p < N; p++) {
    if (hard[p] || water[p] || bld[p]) continue;
    if (dR[p] >= CFG.band.min && dR[p] <= CFG.band.max &&
      dB[p] >= CFG.minDBld && dW[p] >= CFG.minDWater) cand.push(p);
  }
  for (let k = cand.length - 1; k > 0; k--) {
    const r = (Math.random() * (k + 1)) | 0;
    [cand[k], cand[r]] = [cand[r], cand[k]];
  }
  const placed = new Uint8Array(N), GAP = CFG.gap, pts = [];
  function busy(i, j) {
    for (let a = -GAP; a <= GAP; a++) for (let b = -GAP; b <= GAP; b++) {
      const u = i + a, w = j + b;
      if (u < 0 || w < 0 || u >= nx || w >= nz) continue;
      if (placed[w * nx + u]) return true;
    }
    return false;
  }
  for (const p of cand) {
    const i = p % nx, j = (p / nx) | 0;
    if (busy(i, j)) continue;
    placed[p] = 1;
    pts.push({
      x: xMin + (i + 0.5) * cell + (Math.random() - 0.5) * 2,
      z: zMin + (j + 0.5) * cell + (Math.random() - 0.5) * 2,
      s: 0.95 + Math.random() * 0.3,
    });
  }

  // --- 5. yaw billboard 实例（单 mesh / 单 draw call） ---
  const tex = new THREE.TextureLoader().load(CFG.treeTex);
  tex.colorSpace = THREE.SRGBColorSpace;
  const { bw, bh } = CFG, base = new THREE.PlaneGeometry(bw, bh), geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index;
  geo.setAttribute('position', base.attributes.position);
  geo.setAttribute('uv', base.attributes.uv);
  const M = pts.length, off = new Float32Array(M * 3), sc = new Float32Array(M);
  pts.forEach((o, i) => { off[i * 3] = o.x; off[i * 3 + 1] = 0; off[i * 3 + 2] = o.z; sc[i] = o.s; });
  geo.setAttribute('iOff', new THREE.InstancedBufferAttribute(off, 3));
  geo.setAttribute('iSc', new THREE.InstancedBufferAttribute(sc, 1));
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: tex }, uR: { value: new THREE.Vector3(1, 0, 0) }, cut: { value: CFG.alphaCut } },
    vertexShader: `attribute vec3 iOff;attribute float iSc;uniform vec3 uR;varying vec2 vUv;
      void main(){vUv=uv;float h=(position.y+${bh / 2})*iSc;float w=position.x*iSc;
       vec3 wp=iOff+uR*w+vec3(0.,1.,0.)*h;
       gl_Position=projectionMatrix*modelViewMatrix*vec4(wp,1.);}`,
    fragmentShader: `uniform sampler2D map;uniform float cut;varying vec2 vUv;
      void main(){vec4 t=texture2D(map,vUv);if(t.a<cut)discard;gl_FragColor=vec4(t.rgb,1.);}`,
    side: THREE.DoubleSide,
  });
  const forest = new THREE.Mesh(geo, mat);
  forest.frustumCulled = false;
  scene.add(forest);

  // --- 6. 建筑基部贴地绿环 ---
  const ring = createBaseRings(buildings, CFG);
  scene.add(ring);
  window.__greening = ring;

  // 每帧 yaw 转向：由 live.js 经 reins.onFrame 调 update(camera)
  function update(camera) {
    const cw = camera.matrixWorld.elements;
    let x = cw[0], z = cw[2], l = Math.hypot(x, z) || 1;
    mat.uniforms.uR.value.set(x / l, 0, z / l);
  }
  return { forest, ring, update, count: M };
}

function createBaseRings(buildings, CFG) {
  const rw = CFG.ringW, tile = CFG.ringTile, y = 0.08, pos = [], uv = [];
  function quad(x1, z1, x2, z2) {
    [[x1, z1], [x1, z2], [x2, z2], [x2, z1]].forEach(([x, z]) => {
      pos.push(x, y, z); uv.push(x / tile, z / tile);
    });
  }
  buildings.forEach((b) => {
    const hx = b.w / 2, hz = b.d / 2, ox = hx + rw, oz = hz + rw, cx = b.wx, cz = b.wz;
    quad(cx - ox, cz - oz, cx + ox, cz - hz); // 下
    quad(cx - ox, cz + hz, cx + ox, cz + oz); // 上
    quad(cx - ox, cz - hz, cx - hx, cz + hz); // 左
    quad(cx + hx, cz - hz, cx + ox, cz + hz); // 右
  });
  const idx = [];
  for (let i = 0; i < pos.length / 3; i += 4) idx.push(i, i + 1, i + 2, i, i + 2, i + 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const tex = new THREE.TextureLoader().load(CFG.forestTex);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 1.0, metalness: 0.0 }));
  m.receiveShadow = true; m.renderOrder = 1;
  return m;
}
