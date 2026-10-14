// 臻识车牌识别道闸 — 运营大屏「人车管理」真实数据面板
// 独立 ESM：只挂 data-name="人车管理" 页内的 id 钩子，不替换整 panel、不触碰其它页，
// 也不改动 ops-content 渲染。仅在该页处于 active 时轮询，切走即降载（页面降载要求）。
// 远程开闸走 /api/park-ops-control/gate-open（复用大屏接管锁 + 限流 + 后端审计）：
// 现场无人接管时，大屏以固定现场标识登记主控；一旦被远程终端接管，现场开闸按钮禁用。
const LOCAL_OWNER = 'park-ops-screen';
const API = '/api';
const page = document.querySelector('.page[data-name="人车管理"]');

if (page) {
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const pad = (n) => String(n).padStart(2, '0');
  const hm = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };
  const setText = (id, v) => { const el = $(id); if (el) el.textContent = String(v); };

  // 自包含样式（与大屏深色 / 青色基调一致）
  const css = `
  #lprGateControls{flex:1 1 auto;min-height:0;margin:12px 0 4px;display:flex;flex-direction:column;gap:5px;overflow-y:auto;scrollbar-width:none}
  #lprGateControls::-webkit-scrollbar{width:0;height:0;display:none}
  .page[data-name="人车管理"] .panel-body>*:not(#lprGateControls){flex:0 0 auto}
  .lpr-ctrl-row{display:flex;align-items:center;gap:10px;padding:7px 12px;border-radius:9px;
    background:rgba(34,211,238,.06);border:1px solid rgba(34,211,238,.16)}
  .lpr-dot{width:10px;height:10px;border-radius:50%;flex:none}
  .lpr-dot.on{background:#34d399;box-shadow:0 0 0 3px rgba(52,211,153,.18)}
  .lpr-dot.off{background:#717a8a}
  .lpr-ctrl-name{font-size:15px;font-weight:600;color:#e6edf6;flex:1;min-width:0}
  .lpr-ctrl-name em{font-style:normal;color:#8aa0b4;font-weight:400;margin-left:8px;font-size:13px}
  .lpr-gate-state{font-size:13px;padding:2px 9px;border-radius:999px;white-space:nowrap}
  .lpr-gate-state.gs-closed{background:rgba(148,163,184,.15);color:#cbd5e1}
  .lpr-gate-state.gs-open{background:rgba(251,191,36,.18);color:#fbbf24}
  .lpr-gate-state.gs-mid{background:rgba(99,102,241,.2);color:#a5b4fc}
  .lpr-gate-state.gs-offline{background:rgba(113,122,138,.15);color:#8aa0b4}
  .lpr-gate-state.gs-unknown{background:rgba(113,122,138,.12);color:#94a3b8}
  .lpr-open-btn{min-height:34px;padding:0 16px;border:0;border-radius:8px;cursor:pointer;
    background:linear-gradient(135deg,#06b6d4,#22d3ee);color:#04222a;font-weight:700;font-size:14px;white-space:nowrap}
  .lpr-open-btn.confirm{background:linear-gradient(135deg,#ef4444,#f87171);color:#2a0707}
  .lpr-open-btn:disabled{opacity:.55;cursor:not-allowed}
  .lpr-close-btn{min-height:34px;padding:0 14px;border-radius:8px;cursor:pointer;
    background:rgba(148,163,184,.12);color:#cbd5e1;border:1px solid rgba(148,163,184,.35);
    font-weight:700;font-size:14px;white-space:nowrap}
  .lpr-close-btn.confirm{background:linear-gradient(135deg,#ef4444,#f87171);color:#2a0707;border-color:transparent}
  .lpr-close-btn:disabled{opacity:.5;cursor:not-allowed}
  .lpr-ctrl-empty{font-size:15px;color:#8aa0b4;padding:10px 4px}
  .lpr-badge-danger{background:rgba(248,113,113,.18)!important;color:#f87171!important}
  .lpr-rel{color:#8aa0b4;font-weight:400;font-size:.92em}
  .lpr-flash{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);z-index:9999;
    padding:12px 22px;border-radius:10px;font-size:16px;font-weight:600;color:#e6edf6;
    background:rgba(15,20,28,.94);border:1px solid rgba(34,211,238,.3);opacity:0;transition:opacity .2s;pointer-events:none}
  .lpr-flash.show{opacity:1}.lpr-flash.err{border-color:rgba(248,113,113,.5)}`;
  const style = document.createElement('style');
  style.textContent = css;
  document.head.append(style);

  const flashEl = document.createElement('div');
  flashEl.className = 'lpr-flash';
  document.body.append(flashEl);
  let flashTimer = null;
  function flash(msg, err = false) {
    flashEl.textContent = msg;
    flashEl.classList.toggle('err', err);
    flashEl.classList.add('show');
    if (flashTimer) clearTimeout(flashTimer);
    flashTimer = setTimeout(() => flashEl.classList.remove('show'), 2600);
  }

  async function getJSON(path) {
    const r = await fetch(API + path, { headers: { Accept: 'application/json' }, cache: 'no-store', credentials: 'same-origin' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json())?.data;
  }
  async function postJSON(path, body) {
    const r = await fetch(API + path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), credentials: 'same-origin',
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.message || `HTTP ${r.status}`);
    return j?.data;
  }

  let claimedByOther = false;
  let devices = [];

  function gateCls(d) {
    if (!d.online) return 'gs-offline';
    // 展示态统一用后端合成的 gateState（真实上报优先，GPIO 场景走指令态，无信息默认关）
    if (d.gateState === 1) return 'gs-open';
    if (d.gateState === 2) return 'gs-mid';
    return 'gs-closed';
  }

  function renderStats(s) {
    setText('lprOnsite', s.onsite);
    setText('lprTotal', s.totalToday);
    setText('lprStatIn', s.todayIn);
    setText('lprStatOut', s.todayOut);
    setText('lprStatNet', s.onsite);
    setText('lprGateIn', s.todayIn);
    setText('lprGateOut', s.todayOut);
    setText('lprVisitor', s.visitor);
    setText('lprGateAbnormal', s.abnormal);
  }

  function renderEvents(records) {
    const box = $('lprEventList');
    if (!box) return;
    if (!records.length) { box.innerHTML = '<div class="alert"><span class="badge">记录</span><span>今日暂无过车</span><span class="time">--:--</span></div>'; return; }
    box.innerHTML = records.slice(0, 8).map((r) => {
      const dir = r.passDirection === 'in' ? '入园' : r.passDirection === 'out' ? '离园' : '识别';
      const abnormal = r.isFake === 1 || r.isDanger === 1 || r.releaseResult === 'deny';
      const rel = r.releaseResult === 'auto' ? '· 自动放行'
        : r.releaseResult === 'manual' ? '· 手动开闸'
          : r.releaseResult === 'deny' ? '· 拦截' : '';
      const meta = esc([r.plateColorLabel, r.plateTypeLabel].filter(Boolean).join(' '));
      return `<div class="alert"><span class="badge${abnormal ? ' lpr-badge-danger' : ''}">${dir}</span>`
        + `<span>${esc(r.license)} <span class="lpr-rel">${meta} ${rel}</span></span><span class="time">${hm(r.eventTime)}</span></div>`;
    }).join('');
  }

  // 视频墙下方 4 个聚合卡片：道闸状态 / 通行时段 / 异常 / 白名单
  function renderGateCards(s, devs, recent) {
    const sx = s || {};
    // 1) 道闸状态总览（只列车牌道闸，即有 location 的设备；生产恰为 8 台）
    const grid = $('gateStatusGrid');
    if (grid) {
      const gateDevs = devs.filter((d) => d.location);
      grid.innerHTML = gateDevs.map((d) => {
        const cls = !d.online ? 'offline' : d.gateState === 2 ? 'open' : d.gateState === 1 ? 'open' : 'closed';
        const state = !d.online ? '离线' : d.gateState === 1 ? '开' : d.gateState === 2 ? '动' : '关';
        const displayName = d.name || `${d.location}${d.passDirection === 'in' ? '入' : '出'}`;
        return `<div class="gs-item ${cls}"><span class="gs-dot"></span><span class="gs-name">${esc(displayName)}</span><span class="gs-state">${state}</span></div>`;
      }).join('');
    }
    // 2) 今日通行时段（24 小时双柱：入青 / 出橙）
    const hourly = Array.isArray(sx.hourly) ? sx.hourly : [];
    const chart = $('hourlyChart');
    if (chart && hourly.length === 24) {
      const max = Math.max(1, ...hourly.map((h) => h.in + h.out));
      const W = 300; const H = 150; const base = H - 3; const slotW = W / 24;
      let bars = ''; let peakHour = 0; let peakVal = -1;
      hourly.forEach((h, i) => {
        const x = i * slotW;
        const hi = (h.in / max) * (H - 12);
        const ho = (h.out / max) * (H - 12);
        bars += `<rect x="${(x + slotW * 0.14).toFixed(2)}" y="${(base - hi).toFixed(2)}" width="${(slotW * 0.34).toFixed(2)}" height="${hi.toFixed(2)}" fill="#38bdf8"/>`;
        bars += `<rect x="${(x + slotW * 0.54).toFixed(2)}" y="${(base - ho).toFixed(2)}" width="${(slotW * 0.34).toFixed(2)}" height="${ho.toFixed(2)}" fill="#fb923c"/>`;
        if (h.in + h.out > peakVal) { peakVal = h.in + h.out; peakHour = i; }
      });
      chart.innerHTML = bars;
      setText('hourlyPeak', peakVal > 0 ? `高峰 ${pad(peakHour)}:00 · ${peakVal} 辆` : '暂无通行');
    }
    // 3) 异常与拦截
    setText('gateAbnormalNum', sx.abnormal ?? 0);
    const alertList = $('gateAlertList');
    if (alertList) {
      const abn = recent
        .filter((r) => r.isFake === 1 || r.isDanger === 1 || r.releaseResult === 'deny')
        .slice(0, 3);
      alertList.innerHTML = abn.length
        ? abn.map((r) => {
          const tag = r.isDanger === 1 ? '危险' : r.isFake === 1 ? '假牌' : '拦截';
          return `<div class="am-row"><span class="am-tag">${tag}</span><span class="am-plate">${esc(r.license)}</span><span class="am-time">${hm(r.eventTime)}</span></div>`;
        }).join('')
        : '<div class="am-empty">今日无异常</div>';
    }
    // 4) 白名单 / 固定车
    setText('gateWlCount', sx.whitelistCount ?? 0);
    setText('gateWlAuto', sx.autoReleased ?? 0);
    setText('gateWlBlack', sx.blacklistCount ?? 0);
    setText('gateWlExpiring', sx.expiringCount ?? 0);
  }

  // 开闸=抬杆（上箭头），关闸=落杆（下箭头）
  const OPEN_ICON = '<span class="lpr-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></span>';
  const CLOSE_ICON = '<span class="lpr-ico"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12l7 7 7-7"/></svg></span>';

  // 视频墙：每个视频窗一个 toggle 单按钮（当前关→开闸，当前开→关闸）。
  function renderControls() {
    const camEls = document.querySelectorAll('.lpr-cam');
    camEls.forEach((camEl) => {
      const slot = camEl.querySelector('.lpr-cam-btn');
      if (!slot) return;
      // 按“位置 + 方向”匹配设备（生产/本地 LPR id 不同，不能用 id 硬匹配）
      const loc = camEl.dataset.location;
      const dir = camEl.dataset.direction;
      const d = devices.find((x) => x.location === loc && x.passDirection === dir) || null;
      const online = !!(d && d.online);
      const moving = d && d.gateState === 2;
      const isOpen = d && d.gateState === 1;
      let inner;
      if (claimedByOther) {
        inner = '<button disabled>已被远程接管</button>';
      } else if (moving) {
        inner = '<button disabled>道闸动作中…</button>';
      } else if (!d) {
        inner = '<button disabled>设备未登记</button>';
      } else if (!online) {
        inner = '<button disabled>设备离线</button>';
      } else {
        const openIo = Number.isInteger(d.gateIo) ? d.gateIo : 0;
        const closeIo = (d.closeGateIoEffective ?? (Number.isInteger(d.gateIo) ? d.gateIo + 1 : 1));
        const actCls = isOpen ? 'lpr-close-btn' : 'lpr-open-btn';
        const action = isOpen ? 'close' : 'open';
        const label = isOpen ? '关闸' : '开闸';
        const btnTitle = isOpen ? `远程关闸（落杆，继电器 IO${closeIo}）` : `远程开闸（抬杆，继电器 IO${openIo}）`;
        const icon = isOpen ? CLOSE_ICON : OPEN_ICON;
        inner = `<button class="${actCls}" data-id="${d.id}" data-action="${action}" title="${btnTitle}">${icon}${label}</button>`;
      }
      slot.innerHTML = inner;
      const btn = slot.querySelector('button');
      if (btn && !btn.disabled) btn.addEventListener('click', () => askToggle(btn, Number(btn.dataset.id), btn.dataset.action));
    });
  }

  // 单按钮 toggle：当前关→开闸，当前开→关闸；大屏保留两步确认防误触。
  function askToggle(btn, id, action) {
    if (btn.dataset.confirm === '1') { void doToggle(id, action, btn); return; }
    btn.dataset.confirm = '1';
    btn.dataset.original = btn.textContent;
    btn.classList.add('confirm');
    btn.textContent = action === 'close' ? '确认关闸？' : '确认开闸？';
    setTimeout(() => {
      if (btn.dataset.confirm === '1') renderControls();
    }, 3000);
  }
  async function doToggle(id, action, btn) {
    btn.disabled = true;
    btn.textContent = '下发中…';
    const isOpen = action === 'open';
    try {
      const r = await postJSON(isOpen ? '/park-ops-control/gate-open' : '/park-ops-control/gate-close', {
        ownerId: LOCAL_OWNER, ownerName: '现场运营大屏', deviceId: id,
      });
      flash(r?.delivered ? `${isOpen ? '开闸' : '关闸'}指令已下发` : `相机当前未连接，已排队，下次通讯时${isOpen ? '开闸' : '关闸'}`);
      await tick();
    } catch (e) {
      flash(e?.message || (isOpen ? '开闸失败' : '关闸失败'), true);
      renderControls();
    }
  }

  // 接管状态：无人接管时现场登记主控；被他人接管时不抢回，仅禁用现场开闸。
  async function syncClaim() {
    try {
      const st = await getJSON('/park-ops-control/state');
      if (!st.claimed) {
        await postJSON('/park-ops-control/claim', { ownerId: LOCAL_OWNER, ownerName: '现场运营大屏' });
        claimedByOther = false;
      } else {
        claimedByOther = st.claim?.ownerId !== LOCAL_OWNER;
      }
    } catch { claimedByOther = false; }
  }

  let primed = false; // 尚未接入任何相机时保留静态示意，避免上线初期空白
  async function tick() {
    if (!page.classList.contains('active')) return;
    try {
      const [statsRes, devRes, recRes] = await Promise.all([
        getJSON('/lpr/stats'), getJSON('/lpr/devices'), getJSON('/lpr/recent?limit=8'),
      ]);
      devices = Array.isArray(devRes) ? devRes : [];
      const recs = Array.isArray(recRes) ? recRes : [];
      if (devices.length > 0 || primed) {
        primed = true;
        renderStats(statsRes || {});
        renderEvents(recs);
        renderGateCards(statsRes, devices, recs);
      }
      renderControls();
    } catch { /* 后端暂不可用：保留上一帧，不清空 */ }
  }

  let wasActive = false;
  setInterval(() => {
    const active = page.classList.contains('active');
    if (active && !wasActive) { void syncClaim().then(tick); }
    wasActive = active;
    if (active) void tick();
  }, 10_000);
  // 翻到“人车管理”页时由 app.js go() 立即调用，避免等 10s 轮询才渲染开关闸按钮。
  window.LprPanel = { refresh: () => { void syncClaim().then(tick); } };
  void syncClaim().then(tick);
}
