// buildings.js — S1 数据内容层（floor3d-card 范式）：楼栋数据 + 轻量屏幕投影标签 + Box描边选中 + 信息卡
// 自足：样式 JS 注入；标签用 世界位置→屏幕投影（不依赖 CSS2DRenderer）；选中用 Box 边（适配合批模型）。
import * as THREE from 'three';

export const BUILDINGS = [{"id":0,"name":"产研楼 1","type":"prod","wx":7,"wz":-209,"w":64,"d":32,"top":26,"occupancy":55,"companies":8},{"id":1,"name":"产研楼 2","type":"prod","wx":78,"wz":-208,"w":64,"d":32,"top":26,"occupancy":72,"companies":10},{"id":2,"name":"配套服务楼 1","type":"aux","wx":408,"wz":-208,"w":48,"d":32,"top":23,"occupancy":89,"companies":13},{"id":3,"name":"科创大厦","type":"tower","wx":321,"wz":-208,"w":96,"d":32,"top":56,"occupancy":61,"companies":9},{"id":4,"name":"产研楼 3","type":"prod","wx":197,"wz":-202,"w":144,"d":64,"top":21,"occupancy":78,"companies":11},{"id":5,"name":"产研楼 4","type":"prod","wx":85,"wz":-179,"w":64,"d":32,"top":20,"occupancy":95,"companies":14},{"id":6,"name":"配套服务楼 2","type":"aux","wx":423,"wz":-163,"w":40,"d":40,"top":16,"occupancy":67,"companies":10},{"id":7,"name":"产研楼 5","type":"prod","wx":358,"wz":-158,"w":40,"d":56,"top":23,"occupancy":84,"companies":12},{"id":8,"name":"产研楼 6","type":"prod","wx":390,"wz":-135,"w":24,"d":64,"top":17,"occupancy":56,"companies":8},{"id":9,"name":"产研楼 7","type":"prod","wx":321,"wz":-96,"w":96,"d":104,"top":25,"occupancy":73,"companies":10},{"id":10,"name":"配套服务楼 3","type":"aux","wx":59,"wz":-74,"w":24,"d":40,"top":17,"occupancy":90,"companies":13},{"id":11,"name":"配套服务楼 4","type":"aux","wx":147,"wz":-74,"w":24,"d":40,"top":17,"occupancy":62,"companies":9},{"id":12,"name":"配套服务楼 5","type":"aux","wx":206,"wz":-71,"w":40,"d":32,"top":18,"occupancy":79,"companies":11},{"id":13,"name":"产研楼 8","type":"prod","wx":-22,"wz":1,"w":24,"d":56,"top":14,"occupancy":96,"companies":14},{"id":14,"name":"产研楼 9","type":"prod","wx":319,"wz":8,"w":88,"d":88,"top":24,"occupancy":68,"companies":10},{"id":15,"name":"产研楼 10","type":"prod","wx":202,"wz":31,"w":40,"d":64,"top":17,"occupancy":85,"companies":12},{"id":16,"name":"配套服务楼 6","type":"aux","wx":514,"wz":45,"w":48,"d":24,"top":17,"occupancy":57,"companies":8},{"id":17,"name":"产研楼 11","type":"prod","wx":320,"wz":87,"w":80,"d":40,"top":26,"occupancy":74,"companies":11},{"id":18,"name":"产研楼 12","type":"prod","wx":43,"wz":173,"w":64,"d":48,"top":21,"occupancy":91,"companies":13},{"id":19,"name":"配套服务楼 7","type":"aux","wx":304,"wz":174,"w":48,"d":32,"top":25,"occupancy":63,"companies":9},{"id":20,"name":"产研楼 13","type":"prod","wx":230,"wz":179,"w":72,"d":64,"top":16,"occupancy":80,"companies":11},{"id":21,"name":"产研楼 14","type":"prod","wx":393,"wz":198,"w":40,"d":88,"top":25,"occupancy":97,"companies":14},{"id":22,"name":"配套服务楼 8","type":"aux","wx":517,"wz":212,"w":48,"d":32,"top":16,"occupancy":69,"companies":10},{"id":23,"name":"配套服务楼 9","type":"aux","wx":470,"wz":215,"w":32,"d":32,"top":17,"occupancy":86,"companies":12},{"id":24,"name":"产研楼 15","type":"prod","wx":-17,"wz":220,"w":40,"d":136,"top":26,"occupancy":58,"companies":8},{"id":25,"name":"配套服务楼 10","type":"aux","wx":309,"wz":221,"w":32,"d":40,"top":25,"occupancy":75,"companies":11},{"id":26,"name":"产研楼 16","type":"prod","wx":40,"wz":244,"w":64,"d":48,"top":21,"occupancy":92,"companies":13},{"id":27,"name":"产研楼 17","type":"prod","wx":206,"wz":248,"w":32,"d":64,"top":17,"occupancy":64,"companies":9},{"id":28,"name":"配套服务楼 11","type":"aux","wx":408,"wz":268,"w":32,"d":40,"top":25,"occupancy":81,"companies":12},{"id":29,"name":"配套服务楼 12","type":"aux","wx":317,"wz":270,"w":40,"d":32,"top":25,"occupancy":98,"companies":14},{"id":30,"name":"产研楼 18","type":"prod","wx":470,"wz":271,"w":32,"d":56,"top":17,"occupancy":70,"companies":10},{"id":31,"name":"配套服务楼 13","type":"aux","wx":517,"wz":289,"w":40,"d":40,"top":17,"occupancy":87,"companies":12},{"id":32,"name":"产研楼 19","type":"prod","wx":43,"wz":318,"w":64,"d":16,"top":20,"occupancy":59,"companies":8},{"id":33,"name":"配套服务楼 14","type":"aux","wx":147,"wz":319,"w":40,"d":48,"top":16,"occupancy":76,"companies":11},{"id":34,"name":"配套服务楼 15","type":"aux","wx":301,"wz":325,"w":32,"d":40,"top":25,"occupancy":93,"companies":13},{"id":35,"name":"产研楼 20","type":"prod","wx":416,"wz":339,"w":48,"d":88,"top":25,"occupancy":65,"companies":9},{"id":36,"name":"产研楼 21","type":"prod","wx":469,"wz":357,"w":32,"d":56,"top":17,"occupancy":82,"companies":12},{"id":37,"name":"产研楼 22","type":"prod","wx":190,"wz":358,"w":120,"d":48,"top":17,"occupancy":99,"companies":14},{"id":38,"name":"配套服务楼 16","type":"aux","wx":521,"wz":360,"w":32,"d":48,"top":16,"occupancy":71,"companies":10},{"id":39,"name":"配套服务楼 17","type":"aux","wx":313,"wz":371,"w":48,"d":48,"top":23,"occupancy":88,"companies":13},{"id":40,"name":"产研楼 23","type":"prod","wx":-18,"wz":374,"w":48,"d":128,"top":26,"occupancy":60,"companies":9},{"id":41,"name":"产研楼 25","type":"prod","wx":368,"wz":400,"w":64,"d":32,"top":26,"occupancy":77,"companies":11},{"id":42,"name":"产研楼 24","type":"prod","wx":155,"wz":400,"w":64,"d":48,"top":17,"occupancy":94,"companies":13}];

const CSS = `
.bld-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:6}
.bld-tag{position:absolute;top:0;left:0;font:12px/1.3 -apple-system,"PingFang SC",sans-serif;
 padding:2px 7px;background:rgba(8,20,26,.62);border:1px solid var(--oc,rgba(70,210,195,.45));color:#cdf5ec;
 border-radius:5px;white-space:nowrap;backdrop-filter:blur(3px);will-change:transform;transition:background .15s,border-color .15s}
.bld-tag.active{background:rgba(20,90,84,.9);border-color:#42f0d2;color:#eafffb;box-shadow:0 0 10px rgba(60,230,205,.45)}
.bld-card{position:absolute;top:14px;right:14px;width:238px;pointer-events:auto;border-radius:12px;
 background:rgba(10,22,28,.92);border:1px solid rgba(70,210,195,.4);color:#e7f4f1;padding:13px 14px;
 box-shadow:0 10px 34px rgba(0,0,0,.5);backdrop-filter:blur(8px);transform:translateX(18px);opacity:0;
 transition:transform .18s ease,opacity .18s ease}
.bld-card.show{transform:none;opacity:1}
.bld-card h4{margin:0 0 2px;font-size:15px}
.bld-card .t{font:11px sans-serif;color:#7fc7bd;margin-bottom:9px}
.bld-card .row{display:flex;justify-content:space-between;font:12px sans-serif;margin:5px 0;color:#cfe3df}
.bld-card .bar{height:6px;border-radius:4px;background:rgba(255,255,255,.1);overflow:hidden;margin-top:3px}
.bld-card .bar i{display:block;height:100%;background:linear-gradient(90deg,#2ad0b4,#6af0d8);border-radius:4px}
.bld-card .x{position:absolute;top:8px;right:10px;cursor:pointer;color:#8fb8b2;font-size:15px}
`;

export function createBuildingLayer(scene, camera, renderer) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const host = renderer.domElement.parentElement;
  const layer = document.createElement('div'); layer.className = 'bld-layer'; host.appendChild(layer);

  const hl = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(1,1,1)),
    new THREE.LineBasicMaterial({ color: 0x3df0d2, transparent: true, opacity: 0.95 })
  );
  hl.visible = false; hl.renderOrder = 5; scene.add(hl);

  const card = document.createElement('div'); card.className = 'bld-card'; host.appendChild(card);
  const TYPE_NAME = { tower:'科创大厦', aux:'配套服务楼', prod:'产研楼' };

  const occColor = (o) => o >= 85 ? 'rgba(80,235,195,.75)' : o >= 60 ? 'rgba(90,195,235,.55)' : 'rgba(240,180,90,.7)';
  const tags = BUILDINGS.map((b) => {
    const e = document.createElement('div'); e.className = 'bld-tag'; e.textContent = b.name;
    e.style.setProperty('--oc', occColor(b.occupancy));
    layer.appendChild(e);
    return { b, e };
  });

  const v = new THREE.Vector3();
  function update() {
    const W = layer.clientWidth || 1, H = layer.clientHeight || 1;
    for (const { b, e } of tags) {
      v.set(b.wx, b.top + 2.5, b.wz).project(camera);
      if (v.z > 1 || v.z < -1) { e.style.display = 'none'; continue; }
      e.style.display = '';
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      e.style.transform = `translate(-50%,-100%) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pickAt(clientX, clientY) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const t = (0 - ray.ray.origin.y) / ray.ray.direction.y;
    if (!isFinite(t) || t < 0) return null;
    const px = ray.ray.origin.x + ray.ray.direction.x * t;
    const pz = ray.ray.origin.z + ray.ray.direction.z * t;
    let hit = null;
    for (const b of BUILDINGS) {
      if (Math.abs(px - b.wx) <= b.w / 2 && Math.abs(pz - b.wz) <= b.d / 2) {
        if (!hit || b.w * b.d < hit.w * hit.d) hit = b;
      }
    }
    return hit;
  }

  let selected = null;
  function select(b) {
    selected = b;
    for (const { b: bb, e } of tags) e.classList.toggle('active', bb === b);
    if (!b) { hl.visible = false; card.classList.remove('show'); return; }
    hl.visible = true;
    hl.position.set(b.wx, b.top / 2, b.wz);
    hl.scale.set(b.w, b.top, b.d);
    card.innerHTML = `<span class="x">×</span><h4>${b.name}</h4>
      <div class="t">${TYPE_NAME[b.type] || ''}</div>
      <div class="row"><span>入驻率</span><span>${b.occupancy}%</span></div>
      <div class="bar"><i style="width:${b.occupancy}%"></i></div>
      <div class="row"><span>入驻企业</span><span>${b.companies} 家</span></div>`;
    card.classList.add('show');
    card.querySelector('.x').onclick = () => select(null);
  }

  return { update, pickAt, select, get selected(){ return selected; } };
}
