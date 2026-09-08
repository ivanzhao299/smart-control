(() => {
  'use strict';

  const runtime = window.PARK_RUNTIME;
  const params = new URLSearchParams(location.search);
  const editing = params.get('edit') === '1';
  const svg = document.querySelector('.map-svg');
  const map = document.getElementById('parkMap');
  const phasePolygons = [...document.querySelectorAll('.phase')];
  const phaseFlags = [...document.querySelectorAll('.phase-flag')];
  const phaseButtons = [...document.querySelectorAll('#phaseFilters [data-phase]')].filter(button => button.dataset.phase !== 'all');

  const clone = value => JSON.parse(JSON.stringify(value));
  const defaultPhases = [
    { id: '1', name: '一期', zoneName: '智造区', color: '#63d9ff', fontSize: 15, points: [{ x: 55, y: 175 }, { x: 390, y: 65 }, { x: 522, y: 295 }, { x: 330, y: 435 }, { x: 82, y: 375 }] },
    { id: '2', name: '二期', zoneName: '研发区', color: '#62e6a8', fontSize: 15, points: [{ x: 225, y: 375 }, { x: 530, y: 292 }, { x: 735, y: 520 }, { x: 475, y: 670 }, { x: 195, y: 580 }] },
    { id: 'future', name: '远期', zoneName: '科创区', color: '#ffd36e', fontSize: 15, points: [{ x: 505, y: 125 }, { x: 930, y: 224 }, { x: 936, y: 520 }, { x: 715, y: 570 }, { x: 515, y: 340 }] },
  ];

  const textBaseline = new Map();
  const textSelector = [
    '.brand', '.brand small', '.title h1', '.title .sub',
    '.kpi .n', '.kpi .u', '.kpi .l', '.panel h3', '.panel h3 small',
    '.stat b', '.stat span', '.row span', '.row b', '.legend span',
    '.table th', '.table td', '.chart b', '.chart span',
    '.cam .mock', '.cam .tag', '.cam .live', '.alert span',
    '.mapnote', '.footerline', '.bigpanel > div:not([class])',
  ].join(',');

  function prepareEditableText() {
    const seen = new Set();
    [...document.querySelectorAll(textSelector)].forEach((candidate, index) => {
      if (candidate.closest('.building-marker,#buildingDetail,.map-toolbar,.tabs,.park-editor-shell')) return;
      let target = candidate;
      if (candidate.childElementCount) {
        const node = [...candidate.childNodes].find(item => item.nodeType === Node.TEXT_NODE && item.textContent.trim());
        if (!node) return;
        target = document.createElement('span');
        target.className = 'park-text-fragment';
        target.textContent = node.textContent;
        candidate.replaceChild(target, node);
      }
      if (seen.has(target)) return;
      seen.add(target);
      const key = `text-${index}`;
      target.dataset.parkTextKey = key;
      const computed = getComputedStyle(target);
      textBaseline.set(key, {
        text: target.textContent,
        fontSize: Math.max(8, Math.round(Number.parseFloat(computed.fontSize) || 14)),
        color: rgbToHex(computed.color),
      });
    });
  }

  function rgbToHex(input) {
    if (/^#[0-9a-f]{6}$/i.test(input)) return input;
    const values = input.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [255, 255, 255];
    return `#${values.map(value => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`;
  }

  function defaultConfig() {
    return {
      version: 1,
      fitMode: 'stretch',
      phases: clone(defaultPhases),
      buildings: runtime.buildings.map(building => ({
        id: building.id,
        phase: building.phase,
        number: building.number,
        company: building.name,
        x: building.x,
        y: building.y,
        fontSize: building.fontSize,
        color: building.color,
      })),
      textOverrides: {},
    };
  }

  const defaults = defaultConfig();
  let config = clone(defaults);
  let selectedPhaseId = config.phases[0].id;
  let selectedBuildingId = config.buildings[0]?.id || '';
  let selectedText = null;
  let editor = null;
  let statusEl = null;

  function mergeConfig(input) {
    if (!input || input.version !== 1) return clone(defaults);
    const phases = Array.isArray(input.phases) && input.phases.length ? input.phases : defaults.phases;
    const buildings = Array.isArray(input.buildings) ? input.buildings : defaults.buildings;
    return {
      version: 1,
      fitMode: ['stretch', 'cover', 'contain'].includes(input.fitMode) ? input.fitMode : 'stretch',
      phases: clone(phases),
      buildings: clone(buildings),
      textOverrides: input.textOverrides && typeof input.textOverrides === 'object' ? clone(input.textOverrides) : {},
    };
  }

  function apiBase() {
    const explicit = params.get('api');
    if (explicit) return explicit.replace(/\/+$/, '');
    const backendPort = location.port === '5173' || location.port === '4174' ? '3200' : location.port;
    return location.port === '5173' || location.port === '4174'
      ? `${location.protocol}//${location.hostname}:${backendPort}/api`
      : `${location.origin}/api`;
  }

  function pointsText(points) {
    return points.map(point => `${Math.round(point.x * 10) / 10},${Math.round(point.y * 10) / 10}`).join(' ');
  }

  function applyTextOverrides() {
    document.querySelectorAll('[data-park-text-key]').forEach(element => {
      const key = element.dataset.parkTextKey;
      const value = config.textOverrides[key] || textBaseline.get(key);
      if (!value) return;
      element.textContent = value.text;
      element.style.fontSize = `${value.fontSize}px`;
      element.style.color = value.color;
    });
  }

  function applyPhases() {
    config.phases.forEach((phase, index) => {
      const polygon = phasePolygons.find(item => item.dataset.phase === phase.id) || phasePolygons[index];
      const flag = phaseFlags[index];
      const button = phaseButtons.find(item => item.dataset.phase === phase.id) || phaseButtons[index];
      if (polygon) {
        polygon.dataset.phase = phase.id;
        polygon.setAttribute('points', pointsText(phase.points));
        polygon.style.stroke = phase.color;
        polygon.style.fill = `${phase.color}18`;
      }
      if (flag) {
        flag.textContent = `${phase.name} · ${phase.zoneName}`;
        flag.style.color = phase.color;
        flag.style.fontSize = `${phase.fontSize || 15}px`;
      }
      if (button) {
        button.dataset.phase = phase.id;
        button.textContent = phase.name;
      }
    });
  }

  function applyBuildings() {
    const oldById = new Map(runtime.buildings.map(item => [item.id, item]));
    runtime.buildings = config.buildings.map(item => ({
      ...(oldById.get(item.id) || {}),
      id: item.id,
      phase: item.phase,
      number: item.number,
      name: item.company,
      x: item.x,
      y: item.y,
      fontSize: item.fontSize,
      color: item.color,
      people: oldById.get(item.id)?.people ?? 0,
      energy: oldById.get(item.id)?.energy ?? 0,
      status: oldById.get(item.id)?.status ?? '待录入',
    }));
    markSelectedBuilding();
  }

  function applyConfig(next) {
    config = mergeConfig(next);
    runtime.config = config;
    window.PARK_FIT_MODE = config.fitMode;
    runtime.fit();
    applyPhases();
    applyBuildings();
    applyTextOverrides();
    if (!config.phases.some(item => item.id === selectedPhaseId)) selectedPhaseId = config.phases[0].id;
    if (!config.buildings.some(item => item.id === selectedBuildingId)) selectedBuildingId = config.buildings[0]?.id || '';
    if (editing) {
      refreshEditorOptions();
      renderPhaseHandles();
      syncEditorFields();
    }
  }

  async function loadRemoteConfig(quiet = false) {
    try {
      const response = await fetch(`${apiBase()}/system-branding/park-ops`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      applyConfig(payload?.data?.config || defaults);
      if (!quiet) setStatus(payload?.data?.config ? '已加载服务端共享配置' : '尚未保存，当前使用内置初始配置', 'ok');
    } catch (error) {
      applyConfig(config);
      if (!quiet) setStatus(`配置服务暂不可用：${error.message}`, 'error');
    }
  }

  function setStatus(message, type = '') {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `park-editor-status ${type}`;
  }

  function refreshEditorOptions() {
    if (!editor) return;
    const phaseSelect = editor.querySelector('#pe-phase-select');
    const buildingSelect = editor.querySelector('#pe-building-select');
    const buildingPhase = editor.querySelector('#pe-building-phase');
    phaseSelect.innerHTML = config.phases.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)} · ${escapeHtml(item.zoneName)}</option>`).join('');
    buildingPhase.innerHTML = config.phases.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.name)}</option>`).join('');
    buildingSelect.innerHTML = config.buildings.map(item => `<option value="${escapeAttr(item.id)}">${escapeHtml(item.number)} · ${escapeHtml(item.company)}</option>`).join('');
    phaseSelect.value = selectedPhaseId;
    buildingSelect.value = selectedBuildingId;
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  }

  function escapeAttr(value) { return escapeHtml(value); }

  function boundedNumber(value, min, max, fallback) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
  }

  function syncEditorFields() {
    if (!editor) return;
    editor.querySelector('#pe-fit').value = config.fitMode;
    const phase = config.phases.find(item => item.id === selectedPhaseId);
    if (phase) {
      editor.querySelector('#pe-phase-name').value = phase.name;
      editor.querySelector('#pe-phase-zone').value = phase.zoneName;
      editor.querySelector('#pe-phase-color').value = phase.color;
      editor.querySelector('#pe-phase-size').value = phase.fontSize || 15;
      editor.querySelector('#pe-point-count').textContent = `${phase.points.length} 个端点`;
    }
    const building = config.buildings.find(item => item.id === selectedBuildingId);
    if (building) {
      editor.querySelector('#pe-building-number').value = building.number;
      editor.querySelector('#pe-building-company').value = building.company;
      editor.querySelector('#pe-building-phase').value = building.phase;
      editor.querySelector('#pe-building-size').value = building.fontSize;
      editor.querySelector('#pe-building-color').value = building.color;
      editor.querySelector('#pe-building-x').value = Math.round(building.x * 10) / 10;
      editor.querySelector('#pe-building-y').value = Math.round(building.y * 10) / 10;
    }
    syncTextFields();
    markSelectedBuilding();
  }

  function markSelectedBuilding() {
    document.querySelectorAll('.building-marker').forEach(marker => marker.classList.toggle('editor-selected', editing && marker.dataset.id === selectedBuildingId));
  }

  function selectBuildingForEdit(id) {
    selectedBuildingId = id;
    refreshEditorOptions();
    syncEditorFields();
  }

  function updateBuilding(mutator) {
    const building = config.buildings.find(item => item.id === selectedBuildingId);
    if (!building) return;
    mutator(building);
    applyBuildings();
    refreshEditorOptions();
    syncEditorFields();
  }

  function svgPoint(event) {
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const transformed = point.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.max(0, Math.min(1000, transformed.x)), y: Math.max(0, Math.min(690, transformed.y)) };
  }

  function renderPhaseHandles() {
    svg.querySelector('#phaseEditorHandles')?.remove();
    if (!editing) return;
    const phase = config.phases.find(item => item.id === selectedPhaseId);
    if (!phase) return;
    const ns = 'http://www.w3.org/2000/svg';
    const group = document.createElementNS(ns, 'g');
    group.id = 'phaseEditorHandles';
    const outline = document.createElementNS(ns, 'polygon');
    outline.setAttribute('class', 'phase-edit-outline');
    outline.setAttribute('points', pointsText(phase.points));
    outline.setAttribute('stroke', phase.color);
    group.appendChild(outline);
    phase.points.forEach((point, index) => {
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('class', 'phase-handle');
      circle.setAttribute('cx', point.x);
      circle.setAttribute('cy', point.y);
      circle.setAttribute('r', '7');
      circle.setAttribute('fill', phase.color);
      circle.dataset.pointIndex = String(index);
      const label = document.createElementNS(ns, 'text');
      label.setAttribute('class', 'phase-handle-index');
      label.setAttribute('x', point.x);
      label.setAttribute('y', point.y);
      label.textContent = String(index + 1);
      group.append(circle, label);
    });
    svg.appendChild(group);
  }

  function nearestSegment(points, point) {
    let bestIndex = 0;
    let bestDistance = Infinity;
    points.forEach((start, index) => {
      const end = points[(index + 1) % points.length];
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length));
      const px = start.x + t * dx;
      const py = start.y + t * dy;
      const distance = Math.hypot(point.x - px, point.y - py);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }
    });
    return bestIndex;
  }

  function bindMapEditing() {
    let draggingBuilding = null;
    let draggingPoint = null;

    map.addEventListener('pointerdown', event => {
      const marker = event.target.closest('.building-marker');
      if (!editing || !marker) return;
      event.preventDefault();
      draggingBuilding = marker.dataset.id;
      selectBuildingForEdit(draggingBuilding);
    }, true);

    svg.addEventListener('pointerdown', event => {
      const handle = event.target.closest('.phase-handle');
      if (!editing || !handle) return;
      event.preventDefault();
      draggingPoint = Number(handle.dataset.pointIndex);
    });

    document.addEventListener('pointermove', event => {
      if (draggingBuilding) {
        const rect = map.getBoundingClientRect();
        updateBuilding(building => {
          building.x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
          building.y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
        });
      }
      if (draggingPoint !== null) {
        const phase = config.phases.find(item => item.id === selectedPhaseId);
        if (!phase) return;
        phase.points[draggingPoint] = svgPoint(event);
        applyPhases();
        renderPhaseHandles();
        syncEditorFields();
      }
    });

    document.addEventListener('pointerup', () => { draggingBuilding = null; draggingPoint = null; });
    map.addEventListener('click', event => {
      if (!editing) return;
      const marker = event.target.closest('.building-marker');
      if (marker) selectBuildingForEdit(marker.dataset.id);
    }, true);

    svg.addEventListener('click', event => {
      if (!editing) return;
      const polygon = event.target.closest('.phase');
      if (!polygon) return;
      selectedPhaseId = polygon.dataset.phase;
      refreshEditorOptions();
      syncEditorFields();
      renderPhaseHandles();
    });

    svg.addEventListener('dblclick', event => {
      if (!editing || !event.target.closest('.phase')) return;
      event.preventDefault();
      const phase = config.phases.find(item => item.id === selectedPhaseId);
      if (!phase || phase.points.length >= 32) return;
      const point = svgPoint(event);
      phase.points.splice(nearestSegment(phase.points, point) + 1, 0, point);
      applyPhases();
      renderPhaseHandles();
      syncEditorFields();
    });

    svg.addEventListener('contextmenu', event => {
      const handle = event.target.closest('.phase-handle');
      if (!editing || !handle) return;
      event.preventDefault();
      const phase = config.phases.find(item => item.id === selectedPhaseId);
      if (!phase || phase.points.length <= 3) return;
      phase.points.splice(Number(handle.dataset.pointIndex), 1);
      applyPhases();
      renderPhaseHandles();
      syncEditorFields();
    });
  }

  function bindTextEditing() {
    document.addEventListener('click', event => {
      if (!editing || event.target.closest('.park-editor-shell')) return;
      const target = event.target.closest('[data-park-text-key]');
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      selectedText?.classList.remove('park-text-selected');
      selectedText = target;
      selectedText.classList.add('park-text-selected');
      syncTextFields();
    }, true);
  }

  function syncTextFields() {
    if (!editor) return;
    const empty = !selectedText;
    editor.querySelector('#pe-text-empty').hidden = !empty;
    editor.querySelector('#pe-text-fields').hidden = empty;
    if (empty) return;
    const key = selectedText.dataset.parkTextKey;
    const value = config.textOverrides[key] || textBaseline.get(key);
    editor.querySelector('#pe-text-value').value = value.text;
    editor.querySelector('#pe-text-size').value = value.fontSize;
    editor.querySelector('#pe-text-color').value = value.color;
  }

  function updateSelectedText() {
    if (!selectedText) return;
    const key = selectedText.dataset.parkTextKey;
    const current = config.textOverrides[key] || textBaseline.get(key);
    config.textOverrides[key] = {
      text: editor.querySelector('#pe-text-value').value.slice(0, 200),
      fontSize: boundedNumber(editor.querySelector('#pe-text-size').value, 8, 96, current.fontSize),
      color: editor.querySelector('#pe-text-color').value,
    };
    applyTextOverrides();
  }

  function createEditor() {
    document.body.classList.add('park-editing');
    editor = document.createElement('aside');
    editor.className = 'park-editor-shell';
    editor.innerHTML = `
      <div class="park-editor-head"><strong>园区大屏 · 精准校准</strong><button class="park-editor-close" title="退出校准">×</button></div>
      <div class="park-editor-body">
        <section class="park-editor-section">
          <h4>01 · 屏幕适配</h4>
          <div class="park-editor-field"><label>铺屏方式</label><select id="pe-fit"><option value="stretch">铺满（默认，不留边）</option><option value="cover">等比铺满（可能裁边）</option><option value="contain">完整显示（可能留边）</option></select></div>
          <p class="park-editor-help">现场默认“铺满”。如果屏幕比例与 3612×1462 不一致，可改为等比铺满。</p>
        </section>
        <section class="park-editor-section">
          <h4>02 · 分区端点</h4>
          <div class="park-editor-field"><label>当前分区</label><select id="pe-phase-select"></select></div>
          <div class="park-editor-row"><div class="park-editor-field"><label>分期名称</label><input id="pe-phase-name" maxlength="32"></div><div class="park-editor-field"><label>区域名称</label><input id="pe-phase-zone" maxlength="48"></div></div>
          <div class="park-editor-row"><div class="park-editor-field"><label>线条/文字颜色</label><input id="pe-phase-color" type="color"></div><div class="park-editor-field"><label>分区文字字号</label><input id="pe-phase-size" type="number" min="8" max="48"></div></div>
          <div class="park-editor-field"><label>端点数量</label><div id="pe-point-count">—</div></div>
          <p class="park-editor-help">拖动图上的编号圆点即可精准移动端点；双击分区边线增加端点；右键端点删除（至少保留 3 个）。</p>
        </section>
        <section class="park-editor-section">
          <h4>03 · 楼栋和企业标注</h4>
          <div class="park-editor-field"><label>当前楼栋</label><select id="pe-building-select"></select></div>
          <div class="park-editor-row"><div class="park-editor-field"><label>楼栋号</label><input id="pe-building-number" maxlength="24"></div><div class="park-editor-field"><label>所属分区</label><select id="pe-building-phase"></select></div></div>
          <div class="park-editor-field"><label>入驻企业名称</label><input id="pe-building-company" maxlength="80"></div>
          <div class="park-editor-row"><div class="park-editor-field"><label>字号</label><input id="pe-building-size" type="number" min="8" max="48"></div><div class="park-editor-field"><label>文字颜色</label><input id="pe-building-color" type="color"></div></div>
          <div class="park-editor-row"><div class="park-editor-field"><label>X 位置 %</label><input id="pe-building-x" type="number" min="0" max="100" step="0.1"></div><div class="park-editor-field"><label>Y 位置 %</label><input id="pe-building-y" type="number" min="0" max="100" step="0.1"></div></div>
          <div class="park-editor-row"><button class="park-editor-mini" id="pe-building-add">＋ 新增楼栋</button><button class="park-editor-mini danger" id="pe-building-delete">删除当前楼栋</button></div>
          <p class="park-editor-help">也可以直接在鸟瞰图上拖动楼栋标记，X/Y 会同步变化。</p>
        </section>
        <section class="park-editor-section">
          <h4>04 · 其它画面文字</h4>
          <p id="pe-text-empty" class="park-editor-help">在画面上点击任意虚线高亮文字，再修改内容、字号和颜色。</p>
          <div id="pe-text-fields" hidden>
            <div class="park-editor-field"><label>文字内容</label><textarea id="pe-text-value" maxlength="200"></textarea></div>
            <div class="park-editor-row"><div class="park-editor-field"><label>字号</label><input id="pe-text-size" type="number" min="8" max="96"></div><div class="park-editor-field"><label>颜色</label><input id="pe-text-color" type="color"></div></div>
            <button class="park-editor-mini" id="pe-text-reset">还原这条文字</button>
          </div>
        </section>
      </div>
      <div class="park-editor-actions"><button class="primary" id="pe-save">保存到所有大屏</button><button id="pe-reload">重新读取</button><button id="pe-reset">恢复内置初始值</button></div>
      <div class="park-editor-status">正在读取共享配置…</div>`;
    document.body.appendChild(editor);
    statusEl = editor.querySelector('.park-editor-status');

    editor.querySelector('.park-editor-close').onclick = () => { params.delete('edit'); location.href = `${location.pathname}${params.toString() ? `?${params}` : ''}`; };
    editor.querySelector('#pe-fit').onchange = event => { config.fitMode = event.target.value; window.PARK_FIT_MODE = config.fitMode; runtime.fit(); };
    editor.querySelector('#pe-phase-select').onchange = event => { selectedPhaseId = event.target.value; renderPhaseHandles(); syncEditorFields(); };
    const updatePhase = () => {
      const phase = config.phases.find(item => item.id === selectedPhaseId);
      if (!phase) return;
      phase.name = editor.querySelector('#pe-phase-name').value.slice(0, 32);
      phase.zoneName = editor.querySelector('#pe-phase-zone').value.slice(0, 48);
      phase.color = editor.querySelector('#pe-phase-color').value;
      phase.fontSize = boundedNumber(editor.querySelector('#pe-phase-size').value, 8, 48, phase.fontSize || 15);
      applyPhases(); renderPhaseHandles(); refreshEditorOptions();
    };
    ['#pe-phase-name', '#pe-phase-zone', '#pe-phase-color', '#pe-phase-size'].forEach(selector => editor.querySelector(selector).addEventListener('input', updatePhase));
    editor.querySelector('#pe-building-select').onchange = event => selectBuildingForEdit(event.target.value);
    const buildingBindings = {
      '#pe-building-number': ['number', value => value.slice(0, 24)],
      '#pe-building-company': ['company', value => value.slice(0, 80)],
      '#pe-building-phase': ['phase', value => value],
      '#pe-building-size': ['fontSize', (value, current) => boundedNumber(value, 8, 48, current)],
      '#pe-building-color': ['color', value => value],
      '#pe-building-x': ['x', (value, current) => boundedNumber(value, 0, 100, current)],
      '#pe-building-y': ['y', (value, current) => boundedNumber(value, 0, 100, current)],
    };
    Object.entries(buildingBindings).forEach(([selector, [field, parse]]) => {
      editor.querySelector(selector).addEventListener('input', event => updateBuilding(building => { building[field] = parse(event.target.value, building[field]); }));
    });
    editor.querySelector('#pe-building-add').onclick = () => {
      const id = `b${Date.now()}`;
      config.buildings.push({ id, phase: selectedPhaseId, number: '新楼栋', company: '未命名企业', x: 50, y: 50, fontSize: 12, color: '#ffffff' });
      selectedBuildingId = id; applyBuildings(); refreshEditorOptions(); syncEditorFields();
    };
    editor.querySelector('#pe-building-delete').onclick = () => {
      if (!selectedBuildingId || !confirm('确定删除当前楼栋标注？保存前可通过“重新读取”撤销。')) return;
      config.buildings = config.buildings.filter(item => item.id !== selectedBuildingId);
      selectedBuildingId = config.buildings[0]?.id || ''; applyBuildings(); refreshEditorOptions(); syncEditorFields();
    };
    ['#pe-text-value', '#pe-text-size', '#pe-text-color'].forEach(selector => editor.querySelector(selector).addEventListener('input', updateSelectedText));
    editor.querySelector('#pe-text-reset').onclick = () => {
      if (!selectedText) return;
      delete config.textOverrides[selectedText.dataset.parkTextKey];
      applyTextOverrides(); syncTextFields();
    };
    editor.querySelector('#pe-reload').onclick = () => loadRemoteConfig();
    editor.querySelector('#pe-reset').onclick = () => {
      if (!confirm('恢复内置初始布局？点击“保存到所有大屏”后才会覆盖服务端配置。')) return;
      applyConfig(defaults); setStatus('已恢复内置值，尚未保存', 'ok');
    };
    editor.querySelector('#pe-save').onclick = saveConfig;
    refreshEditorOptions(); syncEditorFields(); renderPhaseHandles();
  }

  async function saveConfig() {
    const token = sessionStorage.getItem('sc.adminToken');
    if (!token) { setStatus('没有后台管理员会话，请从“系统设置 → 园区大屏布局”进入校准器', 'error'); return; }
    setStatus('正在保存…');
    try {
      const response = await fetch(`${apiBase()}/system-branding/park-ops`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(config),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `HTTP ${response.status}`);
      applyConfig(payload?.data?.config || config);
      setStatus('保存成功；LED、投影和其它浏览器将在 15 秒内同步', 'ok');
    } catch (error) {
      setStatus(`保存失败：${error.message}`, 'error');
    }
  }

  prepareEditableText();
  bindMapEditing();
  bindTextEditing();
  if (editing) createEditor();
  loadRemoteConfig().finally(() => {
    if (!editing) setInterval(() => loadRemoteConfig(true), 15000);
  });
})();
