import { defaults, fields, copyFields, validate, displayValue, apiURL, STORAGE_KEY } from './ops-data-model.mjs';

// This module runs after park-ops-editor.js has registered the original DOM's
// text keys. Do not change the map DOM, its coordinates, or shared layout store.
const stylesheet = document.createElement('link');
stylesheet.rel = 'stylesheet'; stylesheet.href = new URL('./ops-content.css', document.currentScript?.src || document.baseURI); document.head.append(stylesheet);
const clone = value => JSON.parse(JSON.stringify(value));
async function readSmallJSON(response) {
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 256000) { await reader.cancel(); throw Error('接口响应过大（最多256KB）'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(bytes));
}
const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
let data = validate(defaults), mode = '本版资料', warning = '', refreshing = false;
try { const saved = localStorage.getItem(STORAGE_KEY); if (saved) { data = validate(JSON.parse(saved)); mode = '本机草稿'; } }
catch { warning = '本机草稿不可用，已使用本版资料'; }
const card = key => { const f = fields.find(x => x[0] === key); return `<div class="stat"><b data-ops-metric="${key}">${esc(displayValue(data, key))}${data.metrics[key] === null ? '' : ` ${f[2]}`}</b><span>${f[1]}${data.placeholderKeys.includes(key) ? ' · 占位' : ''}</span></div>`; };
const cards = keys => `<div class="mini2">${keys.map(card).join('')}</div>`;
const chips = items => `<div class="ops-chips">${items.map(x => `<span>${esc(x)}</span>`).join('')}</div>`;
const list = (items, className = 'ops-awards') => `<ul class="${className}">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`;
const para = (text, muted = false) => `<p${muted ? ' class="ops-muted"' : ''}>${esc(text)}</p>`;
const companies = () => `<div class="ops-companies">${data.content.companies.map(x => `<div>${esc(x)}</div>`).join('')}</div>`;
const imageFiles = ['warehouse', 'road', 'loading', 'factory'];
const imageLabels = ['产业厂房', '厂区道路', '仓储空间', '生产配套'];
const cameras = large => `<div class="${large ? 'ops-video-wall' : 'cameras'}">${imageFiles.map((name, i) => `<div class="ops-camera"><img src="./ops-images/${name}.jpg" alt="${imageLabels[i]}素材示意，非本园区实拍" loading="lazy" decoding="async"><span class="ops-image-badge">图片示意 · 非实时</span><span class="ops-image-label">${imageLabels[i]}</span></div>`).join('')}</div>`;
const rows = keys => `<div class="ops-data-rows">${keys.map(key => { const f = fields.find(x => x[0] === key); return `<div><span>${f[1]}${data.placeholderKeys.includes(key) ? ' · 占位' : ''}</span><b data-ops-metric="${key}">${displayValue(data, key)} ${f[2]}</b></div>`; }).join('')}</div>`;
const metric = key => `<b data-ops-metric="${key}">${esc(displayValue(data, key))} ${fields.find(f => f[0] === key)[2]}</b>`;
const compactStats = keys => `<div class="ops-compact-stats">${keys.map(key => `<div>${metric(key)}<span>${fields.find(f => f[0] === key)[1]}${data.placeholderKeys.includes(key) ? ' · 占位' : ''}</span></div>`).join('')}</div>`;
const eventList = (items, limit = items.length) => `<ul class="ops-events">${items.slice(0, limit).map(text => {
  const parts = text.split(' · '), status = parts.length > 1 ? parts.pop() : '记录';
  return `<li><span>${esc(parts.join(' · ') || text)}</span><em class="${/整改|处理/.test(status) && !/已完成/.test(status) ? 'ops-event-warn' : ''}">${esc(status)}</em></li>`;
}).join('')}</ul>`;
function industryChart() {
  const keys = fields.filter(f => f[5] === '产业结构 · 原版占位').map(f => f[0]);
  const colors = ['#63d9ff', '#62e6a8', '#d9b864', '#4ca8ff', '#8b7dff'];
  let start = 0;
  const complete = keys.every(key => data.metrics[key] !== null);
  const stops = keys.map((key, i) => { const end = start + (data.metrics[key] || 0); const stop = `${colors[i]} ${start}% ${end}%`; start = end; return stop; });
  const source = keys.some(key => data.placeholderKeys.includes(key)) ? '占位比例' : '已录入比例';
  return `<div class="ops-industry"><div class="ops-donut" role="img" aria-label="产业结构：${keys.map(key => `${fields.find(f => f[0] === key)[1]} ${displayValue(data, key)}%`).join('，')}" style="background:${complete ? `conic-gradient(${stops.join(',')})` : '#284456'}"><span>产业结构<small>${complete ? source : '比例未完整'}</small></span></div><div class="ops-legend">${keys.map((key, i) => `<div><i style="background:${colors[i]}"></i><span>${fields.find(f => f[0] === key)[1]}</span>${metric(key)}</div>`).join('')}</div></div>`;
}
const progress = keys => `<div class="ops-progress">${keys.map(key => `<div><label>${fields.find(f => f[0] === key)[1]}${data.placeholderKeys.includes(key) ? ' · 占位' : ''}${metric(key)}</label><div><i style="width:${data.metrics[key] ?? 0}%"></i></div></div>`).join('')}</div>`;
function trend(prefix, caption) {
  const keys = [4, 5, 6, 7, 8, 9].map(m => `${prefix}${m}`), max = Math.max(1, ...keys.map(key => data.metrics[key] ?? 0));
  return `<figure class="ops-trend"><figcaption>${esc(caption)}</figcaption><div class="ops-bars">${keys.map((key, i) => `<div><b>${displayValue(data, key)}</b><i style="height:${(data.metrics[key] ?? 0) / max * 150}px"></i><span>${i + 4}月</span></div>`).join('')}</div></figure>`;
}
function panel(node, title, body) { node.classList.add('ops-panel'); node.innerHTML = `<h3>${esc(title)}</h3>${body}`; }
const pageNodes = [...document.querySelectorAll('.page')];
function render() {
  const kpis = document.querySelector('.kpis'); kpis.classList.add('ops-headlines');
  kpis.innerHTML = `<div class="kpi ops-plan"><div class="l">园区总体规划</div>${compactStats(['plannedLand', 'plannedFloor', 'plannedInvestment'])}</div>` + ['signedTenants', 'occupancy', 'annualOutput', 'annualTax', 'people', 'vehicles'].map(key => `<div class="kpi ops-kpi">${metric(key)}<div class="l">${fields.find(f => f[0] === key)[1]}${data.placeholderKeys.includes(key) ? ' · 占位' : ''}</div></div>`).join('');
  const c = data.content, left = pageNodes[1].querySelectorAll('.left > .panel'), right = pageNodes[1].querySelectorAll('.right > .panel');
  panel(left[0], '建设进度 · 重点项目', `<div class="ops-stage">${esc(c.stage)}</div>${compactStats(['builtLand', 'builtFloor', 'builtCountedFloor'])}<div class="ops-honors">${list(c.awards)}</div>`);
  panel(left[1], '产业结构 · 招商画像', industryChart());
  panel(left[2], '服务工单 · 示例占位', compactStats(['workPending', 'workProgress', 'workCompleted']) + eventList(c.workOrderEvents, 3));
  panel(right[0], '运营效率 · 人员通行', compactStats(['visitors', 'vehiclePasses', 'camerasOnline']) + progress(['outputTarget', 'taxTarget', 'activity']));
  // 第一页视频安防面板：接入真实HLS流畅视频流（4路），不再用图片预览占位
  const hlsCamerasSmall = [
    { channel: 'd37', name: '大门', tag: 'CAM-001' },
    { channel: 'd57', name: '通道57', tag: 'CAM-018' },
    { channel: 'd02', name: '通道2', tag: 'CAM-043' },
    { channel: 'p3-d37', name: 'Port3通道37', tag: 'CAM-068' },
  ].map(c => `<div class="cam cam-hls" data-camera="${c.channel}" data-name="${c.name}"><span class="live">● LIVE</span><video class="cam-video" autoplay muted playsinline style="width:100%;height:100%;object-fit:cover;display:none"></video><div class="mock">${c.name} · HLS连接中...</div><span class="tag">${c.tag} · ${c.name}</span></div>`).join('');
  panel(right[1], '视频安防 · 实时监控', `<div class="cameras">${hlsCamerasSmall}</div>` + para('已接入4路HLS流畅视频流，通过FFmpeg实时转码，延迟约3-5秒。', true));
  // 动态生成的HLS视频元素需要手动初始化（ops-content重新渲染后新元素不会被页面加载时的initAllCams覆盖）
  // 延迟到下一个事件循环，确保DOM已更新；通过document选择器查询，避免闭包变量失效
  // 优化：同时预启动视频监控页的2路额外通道（p3-d45、p3-d50）转码，切到视频页时6路都已就绪
  const initSmallCams = () => {
    console.log('[OpsContent] initSmallCams 执行');
    try {
      // 不依赖.page.active，直接查找所有页面中的视频元素
      const smallCams = document.querySelectorAll('.page .right .cam-hls');
      console.log(`[OpsContent] 找到 ${smallCams.length} 个视频元素`);
      if (smallCams.length === 0) {
        // 重试机制：DOM可能还没更新，最多重试5次
        let retryCount = 0;
        const retry = setInterval(() => {
          retryCount++;
          const cams = document.querySelectorAll('.page .right .cam-hls');
          if (cams.length > 0 || retryCount >= 5) {
            clearInterval(retry);
            if (cams.length > 0) doInitCams(cams);
          }
        }, 500);
        return;
      }
      doInitCams(smallCams);
    } catch (e) {
      console.warn('[OpsContent] HLS初始化失败:', e.message);
    }
  };
  const doInitCams = (smallCams) => {
    console.log(`[OpsContent] 初始化第一页 ${smallCams.length} 路HLS视频 + 预启动2路额外通道`);
    smallCams.forEach((cam, i) => {
      const channel = cam.dataset.camera;
      if (window.startHlsTranscoding) window.startHlsTranscoding(channel);
      if (window.initHlsPlayer) window.initHlsPlayer(cam);
    });
    // 预启动视频监控页的2路额外通道转码（不初始化播放器，只启动转码）
    const extraChannels = ['p3-d45', 'p3-d50'];
    extraChannels.forEach(ch => {
      if (window.startHlsTranscoding) {
        window.startHlsTranscoding(ch).catch(e => console.warn(`[OpsContent] 预启动${ch}转码失败:`, e));
      }
    });
  };
  if (document.readyState === 'complete') {
    setTimeout(initSmallCams, 200);
  } else {
    window.addEventListener('load', () => setTimeout(initSmallCams, 200), { once: true });
  }
  panel(right[2], '消防安全 · 事件占位', compactStats(['fireRate', 'safetyAlerts', 'hazards']) + eventList(c.inspectionEvents, 3));
  let p = pageNodes[2].querySelectorAll('.panel');
  panel(p[0], '部分入驻企业与招商载体', companies() + para(c.focus) + para('以上为部分入驻企业。以下载体数据保持原数字占位，可在运营数据中编辑。', true) + cards(['usedFloor', 'availableFloor']) + rows(['standardRate', 'gardenRate', 'officeRate']));
  panel(p[1], '年度经营与产值趋势', cards(['annualOutput', 'annualTax', 'signedTenants', 'occupancy']) + trend('outputMonth', '月度产值 · 亿元 · 原占位，不参与年度汇总') + progress(['outputTarget', 'taxTarget', 'activity', 'aboveScale', 'highTech']));
  panel(p[2], '厂房与服务配套', chips(c.factoryTypes) + para(c.flexibility) + chips(c.facilities) + para(c.serviceSummary) + '<h3>省市重点 · 项目荣誉</h3>' + list(c.awards));
  p = pageNodes[3].querySelectorAll('.panel');
  panel(p[0], '消防安全总览', cards(['fireRate', 'safetyAlerts', 'inspections', 'hazards']) + para('系统状态沿用演示占位，非现场设备检测结果。', true) + list(c.fireSystems));
  panel(p[1], '隐患闭环 · 事件占位', eventList(c.inspectionEvents) + para('保留原巡检事件占位，文字与数字均可编辑；不代表实际巡检已完成。', true) + '<h3>服务工单 · 示例占位</h3>' + compactStats(['workPending', 'workProgress', 'workCompleted']) + eventList(c.workOrderEvents) + para('工单数字为示例汇总；列表为部分示例，不代表全部工单。', true));
  panel(p[2], '安全趋势 · 数字占位', trend('safetyMonth', '月度安全趋势 · 项 · 原占位') + '<h3>总体规划与建设</h3>' + cards(['plannedLand', 'plannedFloor', 'plannedInvestment', 'builtCountedFloor']) + para(c.construction) + para(c.stage));
  p = pageNodes[4].querySelectorAll('.panel');
  panel(p[0], '人员态势', cards(['people', 'visitors', 'servicePeople', 'peoplePasses']) + para('本版保留原数字占位，可随时修改，后续绑定业务数据。', true));
  panel(p[1], '车辆态势', cards(['vehicles', 'vehiclePasses', 'freightVehicles', 'parkingRate']) + para('当前在场车辆与今日通行次数使用不同统计口径；本版为数字占位。', true));
  panel(p[2], '门岗事件 · 占位', list(c.gateEvents) + para('保留原演示事件，不是实时通行记录，可在运营数据中编辑。', true));
  // 视频监控页面(pageNodes[5])已接入真实HLS流畅视频流，不再用图片预览占位覆盖
  // 仅更新右侧摄像头状态面板的统计数据，左侧视频墙保持HLS实时画面
  // 注意：不要用panel()完全替换整个panel，否则会覆盖掉aiAnalysisPanel（人车AI分析卡片）
  p = pageNodes[5].querySelectorAll('.panel');
  if (p[1]) {
    const cameraPanel = p[1];
    // 只更新统计数据和描述文字，保留aiAnalysisPanel
    const mini2 = cameraPanel.querySelector('.mini2');
    if (mini2) {
      mini2.innerHTML = cards(['camerasOnline', 'camerasOffline', 'cameraRate', 'cameraPoints']);
    }
    // 更新描述文字（在mini2之后、aiAnalysisPanel之前的那个div）
    const descDiv = cameraPanel.querySelector(':scope > div[style*="margin-top:25px"]:not(#aiAnalysisPanel)');
    if (descDiv) {
      descDiv.innerHTML = '已接入6路HLS流畅视频流（Port5录像机5路+Port3录像机1路），通过FFmpeg实时转码，延迟约3-5秒。视频通道及布局可在后台「视频绑定」页面可视化配置，无需改代码。';
    }
  }
  const footer = document.querySelector('.footerline');
  footer.removeAttribute('data-park-text-key');
  footer.textContent = `${mode} · ${data.source} · ${new Date(data.updatedAt).toLocaleDateString('zh-CN')} · 标注“占位”的数据暂未绑定现场系统 · ${warning || '中间布局沿用既有配置'}`;
  document.documentElement.dataset.opsContentReady = 'true';
}
render();

const button = document.createElement('button'); button.type = 'button'; button.id = 'openOpsData'; button.className = 'ops-open'; button.textContent = '运营数据';
document.getElementById('openCalibration').before(button);
const dialog = document.createElement('dialog'); dialog.className = 'ops-dialog'; dialog.setAttribute('aria-labelledby', 'ops-title');
document.body.append(dialog);
let lastFocus;
function feedback(message, error = false) { const el = dialog.querySelector('.ops-feedback'); el.textContent = message; el.dataset.error = String(error); }
function formDocument() {
  const next = clone(data), form = dialog.querySelector('form');
  next.source = form.elements.namedItem('source').value;
  const date = form.elements.namedItem('updatedAt').value;
  next.updatedAt = date ? `${date}T00:00:00+08:00` : '';
  for (const [key] of fields) { const raw = form.elements.namedItem(key).value.trim(); next.metrics[key] = raw === '' ? null : Number(raw); }
  next.placeholderKeys = fields.filter(([key]) => form.elements.namedItem(`placeholder-${key}`).checked).map(([key]) => key);
  for (const [key, , isList] of copyFields) { const raw = form.elements.namedItem(key).value; next.content[key] = isList ? raw.split('\n').map(x => x.trim()).filter(Boolean) : raw; }
  return validate(next);
}
function fillForm(doc) {
  const form = dialog.querySelector('form');
  form.elements.namedItem('source').value = doc.source;
  form.elements.namedItem('updatedAt').value = new Date(doc.updatedAt).toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
  for (const [key] of fields) form.elements.namedItem(key).value = doc.metrics[key] ?? '';
  for (const [key] of fields) form.elements.namedItem(`placeholder-${key}`).checked = doc.placeholderKeys.includes(key);
  for (const [key, , isList] of copyFields) form.elements.namedItem(key).value = isList ? doc.content[key].join('\n') : doc.content[key];
}
function openEditor() {
  lastFocus = document.activeElement;
  const auto = document.getElementById('auto'); if (auto.classList.contains('on')) auto.click();
  dialog.innerHTML = `<form><header><h2 id="ops-title">运营数据 · 浏览器草稿</h2><button type="button" data-close aria-label="关闭运营数据编辑器">关闭</button></header><main>
    <p>保存只作用于当前浏览器，不修改服务端共享数据或中间区域的分区、楼栋、文字和布局。产值与税收采用本版数字；其他运营指标保留原占位，均可编辑。绑定已核实的数据后，可取消对应的“占位数据”标记。产业结构五项占比合计须为100%；工单数量与部分示例列表分别编辑，首页最多显示3条，完整列表在“安全消防”页。</p>
    <fieldset><legend>来源与日期</legend><div class="ops-form-grid"><label style="grid-column:span 2">数据来源<input name="source" maxlength="200" required></label><label>数据日期<input type="date" name="updatedAt" required></label></div></fieldset>
    ${[...new Set(fields.map(f => f[5]))].map(group => `<fieldset><legend>${group}</legend><div class="ops-form-grid">${fields.filter(f => f[5] === group).map(([key, label, unit]) => `<div><label>${label}（${unit}）<input type="number" name="${key}" min="0" max="${unit === '%' ? 100 : 1e9}" step="any" placeholder="输入数字"></label><label class="ops-checkbox"><input type="checkbox" name="placeholder-${key}">占位数据</label></div>`).join('')}</div></fieldset>`).join('')}
    <fieldset><legend>运营内容</legend><div class="ops-form-grid">${copyFields.map(([key, label]) => `<label>${label}<textarea name="${key}"></textarea></label>`).join('')}</div></fieldset>
    <details><summary>后续数据接口 · 只读手动刷新</summary><p>默认不连接接口。仅允许本站独立业务数据接口，返回完整 version 1 数据文档；失败保留上次有效数据。接入后如需持久保留，请再保存本机草稿。</p><label>接口地址<input name="endpoint" placeholder="/api/park-ops/metrics"></label><button type="button" data-refresh>从接口读取到表单</button></details>
    </main><footer><button type="submit">保存本机草稿</button><button type="button" data-export>导出 JSON</button><label class="ops-import">导入 JSON<input type="file" accept=".json,application/json" data-import></label><button type="button" data-reset>载入本版默认值</button><output class="ops-feedback" role="status">修改后保存即可预览；不会发布。</output></footer></form>`;
  fillForm(data);
  dialog.querySelector('[data-close]').onclick = () => dialog.close();
  dialog.querySelector('form').onsubmit = event => {
    event.preventDefault();
    try {
      const next = formDocument();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      data = next; mode = '本机草稿'; warning = ''; render(); feedback('已保存本机草稿；刷新页面仍保留，服务端共享配置未改变。');
    } catch (error) { feedback(`未保存：${error.message}。可导出 JSON 备份。`, true); }
  };
  dialog.querySelector('[data-export]').onclick = () => {
    try {
      const blob = new Blob([JSON.stringify(formDocument(), null, 2)], { type: 'application/json' }), url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'park-ops-business.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); feedback('已导出表单数据，不包含地图布局。');
    } catch (error) { feedback(error.message, true); }
  };
  dialog.querySelector('[data-import]').onchange = async event => {
    try {
      const file = event.target.files[0]; if (!file) return; if (file.size > 256000) throw Error('文件过大，最多256KB');
      const next = validate(JSON.parse(await file.text()));
      if (!dialog.open) return; fillForm(next); feedback('已导入表单，尚未保存。');
    } catch (error) { feedback(`导入失败：${error.message}`, true); }
    finally { event.target.value = ''; }
  };
  dialog.querySelector('[data-reset]').onclick = () => { if (confirm('将表单恢复为本版资料？尚未保存的表单修改将被替换；不会影响地图配置。')) { fillForm(defaults); feedback('已载入本版资料到表单，尚未保存。'); } };
  dialog.querySelector('[data-refresh]').onclick = async event => {
    if (refreshing) return;
    const refreshButton = event.currentTarget;
    try {
      const url = apiURL(dialog.querySelector('[name=endpoint]').value, location.origin);
      refreshing = true; refreshButton.disabled = true; feedback('正在读取业务数据…');
      const response = await fetch(url, { method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!response.ok) throw Error(`HTTP ${response.status}`);
      const next = validate(await readSmallJSON(response));
      if (!dialog.open || !refreshButton.isConnected) return;
      fillForm(next); feedback('已读取接口数据到表单，确认后保存。');
    } catch (error) { if (refreshButton.isConnected) feedback(`读取失败，保留现有数据：${error.message}`, true); }
    finally { refreshing = false; refreshButton.disabled = false; }
  };
  dialog.showModal();
}
dialog.addEventListener('keydown', event => event.stopPropagation());
dialog.addEventListener('close', () => lastFocus?.focus());
button.onclick = openEditor;
// A failed cross-tab update must not wipe a valid in-memory view.
addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY || dialog.open || !event.newValue) return;
  try { data = validate(JSON.parse(event.newValue)); mode = '本机草稿'; render(); } catch { /* keep last valid document */ }
});
window.PARK_OPS_BUSINESS = Object.freeze({ version: 1, get snapshot() { return clone(data); }, openEditor });
