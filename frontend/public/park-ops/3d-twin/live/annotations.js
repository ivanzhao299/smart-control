// annotations.js — 3D 孪生标注编辑系统：楼栋企业名 + 自定义 3D 锚点文字（分区/多边形下一步）
// 对标原鸟瞰页 phases/buildings(company)/customTexts，并以"世界坐标锚定"超越 2D 百分比标注。
// 数据先本地 localStorage 持久化；结构预留服务器同步。
import * as THREE from 'three';

const KEY = 'sc.twin.annotations.v1';
const CSS = `
.ann-layer{position:absolute;inset:0;pointer-events:none;overflow:hidden;z-index:7}
.ann-tag{position:absolute;top:0;left:0;font:600 13px/1.3 -apple-system,"PingFang SC",sans-serif;
 padding:4px 11px;color:var(--tc,#eaf3ff);border-radius:8px;white-space:nowrap;letter-spacing:.4px;text-shadow:0 0 7px rgba(120,170,255,.6);
 background:linear-gradient(180deg,rgba(38,52,78,.9),rgba(16,26,44,.88) 55%,rgba(10,18,32,.92));
 border:1px solid rgba(120,170,255,.5);
 box-shadow:0 8px 20px rgba(0,0,0,.45),0 0 13px rgba(120,170,255,.45),inset 0 1px 0 rgba(255,255,255,.2),inset 0 -1px 0 rgba(0,0,0,.35);
 will-change:transform}
.ann-tag::before{content:'';position:absolute;inset:0;border-radius:8px;pointer-events:none;
 background:linear-gradient(115deg,rgba(255,255,255,.16) 0%,rgba(255,255,255,.04) 28%,transparent 46%)}
.ann-tag.editable{pointer-events:auto;cursor:pointer;border-color:rgba(255,200,90,.75)}
.ann-tag::after{content:'';position:absolute;top:100%;left:50%;transform:translateX(-50%);
 border:11px solid transparent;border-top-color:#6aa6f0;
 filter:drop-shadow(0 0 5px #6aa6f0) drop-shadow(0 2px 3px rgba(0,0,0,.6))}
.ann-bar{position:absolute;left:14px;bottom:14px;z-index:20;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.ann-bar button{pointer-events:auto;font:600 12px sans-serif;padding:7px 12px;border-radius:8px;cursor:pointer;
 color:#eaf3ff;background:linear-gradient(180deg,rgba(42,62,94,.92),rgba(24,38,62,.9));
 border:1px solid rgba(120,170,255,.4);box-shadow:0 4px 12px rgba(0,0,0,.35)}
.ann-bar button.primary{background:linear-gradient(180deg,rgba(38,112,152,.96),rgba(22,82,122,.92));border-color:rgba(90,200,255,.6)}
.ann-bar button.active{background:linear-gradient(180deg,rgba(190,128,32,.96),rgba(146,94,20,.92));border-color:rgba(255,200,90,.75);color:#fff}
.ann-bar .extra{display:none;gap:8px}
.ann-bar .extra.show{display:flex}
.ann-bar .hint{font:11px sans-serif;color:#ffd8a0;background:rgba(22,16,6,.82);padding:5px 9px;border-radius:6px;border:1px solid rgba(255,200,90,.4)}
`;

function load() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
function persist(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* 配额满 */ } }
function uid() { return 't' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

export function createAnnotations({ scene, camera, renderer, bldLayer }) {
  const loaded = load();
  const data = { companies: loaded.companies || {}, texts: loaded.texts || [] };
  let editing = false, placing = false;
  const host = renderer.domElement.parentElement;

  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style);
  const layerEl = document.createElement('div'); layerEl.className = 'ann-layer'; host.appendChild(layerEl);

  const items = [];
  function makeTag(t) {
    const e = document.createElement('div');
    e.className = 'ann-tag'; e.textContent = t.text;
    if (t.color) e.style.setProperty('--tc', t.color);
    e.addEventListener('click', (ev) => {
      if (!editing) return;
      ev.stopPropagation();
      if (confirm(`删除标注「${t.text}」？`)) {
        const i = items.findIndex(o => o.t === t);
        if (i >= 0) { items[i].e.remove(); items.splice(i, 1); }
        const j = data.texts.indexOf(t); if (j >= 0) data.texts.splice(j, 1);
        persist(data);
      }
    });
    layerEl.appendChild(e);
    items.push({ t, e });
  }
  data.texts.forEach(makeTag);

  // 工具栏
  const bar = document.createElement('div'); bar.className = 'ann-bar'; host.appendChild(bar);
  bar.innerHTML = `
    <button type="button" class="primary" data-act="edit">标注编辑</button>
    <span class="extra">
      <button type="button" data-act="add">+ 添加文字</button>
      <button type="button" data-act="done">完成</button>
      <span class="hint">点楼栋可改企业名 · 点「添加文字」再点场景放置</span>
    </span>`;
  const editBtn = bar.querySelector('[data-act=edit]');
  const extra = bar.querySelector('.extra');
  const addBtn = bar.querySelector('[data-act=add]');

  function setEditing(v) {
    editing = v; setPlacing(false);
    extra.classList.toggle('show', v);
    editBtn.textContent = v ? '退出编辑' : '标注编辑';
    editBtn.classList.toggle('active', v);
    for (const { e } of items) e.classList.toggle('editable', v);
    refreshCard();
  }
  function setPlacing(v) {
    placing = v;
    addBtn.classList.toggle('active', v);
    addBtn.textContent = v ? '点击场景放置…' : '+ 添加文字';
    renderer.domElement.style.cursor = v ? 'crosshair' : '';
  }

  bar.addEventListener('click', (ev) => {
    const act = ev.target?.dataset?.act;
    if (act === 'edit') setEditing(!editing);
    else if (act === 'done') setEditing(false);
    else if (act === 'add' && editing) setPlacing(!placing);
  });

  function getCompany(id) { return data.companies[id] || ''; }

  // 楼栋信息卡：企业名编辑
  let cardSlot = null;
  function onSelect(slot, b) {
    cardSlot = slot;
    slot.innerHTML = `<label>入驻企业名称</label><input type="text" placeholder="未绑定 / 招商中" />`;
    const input = slot.querySelector('input');
    input.value = data.companies[b.id] || '';
    input.disabled = !editing;
    input.oninput = () => {
      if (input.value) data.companies[b.id] = input.value;
      else delete data.companies[b.id];
      persist(data); bldLayer.refreshLabels();
    };
  }
  function refreshCard() {
    if (cardSlot) {
      const input = cardSlot.querySelector('input');
      if (input) input.disabled = !editing;
    }
  }

  // 放置文字：拦截 canvas 点击
  function handleClick(clientX, clientY) {
    if (!placing) return false;
    const p = bldLayer.groundPoint(clientX, clientY);
    if (p) {
      const text = prompt('输入要标注的文字（企业名 / 区域名 / 提示语）', '');
      if (text && text.trim()) {
        const t = { id: uid(), text: text.trim(), x: Math.round(p.x), y: 3, z: Math.round(p.z), size: 13, color: '#eaf3ff' };
        data.texts.push(t); makeTag(t); persist(data);
      }
    }
    setPlacing(false);
    return true;
  }

  const v = new THREE.Vector3();
  function update() {
    const W = layerEl.clientWidth || 1, H = layerEl.clientHeight || 1;
    for (const { t, e } of items) {
      v.set(t.x, t.y, t.z).project(camera);
      if (v.z > 1 || v.z < -1) { e.style.display = 'none'; continue; }
      e.style.display = '';
      const x = (v.x * 0.5 + 0.5) * W, y = (-v.y * 0.5 + 0.5) * H;
      e.style.transform = `translate(-50%,calc(-100% - 13px)) translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
    }
  }

  return {
    getCompany, onSelect, handleClick, update,
    setEditing, refreshCard, get editing() { return editing; },
  };
}
