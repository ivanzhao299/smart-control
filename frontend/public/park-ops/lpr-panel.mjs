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
  #lprGateControls{margin:12px 0 4px;display:flex;flex-direction:column;gap:8px}
  .lpr-ctrl-row{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:10px;
    background:rgba(34,211,238,.06);border:1px solid rgba(34,211,238,.16)}
  .lpr-dot{width:10px;height:10px;border-radius:50%;flex:none}
  .lpr-dot.on{background:#34d399;box-shadow:0 0 0 3px rgba(52,211,153,.18)}
  .lpr-dot.off{background:#717a8a}
  .lpr-ctrl-name{font-size:16px;font-weight:600;color:#e6edf6;flex:1;min-width:0}
  .lpr-ctrl-name em{font-style:normal;color:#8aa0b4;font-weight:400;margin-left:8px;font-size:14px}
  .lpr-gate-state{font-size:14px;padding:3px 10px;border-radius:999px;white-space:nowrap}
  .lpr-gate-state.gs-closed{background:rgba(148,163,184,.15);color:#cbd5e1}
  .lpr-gate-state.gs-open{background:rgba(251,191,36,.18);color:#fbbf24}
  .lpr-gate-state.gs-mid{background:rgba(99,102,241,.2);color:#a5b4fc}
  .lpr-gate-state.gs-offline{background:rgba(113,122,138,.15);color:#8aa0b4}
  .lpr-open-btn{min-height:40px;padding:0 20px;border:0;border-radius:9px;cursor:pointer;
    background:linear-gradient(135deg,#06b6d4,#22d3ee);color:#04222a;font-weight:700;font-size:15px;white-space:nowrap}
  .lpr-open-btn.confirm{background:linear-gradient(135deg,#ef4444,#f87171);color:#2a0707}
  .lpr-open-btn:disabled{opacity:.55;cursor:not-allowed}
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
    if (d.gateStatus === 1) return 'gs-open';
    if (d.gateStatus === 2) return 'gs-mid';
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

  function renderControls() {
    const box = $('lprGateControls');
    if (!box) return;
    if (!devices.length) {
      box.innerHTML = '<div class="lpr-ctrl-empty">暂无车牌识别相机通道（后台「车牌道闸」配置，相机上报心跳后自动登记）</div>';
      return;
    }
    box.innerHTML = devices.map((d) => `
      <div class="lpr-ctrl-row">
        <span class="lpr-dot ${d.online ? 'on' : 'off'}"></span>
        <span class="lpr-ctrl-name">${esc(d.deviceName)}${d.location ? `<em>${esc(d.location)}</em>` : ''}</span>
        <span class="lpr-gate-state ${gateCls(d)}">${d.online ? esc(d.gateStatusLabel || '状态未知') : '离线'}</span>
        <button class="lpr-open-btn" data-id="${d.id}" ${claimedByOther ? 'disabled' : ''}>${claimedByOther ? '已被远程接管' : '远程开闸'}</button>
      </div>`).join('');
    box.querySelectorAll('.lpr-open-btn').forEach((btn) => {
      btn.addEventListener('click', () => askOpen(btn, Number(btn.dataset.id)));
    });
  }

  function askOpen(btn, id) {
    if (btn.dataset.confirm === '1') { void doOpen(id, btn); return; }
    const original = btn.textContent;
    btn.dataset.confirm = '1';
    btn.classList.add('confirm');
    btn.textContent = '确认开闸？';
    setTimeout(() => {
      if (btn.dataset.confirm === '1') {
        btn.dataset.confirm = '';
        btn.classList.remove('confirm');
        btn.textContent = original;
      }
    }, 3000);
  }
  async function doOpen(id, btn) {
    btn.disabled = true;
    btn.textContent = '下发中…';
    try {
      const r = await postJSON('/park-ops-control/gate-open', {
        ownerId: LOCAL_OWNER, ownerName: '现场运营大屏', deviceId: id,
      });
      flash(r?.delivered ? '开闸指令已下发' : '相机当前未连接，已排队，下次通讯时开闸');
      await tick();
    } catch (e) {
      flash(e?.message || '开闸失败', true);
      btn.disabled = false;
      btn.dataset.confirm = '';
      btn.classList.remove('confirm');
      btn.textContent = '远程开闸';
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
      if (devices.length > 0 || primed) {
        primed = true;
        renderStats(statsRes || {});
        renderEvents(Array.isArray(recRes) ? recRes : []);
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
  void syncClaim().then(tick);
}
