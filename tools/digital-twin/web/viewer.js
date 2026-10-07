import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { textureBudget } from './texture-budget.js';

const $ = id => document.getElementById(id);
const status = text => { $('message').textContent = text; };
let renderer, controls, scene, camera, model, frame = 0, selected;
let manifest = null, version = 0, savedVersion = 0, loadSequence = 0;
const entities = new Map(), objects = new Map();
const target = new THREE.Vector3();
let radius = 30;
window.TWIN_DEBUG = { renders: 0, camera: () => camera?.position.toArray(), transforms: () => model?.children.map(o => o.matrix.toArray()) };

fetch('/api/job').then(r => r.json()).then(report => {
  if (!report) { $('intake').textContent = '还没有资产检查报告'; return; }
  $('intake').replaceChildren();
  for (const text of [`贴图匹配 ${report.matchedTextures} / ${report.matchedTextures}`, `原贴图 ${(report.sourceTextureBytes / 1048576).toFixed(1)} MiB`, `网页副本 ${(report.webTextureBytes / 1048576).toFixed(2)} MiB`, '纹理准备完成不等于材质恢复完成']) {
    const p = document.createElement('p'); p.textContent = text; $('intake').append(p);
  }
  $('textureDot').classList.add('ready');
}).catch(() => { $('intake').textContent = '检查报告暂不可用'; });

function invalidate() {
  if (frame || document.hidden || !renderer) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (document.hidden) return;
    renderer.render(scene, camera);
    window.TWIN_DEBUG.renders++;
  });
}

function init() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1));
  renderer.setClearColor(0x10212b);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(40, 1, 0.1, 10000);
  scene.add(new THREE.HemisphereLight(0xe8f9ff, 0x43534a, 2.3));
  const light = new THREE.DirectionalLight(0xfff3df, 2.5);
  light.position.set(40, 100, 60); scene.add(light);
  $('viewport').append(renderer.domElement);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false; controls.autoRotate = false;
  controls.maxPolarAngle = Math.PI * .49;
  controls.addEventListener('change', invalidate);
  const resize = () => {
    const { width, height } = $('viewport').getBoundingClientRect();
    renderer.setSize(width, height, false); camera.aspect = width / Math.max(height, 1); camera.updateProjectionMatrix(); invalidate();
  };
  new ResizeObserver(resize).observe($('viewport')); resize();
  let pointerStart;
  renderer.domElement.addEventListener('pointerdown', e => { pointerStart = [e.clientX, e.clientY]; });
  renderer.domElement.addEventListener('click', e => {
    if (!model || !pointerStart || Math.hypot(e.clientX - pointerStart[0], e.clientY - pointerStart[1]) > 5) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2((e.clientX - rect.left) / rect.width * 2 - 1, -(e.clientY - rect.top) / rect.height * 2 + 1), camera);
    const hit = ray.intersectObject(model, true)[0];
    const attribute = hit?.object.geometry?.getAttribute('_entity_id');
    if (attribute) {
      let batch = hit.object;
      while (batch && !batch.userData.sourceEntities) batch = batch.parent;
      const vertex = hit.object.geometry.index ? hit.object.geometry.index.getX(hit.faceIndex * 3) : hit.faceIndex * 3;
      const entity = batch?.userData.sourceEntities[attribute.getX(vertex)];
      if (entity) select(entity.id);
      return;
    }
    let object = hit?.object;
    while (object && !object.userData.twinId) object = object.parent;
    if (object) select(object.userData.twinId);
  });
  renderer.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); status('图形上下文已丢失，请刷新工作台重新加载。'); });
}

function preset(azimuth, elevation = 40) {
  if (!camera || !model) return;
  const a = THREE.MathUtils.degToRad(azimuth), e = THREE.MathUtils.degToRad(elevation);
  // Rotate the camera around a fixed model and target. Never rotate/mirror the image or scene.
  camera.position.set(target.x + radius * Math.cos(e) * Math.sin(a), target.y + radius * Math.sin(e), target.z + radius * Math.cos(e) * Math.cos(a));
  camera.near = Math.max(radius / 1000, .01); camera.far = radius * 20; camera.updateProjectionMatrix();
  controls.target.copy(target); controls.minDistance = radius * .1; controls.maxDistance = radius * 5;
  controls.update(); invalidate();
}
$('front').onclick = () => preset(0);
$('opposite').onclick = () => preset(180);
$('top').onclick = () => preset(0, 88);
function frameBox(box) {
  box.getCenter(target);
  const size = box.getSize(new THREE.Vector3());
  const fov = Math.min(THREE.MathUtils.degToRad(camera.fov), 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect));
  radius = size.length() / (2 * Math.sin(fov / 2)) * 1.1;
  if (!Number.isFinite(radius) || radius <= 0) throw Error('模型包围盒无效');
  preset(0);
}
$('all').onclick = () => { if (model) frameBox(new THREE.Box3().setFromObject(model)); };
$('focus').onclick = () => {
  if (!model || !manifest?.reviewFocus) { status('当前模型未提供园区主体建议取景，可拖动和缩放相机。'); return; }
  frameBox(new THREE.Box3(new THREE.Vector3(...manifest.reviewFocus.min), new THREE.Vector3(...manifest.reviewFocus.max)));
  status('已对主体密集构件取景；这是相机建议范围，不是分期或地理边界。');
};

function dispose(root) {
  if (!root) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      materials.add(m);
      for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    }
  });
  geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => { t.source?.data?.close?.(); t.dispose(); });
}

function select(id) {
  selected = entities.get(id);
  if (!selected) return;
  $('entity').value = id;
  for (const field of ['twinId', 'label', 'buildingNumber', 'phase', 'tenantNames', 'deviceIds']) {
    $(''+field).value = field === 'twinId' ? selected.id : Array.isArray(selected[field]) ? selected[field].join(', ') : selected[field] ?? '';
  }
}
$('entity').onchange = e => select(e.target.value);
for (const field of ['label', 'buildingNumber', 'phase', 'tenantNames', 'deviceIds']) {
  $(field).addEventListener('input', () => {
    if (!selected) return;
    selected[field] = ['tenantNames', 'deviceIds'].includes(field) ? $(field).value.split(/[,，]/).map(s => s.trim()).filter(Boolean) : $(field).value;
    selected.mappingStatus = 'draft'; version++;
    status('楼栋信息已修改，请下载 JSON 保存。');
  });
}

async function load(buffer, name, suppliedManifest = null, sequence = ++loadSequence) {
  if (buffer.byteLength > 20 * 1048576) throw Error('文件超过 20 MiB，请先在工作流中优化');
  const bytes = new Uint8Array(buffer), header = new DataView(buffer);
  if (buffer.byteLength < 20 || header.getUint32(0, true) !== 0x46546c67 || header.getUint32(4, true) !== 2 || header.getUint32(8, true) !== buffer.byteLength || header.getUint32(16, true) !== 0x4e4f534a) throw Error('GLB 文件头无效');
  const jsonSize = header.getUint32(12, true);
  if (20 + jsonSize > buffer.byteLength) throw Error('GLB 内容不完整');
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + jsonSize)));
  textureBudget(buffer, json);
  if ([...(json.images ?? []), ...(json.buffers ?? [])].some(v => v.uri && !v.uri.startsWith('data:'))) throw Error('请导入已打包贴图的自包含 GLB');
  let triangles = 0, calls = 0;
  for (const n of json.nodes ?? []) if (n.mesh !== undefined) for (const p of json.meshes[n.mesh].primitives) {
    if ((p.mode ?? 4) !== 4) throw Error('仅接受三角面模型');
    calls++; triangles += (json.accessors[p.indices ?? p.attributes.POSITION]?.count ?? 0) / 3;
  }
  if (!calls || triangles > 300000 || calls > 200) throw Error('模型超出预览预算：≤30万三角面、≤200绘制批次');
  init();
  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (!url.startsWith('blob:') && !url.startsWith('data:')) throw Error('外部纹理请求已阻止');
    return url;
  });
  const loader = new GLTFLoader(manager).setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(buffer, '');
  if (sequence !== loadSequence) { dispose(gltf.scene); return; }
  const previous = model;
  model = gltf.scene;
  if (previous) { scene.remove(previous); dispose(previous); }
  entities.clear(); objects.clear();
  const embeddedClay = json.nodes?.some(n => n.extras?.materialMode === 'clay-preview');
  manifest = suppliedManifest ?? { schemaVersion: 1, sourceId: 'local-unassigned', fixture: false,
    materialMode: embeddedClay ? 'clay-preview' : 'unreviewed', units: embeddedClay ? 'unverified-source-units' : 'metres',
    upAxis: 'Y', entities: [], telemetry: { mode: 'disconnected', readOnly: true } };
  const supplied = new Map(manifest.entities.map(e => [e.id, e]));
  const register = (o, id) => {
    o.userData.twinId = id;
    entities.set(id, supplied.get(id) ?? { id, nodeName: o.name, label: o.name, phase: null, buildingNumber: null, tenantNames: [], deviceIds: [], mappingStatus: 'unassigned' });
    objects.set(id, o);
  };
  // GLTFLoader makes a Group for a multi-material mesh. The node ID belongs to that
  // group, not to each generated primitive child, so register explicit node IDs first.
  model.traverse(o => {
    if (Array.isArray(o.userData.sourceEntities)) {
      for (const entity of o.userData.sourceEntities) {
        entities.set(entity.id, supplied.get(entity.id) ?? entity); objects.set(entity.id, o);
      }
    } else if (o.userData.twinId && !o.userData.isGeometryBatch) register(o, o.userData.twinId);
  });
  model.traverse(o => {
    if (!o.isMesh) return;
    let parent = o;
    while (parent && !parent.userData.twinId) parent = parent.parent;
    if (!parent) register(o, `unmapped-${o.name}-${entities.size}`);
  });
  manifest.entities = [...entities.values()];
  scene.add(model);
  if (manifest.reviewFocus) $('focus').onclick();
  else frameBox(new THREE.Box3().setFromObject(model));
  $('empty').style.display = 'none'; $('assetLabel').textContent = name;
  $('badge').hidden = false; $('badge').textContent = manifest.fixture ? '流程测试模型 · 非真实园区' : manifest.materialMode === 'clay-preview' ? '真实 MAX 几何 · 简化白模 · 非原始材质 · 完整性待核对' : '原始材质恢复候选 · 本地验收中 · 尚未发布生产';
  $('entity').replaceChildren(...[...entities.values()].map(e => { const opt = document.createElement('option'); opt.value = e.id; opt.textContent = e.label; return opt; }));
  select(entities.keys().next().value); $('save').disabled = false;
  $('metrics').textContent = `${(buffer.byteLength / 1048576).toFixed(2)} MiB · ${entities.size} 对象 · ${triangles} 三角面`;
  version = savedVersion = 0; status('模型已加载。相机可绕到另一侧，模型坐标保持不变。'); invalidate();
}

$('fixture').onclick = async () => {
  if (version !== savedVersion && !confirm('楼栋信息尚未下载。放弃这次修改并切换模型？')) return;
  const sequence = ++loadSequence;
  try {
    const [asset, metadata] = await Promise.all([fetch('/preview/scene.glb'), fetch('/preview/twin-manifest.json')]);
    if (!asset.ok || !metadata.ok) throw Error('还没有流程测试模型，请先运行本地验证工作流');
    await load(await asset.arrayBuffer(), '工作流测试模型', await metadata.json(), sequence);
  } catch (e) { status(e.message); }
};
$('real').onclick = async () => {
  if (version !== savedVersion && !confirm('楼栋信息尚未下载。放弃这次修改并切换模型？')) return;
  const sequence = ++loadSequence;
  try {
    const [asset, metadata] = await Promise.all([fetch('/real/scene.glb'), fetch('/real/twin-manifest.json')]);
    if (!asset.ok || !metadata.ok) throw Error('当前服务未挂载真实园区验证版，请设置 TWIN_REAL_PREVIEW');
    await load(await asset.arrayBuffer(), '金湖园区 · MAX 实际几何验证版', await metadata.json(), sequence);
    $('maxDot').classList.add('ready'); $('maxState').textContent = '真实 MAX 已在本机提取';
  } catch (e) { status(e.message); }
};
$('file').onchange = async e => {
  const file = e.target.files[0]; if (!file) return;
  if (file.size > 20 * 1048576) { status('文件超过 20 MiB，请先优化'); e.target.value = ''; return; }
  if (version !== savedVersion && !confirm('楼栋信息尚未下载。放弃这次修改并切换模型？')) return;
  const sequence = ++loadSequence;
  try { await load(await file.arrayBuffer(), file.name, null, sequence); } catch (e) { status(e.message); }
  e.target.value = '';
};
$('save').onclick = () => {
  const blob = new Blob([JSON.stringify(manifest, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = 'twin-manifest.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000); savedVersion = version;
  status('已发起映射文件下载，请确认文件已保存。');
};
$('mappingFile').onchange = async e => {
  const file = e.target.files[0];
  try {
    if (!manifest || !file) throw Error('请先加载对应的三维模型');
    if (file.size > 2 * 1048576) throw Error('映射文件过大');
    const incoming = JSON.parse(await file.text());
    if (incoming.schemaVersion !== 1 || !Array.isArray(incoming.entities)) throw Error('映射格式不正确');
    const ids = new Set(incoming.entities.map(v => v.id));
    if (ids.size !== incoming.entities.length || ids.size !== entities.size || [...ids].some(id => !entities.has(id))) throw Error('楼栋标识与当前模型不一致，不能载入');
    // Validate the whole file before changing any entity; only accept editable fields.
    for (const v of incoming.entities) {
      if (typeof v.label !== 'string' || (v.buildingNumber != null && typeof v.buildingNumber !== 'string') || ![null, '', 'phase-1', 'phase-2', 'future'].includes(v.phase) || !['tenantNames', 'deviceIds'].every(k => Array.isArray(v[k]) && v[k].every(x => typeof x === 'string'))) throw Error('映射字段无效');
    }
    for (const v of incoming.entities) {
      const targetEntity = entities.get(v.id);
      for (const key of ['label', 'buildingNumber', 'phase', 'tenantNames', 'deviceIds']) targetEntity[key] = v[key];
      targetEntity.mappingStatus = 'draft';
    }
    select($('entity').value); version = savedVersion = version + 1;
    status('已从本地 JSON 恢复楼栋映射。');
  } catch (error) { status(error.message); }
  e.target.value = '';
};
document.addEventListener('visibilitychange', invalidate);
window.addEventListener('beforeunload', e => { if (version !== savedVersion) { e.preventDefault(); e.returnValue = ''; } });
