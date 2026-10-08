// greening.js — 绿化体系（默认走"面"：绿色屋顶 + 草坪地面 + 外围贴地林海，最轻量）
// trees3d=true 时额外启用 EZ-Tree 现成写实母树 + InstancedMesh（内部金黄行道树/林缘oak/基部绿篱/点景大树）
// 集中配置 GREEN_CONFIG，改值即可，无需重新审计。
import * as THREE from 'three';
// ez-tree 仅在 trees3d=true（实验立体树、默认关闭）时按需动态 import；生产默认 trees3d=false，零加载（省约 3.8MB）

export const GREEN_CONFIG = {
  trees3d: false,            // 立体树总开关（false=去全部立体树/绿篱，绿化只走"绿色屋顶+草坪地面+外围林海面"）
  flatFill: true,            // SDF 着色器连续林冠带（沿道路+建筑基部），1 大面、不种单棵
  flatY: 0.5,                // 贴地带统一绝对高度（消除地形起伏错位、防埋）
  flatTexTile: 9,            // 林冠纹理世界尺度（m/重复）
  bandTint: 0x67a04e,        // 建筑基部带中绿色调（草坪/基础绿化）
  roadTint: 0xe2c440,        // 沿道路行道树带金黄/暖黄绿色调（对标鸟瞰金黄行道树，点睛、提层次）
  sdfRoadIn: 3, sdfRoadOut: 10, // 行道树带距路距离区间（m；沿路窄带，避免立交围合区整片染黄）
  sdfBldIn: 1, sdfBldOut: 11,   // 建筑基部带距建筑距离区间（m）
  sdfMaxDb: 70,                 // 仅园区内部（距建筑≤m），排除外围高速
  cell: 2,
  span: 780,                 // 栅格以园区中心为中点的半范围
  // 内部金黄行道树
  rowBandMin: 1, rowBandMax: 2,   // 距路牙格数（紧贴外侧 4–8m）
  rowGap: 3,                      // 株距（格），cell4*3 ≈ 12m
  rowMinDBld: 2, rowMaxDBld: 15,  // 仅园区内部（楼栋近），排除外围高速
  rowMinDWater: 3,
  // 外围林海
  forestSpan: 3400,               // 贴地 forest 大平面半范围
  forestY: -1.8,                  // 外围低位（outer ground ≈-2），内部地面 y≈0 自然遮挡
  forestTile: 24,                 // forest.jpg 世界平铺尺度
  oakBandMin: 1, oakBandMax: 3,   // 林缘立体 oak：园区边界外窄圈
  oakGap: 5,
  // 基部绿篱
  hedgeH: 1.7, hedgeW: 1.3, hedgeGap: 0.6,
  // 点景大树
  accentWaterBandMin: 2, accentWaterBandMax: 7, accentGap: 7, accentMax: 9,
};

// ---------- 母树（复刻 tree-test 定稿参数）----------
async function makeTree(cfg) {
  const { Tree } = await import('ez-tree');
  const t = new Tree(); const o = t.options;
  o.seed = cfg.seed; o.type = 'deciduous';
  o.bark.type = cfg.bark; o.bark.textured = true;
  o.branch.levels = cfg.levels ?? 2;
  o.branch.length[0] = cfg.trunk; o.branch.length[1] = cfg.trunk * 0.5;
  if ((cfg.levels ?? 2) >= 2) o.branch.length[2] = cfg.trunk * 0.32;
  o.branch.radius[0] = cfg.rad ?? 0.8; o.branch.radius[1] = 0.4;
  o.branch.sections[0] = cfg.s0 ?? 3; o.branch.sections[1] = cfg.s1 ?? 3; o.branch.sections[2] = cfg.s2 ?? 2;
  o.branch.segments[0] = cfg.g0 ?? 5; o.branch.segments[1] = cfg.g1 ?? 4; o.branch.segments[2] = cfg.g2 ?? 3;
  o.branch.children[0] = cfg.c0 ?? 4; o.branch.children[1] = cfg.c1 ?? 3;
  o.branch.angle[1] = cfg.ang ?? 50; o.branch.angle[2] = 42;
  const f = o.leaves;
  f.type = cfg.leaf; f.count = cfg.lc ?? 5; f.size = cfg.ls ?? 3.4; f.start = cfg.lstart ?? 0.15;
  f.billboard = 'double'; f.tint = 0xffffff; f.alphaTest = cfg.at ?? 0.3; f.angle = 15;
  t.generate(); return t;
}

// ---------- 栅格提取 ----------
function buildGrids(g, cc, cfg) {
  const { cell, span } = cfg;
  const nx = Math.ceil((span * 2) / cell), nz = nx, N = nx * nz;
  const xMin = cc.x - span, zMin = cc.z - span;
  const road = new Uint8Array(N), lawn = new Uint8Array(N), hard = new Uint8Array(N);
  const water = new Uint8Array(N), bld = new Uint8Array(N);
  const gyMin = new Float32Array(N).fill(Infinity); // 每格最低地面 y（区分园内/外围、排除屋顶）
  const v = new THREE.Vector3();
  // 格标记（kind: 0 road / 1 lawn / 2 hard / 3 water）
  const markCell = (wx, wz, kind) => {
    const gi = ((wx - xMin) / cell) | 0, gj = ((wz - zMin) / cell) | 0;
    if (gi < 0 || gj < 0 || gi >= nx || gj >= nz) return;
    const p = gj * nx + gi;
    if (kind === 0) road[p] = 1; else if (kind === 1) lawn[p] = 1;
    else if (kind === 2) hard[p] = 1; else water[p] = 1;
  };
  // xz 三角形光栅化（包围盒格中心 + 叉积同号判定），让路面/草坪/水面源连续
  const fillTri = (ax, az, bx, bz, cx, cz, kind) => {
    const g0 = Math.max(0, ((Math.min(ax, bx, cx) - xMin) / cell) | 0);
    const g1 = Math.min(nx - 1, ((Math.max(ax, bx, cx) - xMin) / cell) | 0);
    const h0 = Math.max(0, ((Math.min(az, bz, cz) - zMin) / cell) | 0);
    const h1 = Math.min(nz - 1, ((Math.max(az, bz, cz) - zMin) / cell) | 0);
    for (let gj = h0; gj <= h1; gj++) for (let gi = g0; gi <= g1; gi++) {
      const px = xMin + (gi + 0.5) * cell, pz = zMin + (gj + 0.5) * cell;
      const d1 = (px - ax) * (bz - az) - (pz - az) * (bx - ax);
      const d2 = (px - bx) * (cz - bz) - (pz - bz) * (cx - bx);
      const d3 = (px - cx) * (az - cz) - (pz - cz) * (ax - cx);
      const hasNeg = d1 < 0 || d2 < 0 || d3 < 0, hasPos = d1 > 0 || d2 > 0 || d3 > 0;
      if (!(hasNeg && hasPos)) markCell(px, pz, kind);
    }
  };
  g.traverse((o) => {
    if (!o.material || !o.geometry || !o.geometry.attributes.position) return;
    const nm = [].concat(o.material).map((m) => m.name || '').join('|');
    const isRoad = /asphalt|路牙/.test(nm);
    const isLawn = /Display lawn/.test(nm);
    const isHard = /DX-(人行道|铺地|白线|黄线|植草砖)|asphalt/.test(nm);
    const isWater = /Display water/.test(nm);
    if (!(isRoad || isLawn || isHard || isWater)) return;
    const pos = o.geometry.attributes.position, idx = o.geometry.index;
    const triCount = (idx ? idx.count : pos.count) / 3;
    const kinds = [];
    if (isRoad) kinds.push(0); if (isLawn) kinds.push(1);
    if (isHard) kinds.push(2); if (isWater) kinds.push(3);
    const A = new THREE.Vector3(), B = new THREE.Vector3(), C = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const j = t * 3;
      A.fromBufferAttribute(pos, idx ? idx.getX(j) : j).applyMatrix4(o.matrixWorld);
      B.fromBufferAttribute(pos, idx ? idx.getX(j + 1) : j + 1).applyMatrix4(o.matrixWorld);
      C.fromBufferAttribute(pos, idx ? idx.getX(j + 2) : j + 2).applyMatrix4(o.matrixWorld);
      for (const qv of [A, B, C]) {
        const gi = ((qv.x - xMin) / cell) | 0, gj = ((qv.z - zMin) / cell) | 0;
        if (gi >= 0 && gj >= 0 && gi < nx && gj < nz) {
          const p = gj * nx + gi; if (qv.y < gyMin[p]) gyMin[p] = qv.y;
        }
      }
      for (const k of kinds) fillTri(A.x, A.z, B.x, B.z, C.x, C.z, k);
    }
  });
  // 楼栋 footprint（BUILDINGS，可靠）
  for (const b of cc.buildings) {
    const x0 = b.wx - b.w / 2, x1 = b.wx + b.w / 2, z0 = b.wz - b.d / 2, z1 = b.wz + b.d / 2;
    const gx0 = Math.max(0, ((x0 - xMin) / cell) | 0), gx1 = Math.min(nx - 1, ((x1 - xMin) / cell) | 0);
    const gz0 = Math.max(0, ((z0 - zMin) / cell) | 0), gz1 = Math.min(nz - 1, ((z1 - zMin) / cell) | 0);
    for (let gj = gz0; gj <= gz1; gj++) for (let gi = gx0; gi <= gx1; gi++) bld[gj * nx + gi] = 1;
  }
  // 园区占地（内部地面 + 建筑，连续）
  const occupy = new Uint8Array(N);
  for (let p = 0; p < N; p++) if (road[p] || lawn[p] || hard[p] || bld[p]) occupy[p] = 1;
  fillGround(gyMin, nx, nz); // 最近邻填充，让无顶点格也有推断地面高度
  return { road, lawn, hard, water, bld, occupy, nx, nz, N, xMin, zMin, cell, gyMin };
}

// ---------- BFS 距离场 ----------
// 8 邻接 chamfer 距离（两遍扫描，权重 1 / √2）→ 近似欧氏距离，等距线平滑、无菱形方框
// 返回 Float32 格数（单位=格，对角 1.414），不可达=-1
function chamferDistance(grid, nx, nz) {
  const N = nx * nz, d = new Float32Array(N).fill(1e9);
  for (let i = 0; i < N; i++) if (grid[i]) d[i] = 0;
  const at = (x, z) => z * nx + x, SQ = 1.41421356;
  for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) {
    let v = d[at(x, z)];
    if (x > 0) v = Math.min(v, d[at(x - 1, z)] + 1);
    if (z > 0) v = Math.min(v, d[at(x, z - 1)] + 1);
    if (x > 0 && z > 0) v = Math.min(v, d[at(x - 1, z - 1)] + SQ);
    if (x < nx - 1 && z > 0) v = Math.min(v, d[at(x + 1, z - 1)] + SQ);
    d[at(x, z)] = v;
  }
  for (let z = nz - 1; z >= 0; z--) for (let x = nx - 1; x >= 0; x--) {
    let v = d[at(x, z)];
    if (x < nx - 1) v = Math.min(v, d[at(x + 1, z)] + 1);
    if (z < nz - 1) v = Math.min(v, d[at(x, z + 1)] + 1);
    if (x < nx - 1 && z < nz - 1) v = Math.min(v, d[at(x + 1, z + 1)] + SQ);
    if (x > 0 && z < nz - 1) v = Math.min(v, d[at(x - 1, z + 1)] + SQ);
    d[at(x, z)] = v;
  }
  for (let i = 0; i < N; i++) if (d[i] >= 1e8) d[i] = -1;
  return d;
}

// 地面高度最近邻填充（多源 BFS；有顶点格为源，无顶点格取最近源 y，填补采样空隙）
function fillGround(gy, nx, nz) {
  const N = nx * nz, q = new Int32Array(N); let h = 0, t = 0;
  for (let i = 0; i < N; i++) if (isFinite(gy[i])) q[t++] = i;
  while (h < t) {
    const p = q[h++], x = p % nx, z = (p / nx) | 0, y = gy[p];
    if (x > 0 && !isFinite(gy[p - 1])) { gy[p - 1] = y; q[t++] = p - 1; }
    if (x < nx - 1 && !isFinite(gy[p + 1])) { gy[p + 1] = y; q[t++] = p + 1; }
    if (z > 0 && !isFinite(gy[p - nx])) { gy[p - nx] = y; q[t++] = p - nx; }
    if (z < nz - 1 && !isFinite(gy[p + nx])) { gy[p + nx] = y; q[t++] = p + nx; }
  }
}

// 真正外部掩码：从栅格四缘 flood fill（只走非 occupy），与边界连通的非 occupy 格才是外部；
// 被 occupy 包围的内部庭院空洞不连通边缘、不算外部（避免林缘 oak 种进院内）。
function floodOutside(occupy, nx, nz) {
  const N = nx * nz, out = new Uint8Array(N), q = new Int32Array(N); let h = 0, t = 0;
  const push = (p) => { if (!occupy[p] && !out[p]) { out[p] = 1; q[t++] = p; } };
  for (let x = 0; x < nx; x++) { push(x); push((nz - 1) * nx + x); }
  for (let z = 0; z < nz; z++) { push(z * nx); push(z * nx + nx - 1); }
  while (h < t) {
    const p = q[h++], x = p % nx, z = (p / nx) | 0;
    if (x > 0) push(p - 1); if (x < nx - 1) push(p + 1);
    if (z > 0) push(p - nx); if (z < nz - 1) push(p + nx);
  }
  return out;
}

// ---------- 实例化（branches + leaves 各 1 draw call，材质共享）----------
const UP = new THREE.Vector3(0, 1, 0);
function makeInstanced(tree, transforms, leafEmissive) {
  const n = transforms.length;
  const bg = tree.branchesMesh, lg = tree.leavesMesh;
  const bi = new THREE.InstancedMesh(bg.geometry, bg.material, n);
  // 叶子：新建无风动材质（母树风动 onBeforeCompile 在 instancing 下不渲染），
  // emissive + emissiveMap 提供暖底色，防止弱环境光下背光面死黑。
  const src = lg.material;
  const leafMat = new THREE.MeshStandardMaterial({
    map: src.map, alphaTest: src.alphaTest ?? 0.3, side: THREE.DoubleSide,
    roughness: 0.9, metalness: 0,
    emissive: leafEmissive ?? 0xffc261, emissiveMap: src.map, emissiveIntensity: 0.32,
  });
  const li = new THREE.InstancedMesh(lg.geometry, leafMat, n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    const t = transforms[i];
    q.setFromAxisAngle(UP, t.yaw || 0);
    p.set(t.x, t.y || 0, t.z); s.setScalar(t.s || 1);
    m.compose(p, q, s); bi.setMatrixAt(i, m); li.setMatrixAt(i, m);
  }
  bi.instanceMatrix.needsUpdate = li.instanceMatrix.needsUpdate = true;
  bi.computeBoundingSphere(); li.computeBoundingSphere();
  return { branches: bi, leaves: li, count: n };
}

// 确定性间距抑制（位置 = 格中心，零抖动，整齐成线）
function placeAlong(G, dField, bandMin, bandMax, gap, opts = {}) {
  const { nx, nz, N, xMin, zMin, cell } = G;
  const out = [], busy = new Uint8Array(N);
  for (let p = 0; p < N; p++) {
    if (G.road[p] || G.hard[p] || G.water[p] || G.bld[p]) continue;
    if (opts.requireLawn && !G.lawn[p]) continue;
    const d = dField[p];
    if (d < bandMin || d > bandMax) continue;
    const gy = G.gyMin[p];
    if (opts.yMin !== undefined && (gy < opts.yMin || gy > opts.yMax)) continue;
    if (opts.guard && !opts.guard(p, d)) continue;
    if (busy[p]) continue;
    const gi = p % nx, gj = (p / nx) | 0;
    for (let dz = -gap; dz <= gap; dz++) for (let dx = -gap; dx <= gap; dx++) {
      const x = gi + dx, z = gj + dz;
      if (x < 0 || z < 0 || x >= nx || z >= nz) continue; busy[z * nx + x] = 1;
    }
    out.push({
      x: xMin + (gi + 0.5) * cell, z: zMin + (gj + 0.5) * cell,
      y: opts.y !== undefined ? opts.y : (isFinite(gy) ? gy : 0),
      s: opts.s || 1, yaw: ((p * 2654435761) % 360) * Math.PI / 180,
    });
  }
  return out;
}

// ---------- flatFill：贴地"面"补齐（极轻量，不种单棵）----------
// 由格子索引集合合并为一个贴地 BufferGeometry；y 统一（绝对高度，消除地形起伏错位），UV 按世界坐标/texTile
function flatGeoFromCells(cells, G, yAbs, texTile) {
  const { nx, xMin, zMin, cell } = G;
  const pos = [], uv = [], idx = [];
  let vb = 0;
  for (const p of cells) {
    const gi = p % nx, gj = (p / nx) | 0;
    const x0 = xMin + gi * cell, x1 = x0 + cell;
    const z0 = zMin + gj * cell, z1 = z0 + cell;
    pos.push(x0, yAbs, z0, x1, yAbs, z0, x1, yAbs, z1, x0, yAbs, z1);
    uv.push(x0 / texTile, z0 / texTile, x1 / texTile, z0 / texTile, x1 / texTile, z1 / texTile, x0 / texTile, z1 / texTile);
    idx.push(vb, vb + 2, vb + 1, vb, vb + 3, vb + 2); vb += 4;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function createGreening(scene, BUILDINGS) {
  const cfg = GREEN_CONFIG;
  const group = new THREE.Group(); group.name = 'greening';
  const flatTexs = [];
  // 园区中心（BUILDINGS 包围盒）
  let bx0 = Infinity, bx1 = -Infinity, bz0 = Infinity, bz1 = -Infinity;
  for (const b of BUILDINGS) {
    bx0 = Math.min(bx0, b.wx - b.w / 2); bx1 = Math.max(bx1, b.wx + b.w / 2);
    bz0 = Math.min(bz0, b.wz - b.d / 2); bz1 = Math.max(bz1, b.wz + b.d / 2);
  }
  const cc = { x: (bx0 + bx1) / 2, z: (bz0 + bz1) / 2, buildings: BUILDINGS };

  let ginkgoLite = null, oakLite = null, oakFull = null;
  let counts = { rows: 0, oaks: 0, accents: 0, hedges: 0, flatRows: 0, flatHedges: 0 };

  // 栅格 + 距离场（trees3d 或 flatFill 都需要；CPU 一次性、无渲染开销）
  let G = null, dRoad = null, dBld = null, dWater = null, dOccupy = null, outside = null;
  if (cfg.trees3d || cfg.flatFill) {
    G = buildGrids(scene.__glbRoot || scene, cc, cfg);
    window.__G = G;
    dRoad = chamferDistance(G.road, G.nx, G.nz);
    dBld = chamferDistance(G.bld, G.nx, G.nz);
    dWater = chamferDistance(G.water, G.nx, G.nz);
    dOccupy = chamferDistance(G.occupy, G.nx, G.nz);
    outside = floodOutside(G.occupy, G.nx, G.nz);
  }

  // ---------- trees3d=true：母树 + 栅格 + 实例树/绿篱（默认关闭，绿化走"面"）----------
  // 异步执行：母树按需动态加载 ez-tree；其就绪纳入 whenReady，不影响默认 flatFill 路径
  let trees3dReady = Promise.resolve();
  if (cfg.trees3d) {
    trees3dReady = (async () => {
    ginkgoLite = await makeTree({ seed: 11, leaf: 'aspen', bark: 'birch', trunk: 8, c0: 2, c1: 1, lc: 3, ls: 4.0, s0: 2, s1: 1, s2: 1, g0: 3, g1: 3, g2: 2 });
    oakLite = await makeTree({ seed: 12, leaf: 'oak', bark: 'oak', trunk: 9, levels: 1, c0: 2, lc: 3, ls: 4.2, s0: 2, s1: 1, s2: 1, g0: 3, g1: 2, g2: 2 });
    oakFull = await makeTree({ seed: 3, leaf: 'oak', bark: 'oak', trunk: 10, c0: 4, c1: 3, lc: 5, ls: 3.6 });
    window.__mothers = { ginkgoLite, oakLite, oakFull };

    const rowPts = placeAlong(G, dRoad, cfg.rowBandMin, cfg.rowBandMax, cfg.rowGap, {
      yMin: -1.5, yMax: 1.5,
      guard: (p) => dBld[p] >= cfg.rowMinDBld && dBld[p] <= cfg.rowMaxDBld && dWater[p] >= cfg.rowMinDWater,
    });
    const rowSet = makeInstanced(ginkgoLite, rowPts, 0xffc261);
    group.add(rowSet.branches, rowSet.leaves);

    const oakPts = placeAlong(G, dOccupy, cfg.oakBandMin, cfg.oakBandMax, cfg.oakGap, {
      y: cfg.forestY,
      guard: (p) => outside[p] && dBld[p] >= 4 && !G.lawn[p] && dRoad[p] > cfg.rowBandMax + 1,
    });
    const oakSet = makeInstanced(oakLite, oakPts, 0x86a86b);
    group.add(oakSet.branches, oakSet.leaves);

    const accentPts = placeAlong(G, dWater, cfg.accentWaterBandMin, cfg.accentWaterBandMax, cfg.accentGap, {
      yMin: -2.5, yMax: 2, guard: (p) => !G.hard[p] && !G.road[p], s: 1.15,
    }).slice(0, cfg.accentMax);
    const accentSet = makeInstanced(oakFull, accentPts, 0x86a86b);
    group.add(accentSet.branches, accentSet.leaves);

    const hedgeSegs = [];
    for (const b of BUILDINGS) {
      const t = cfg.hedgeW, g2 = cfg.hedgeGap;
      hedgeSegs.push({ x: b.wx, z: b.wz - b.d / 2 - t / 2 - g2, w: b.w + t * 2, d: t });
      hedgeSegs.push({ x: b.wx, z: b.wz + b.d / 2 + t / 2 + g2, w: b.w + t * 2, d: t });
      hedgeSegs.push({ x: b.wx - b.w / 2 - t / 2 - g2, z: b.wz, w: t, d: b.d + t * 2 });
      hedgeSegs.push({ x: b.wx + b.w / 2 + t / 2 + g2, z: b.wz, w: t, d: b.d + t * 2 });
    }
    const hedgeTex = new THREE.TextureLoader().load('../assets/textures/forest.jpg');
    hedgeTex.wrapS = hedgeTex.wrapT = THREE.RepeatWrapping; hedgeTex.anisotropy = 4;
    const hedgeMat = new THREE.MeshStandardMaterial({ map: hedgeTex, color: 0xd7e2c4, roughness: 1 });
    const him = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), hedgeMat, hedgeSegs.length);
    const hm = new THREE.Matrix4(), hq = new THREE.Quaternion(), hp = new THREE.Vector3(), hs = new THREE.Vector3();
    hedgeSegs.forEach((s, i) => {
      hp.set(s.x, cfg.hedgeH / 2, s.z); hs.set(s.w, cfg.hedgeH, s.d);
      hm.compose(hp, hq, hs); him.setMatrixAt(i, hm);
    });
    him.instanceMatrix.needsUpdate = true; him.computeBoundingSphere();
    group.add(him);
    counts = { rows: rowSet.count, oaks: oakSet.count, accents: accentSet.count, hedges: hedgeSegs.length };
    })();
  }

  // ---------- SDF 距离场着色器带：沿道路 + 建筑基部连续中深绿林冠（1 大面、GPU 插值连续、不压路面）----------
  if (cfg.flatFill && G) {
    const { nx, nz, N, cell, xMin, zMin } = G;
    const W = nx * cell, H = nz * cell;
    // 距离场烤成 RGBA byte DataTexture（归一化 d/DM；字节纹理普遍支持线性过滤 → 连续）
    const DM = 80; // 距离量程（m）
    const sdf = new Uint8Array(N * 4);
    const enc = (d) => (d < 0 ? 255 : Math.max(0, Math.min(255, Math.round((d * cell / DM) * 255))));
    for (let p = 0; p < N; p++) {
      const i = p * 4;
      sdf[i] = enc(dRoad[p]); sdf[i + 1] = enc(dBld[p]); sdf[i + 2] = enc(dWater[p]);
      // alpha=可绿化掩码：道路/人行道铺地/水面/楼栋上绝不画绿（只落草坪或真正空地），根治绿化压路网
      sdf[i + 3] = (G.road[p] || G.hard[p] || G.water[p] || G.bld[p]) ? 0 : 255;
    }
    const sdfTex = new THREE.DataTexture(sdf, nx, nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    sdfTex.minFilter = sdfTex.magFilter = THREE.LinearFilter;
    sdfTex.wrapS = sdfTex.wrapT = THREE.ClampToEdgeWrapping; sdfTex.needsUpdate = true;
    // 林冠纹理（raw sRGB，不转 linear；shader 直给显示色，可控不黑）
    const cTex = new THREE.TextureLoader().load('../assets/textures/grass.jpg'); flatTexs.push(cTex);
    cTex.wrapS = cTex.wrapT = THREE.RepeatWrapping; cTex.anisotropy = 8;
    const hx = (cfg.bandTint >> 16) & 255, hg = (cfg.bandTint >> 8) & 255, hb = cfg.bandTint & 255;
    const rx = (cfg.roadTint >> 16) & 255, rg = (cfg.roadTint >> 8) & 255, rb = cfg.roadTint & 255;
    const bandMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: true,
      uniforms: {
        uSDF: { value: sdfTex }, uCanopy: { value: cTex },
        uXMin: { value: xMin }, uZMin: { value: zMin }, uW: { value: W }, uH: { value: H },
        uTile: { value: cfg.flatTexTile }, uTint: { value: [hx / 255, hg / 255, hb / 255] },
        uRoadTint: { value: [rx / 255, rg / 255, rb / 255] },
        rIn: { value: cfg.sdfRoadIn }, rOut: { value: cfg.sdfRoadOut },
        bIn: { value: cfg.sdfBldIn }, bOut: { value: cfg.sdfBldOut }, maxDb: { value: cfg.sdfMaxDb },
        uDM: { value: DM },
      },
      vertexShader: `
        varying vec3 vW;
        void main(){ vec4 wp=modelMatrix*vec4(position,1.0); vW=wp.xyz; gl_Position=projectionMatrix*viewMatrix*wp; }
      `,
      fragmentShader: `
        precision highp float;
        varying vec3 vW;
        uniform sampler2D uSDF; uniform sampler2D uCanopy;
        uniform float uXMin,uZMin,uW,uH,uTile,rIn,rOut,bIn,bOut,maxDb,uDM;
        uniform vec3 uTint,uRoadTint;
        float bandF(float d,float i,float o){ return smoothstep(i,i+0.8,d)*(1.0-smoothstep(o-0.8,o,d)); }
        void main(){
          vec2 suv=vec2((vW.x-uXMin)/uW,(vW.z-uZMin)/uH);
          if(suv.x<0.0||suv.y<0.0||suv.x>1.0||suv.y>1.0) discard;
          vec4 s=texture2D(uSDF,suv);
          float dr=s.r*uDM,db=s.g*uDM,dw=s.b*uDM;
          float greenable=step(0.5,s.a); // 仅草坪/空地可绿化，道路/人行道/水面/楼栋一律不画
          float road=bandF(dr,rIn,rOut)*step(3.0,dw);   // 行道树带（含外围主路，不受距楼 maxDb 限制）
          float bl  =bandF(db,bIn,bOut)*step(db,maxDb); // 院内建筑基部带（只在楼附近）
          float m=max(road,bl)*greenable;
          if(m<0.10) discard;
          vec2 cuv=mod(vW.xz/uTile,1.0);
          vec3 cCan=texture2D(uCanopy,cuv).rgb;
          vec3 cBld=cCan*uTint;       // 建筑基部：中绿
          vec3 cRoad=(cCan*0.5+vec3(0.36))*uRoadTint;   // 沿道路：提亮减绿，金黄暖绿行道树
          float wRoad=clamp(road/(m+0.0001),0.0,1.0);
          vec3 c=mix(cBld,cRoad,wRoad);
          gl_FragColor=vec4(c,m);
        }
      `,
    });
    // 平面只覆盖园区占地包围盒（减少屏幕外片元、提帧率）
    let minGi = nx, maxGi = 0, minGj = nz, maxGj = 0;
    for (let gj = 0; gj < nz; gj++) for (let gi = 0; gi < nx; gi++) {
      if (G.occupy[gj * nx + gi]) {
        if (gi < minGi) minGi = gi; if (gi > maxGi) maxGi = gi;
        if (gj < minGj) minGj = gj; if (gj > maxGj) maxGj = gj;
      }
    }
    const pad = 2;
    minGi = Math.max(0, minGi - pad); maxGi = Math.min(nx - 1, maxGi + pad);
    minGj = Math.max(0, minGj - pad); maxGj = Math.min(nz - 1, maxGj + pad);
    const px0 = xMin + minGi * cell, pz0 = zMin + minGj * cell;
    const PW = (maxGi - minGi + 1) * cell, PH = (maxGj - minGj + 1) * cell;
    const bandPlane = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), bandMat);
    bandPlane.rotation.x = -Math.PI / 2;
    bandPlane.position.set(px0 + PW / 2, cfg.flatY, pz0 + PH / 2);
    group.add(bandPlane);
    counts.sdfBand = 1;
  }

  // ---------- 外围贴地林海（大平面，始终建；内部地面几何自然遮挡，只在园区外露出）----------
  const fTex = new THREE.TextureLoader().load('../assets/textures/forest.jpg');
  fTex.wrapS = fTex.wrapT = THREE.RepeatWrapping;
  const fs = cfg.forestSpan * 2, rep = fs / cfg.forestTile;
  fTex.repeat.set(rep, rep); fTex.anisotropy = 8; fTex.colorSpace = THREE.SRGBColorSpace;
  const fPlane = new THREE.Mesh(
    new THREE.PlaneGeometry(fs, fs),
    new THREE.MeshStandardMaterial({ map: fTex, roughness: 1, color: 0xffffff })
  );
  fPlane.rotation.x = -Math.PI / 2; fPlane.position.set(cc.x, cfg.forestY, cc.z);
  group.add(fPlane);

  scene.add(group);

  // ---------- 贴图就绪 Promise（异步 decode，ready 后强制渲染上传 GPU）----------
  const watchTex = [fTex, ...flatTexs];
  for (const t of [ginkgoLite, oakLite, oakFull]) {
    if (!t) continue;
    [t.branchesMesh, t.leavesMesh].forEach((m) => {
      ['map', 'normalMap', 'aoMap', 'roughnessMap'].forEach((k) => { if (m.material[k]) watchTex.push(m.material[k]); });
    });
  }
  const texReady = new Promise((resolve) => {
    const check = () => {
      const ok = watchTex.every((t) => !t.image || t.image.complete);
      if (ok) setTimeout(resolve, 60); else setTimeout(check, 80);
    };
    check();
  });
  // 贴图就绪 + （可选）立体树异步构建全部完成才算 ready
  const whenReady = trees3dReady.then(() => texReady);

  // ---------- 每帧：trees3d 时风动（更新母树 uTime 即全部实例同步）----------
  function update() {
    if (!cfg.trees3d) return;
    const t = performance.now() / 1000;
    for (const tr of [ginkgoLite, oakLite, oakFull]) { if (tr && typeof tr.update === 'function') tr.update(t); }
  }

  return { group, update, whenReady, counts };
}
