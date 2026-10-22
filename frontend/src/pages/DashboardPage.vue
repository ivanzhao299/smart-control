<script setup lang="ts">
import { computed, ref, onBeforeUnmount, onDeactivated } from 'vue';
import { useActivePolling } from '@/composables/useActivePolling';
import { useToastStore } from '@/stores/toast';
import { useRouter } from 'vue-router';
import {
  CheckCircle2, BarChart3, Clock,
  Sparkles, Calendar, Users, Presentation, Wrench, Moon,
  Lightbulb, MonitorPlay, Speaker, Snowflake, Zap,
} from 'lucide-vue-next';
import { haptics } from '@/services/haptics';
import { powerCircuitsService } from '@/services/power-circuits.service';
import { polling } from '@/services/polling.service';
import { useSceneStore } from '@/stores/scene';
import { useDeviceStore } from '@/stores/device';
import { useSystemStore } from '@/stores/system';
import { usePermissionStore } from '@/stores/permission';

const sceneStore = useSceneStore();
const deviceStore = useDeviceStore();
const sys = useSystemStore();
const router = useRouter();
// 首页场景执行：admin/operator 可操作；本轮只为 operator 提供独立展厅首页。
const perm = usePermissionStore();

type DashboardMode = 'admin' | 'operator';
/**
 * 首页按实际身份收敛，而不是只过滤底部导航：
 * - admin 保留完整运行总览；
 * - operator 进入展厅操作首页；
 * - 其他角色暂不新增专属首页，深链仍保留管理员原有总览，路由守卫继续负责入口权限。
 */
const dashboardMode = computed<DashboardMode>(() => {
  if (perm.isAdmin) return 'admin';
  return perm.role === 'operator' ? 'operator' : 'admin';
});

const roleHomeTitle = computed(() => (dashboardMode.value === 'operator' ? '展厅控制' : '首页'));

const roleShortcuts = computed(() => [
  { name: 'led', label: 'LED 大屏', desc: '播放内容与电源', ico: MonitorPlay, permission: 'led:view' },
  { name: 'projector', label: '投影仪', desc: '投影播放与切源', ico: Presentation, permission: 'projector:view' },
  { name: 'media', label: '媒体库', desc: '选择与管理素材', ico: Calendar, permission: 'media:view' },
].filter((item) => perm.hasPermission(item.permission)));

// ============ KPI ============
const onlineCount = computed(() => deviceStore.onlineCount);
const totalCount = computed(() => deviceStore.totalCount);
const runningCount = computed(() => sceneStore.running.length);
const uptimeHours = computed(() => {
  const s = sys.info?.uptimeSec ?? 0;
  return (s / 3600).toFixed(1);
});

// ============ 全场脉搏: 实时功率 + 迷你曲线 (2026-07-25 体验升级 D3) ============
// 数据全部来自现有 /power-circuits 读数汇总, 不加后端接口; 曲线是本会话内的
// 前端环形缓冲 (最近 40 个采样 ≈ 20 分钟), 中控"活着"的心电图。
// 走统一 polling 调度器 (30s 一采, WS 在线自动降频, 与 C3 收编方向一致)。
const powerNowW = ref<number | null>(null);
const energyTotalKwh = ref<number | null>(null);
const powerHistory = ref<number[]>([]);
async function samplePower(): Promise<void> {
  try {
    const list = await powerCircuitsService.list();
    const w = list.reduce((s, c) => s + (c.reading?.power ?? 0), 0);
    const kwh = list.reduce((s, c) => s + (c.reading?.energy ?? 0), 0);
    powerNowW.value = Math.round(w);
    energyTotalKwh.value = Math.round(kwh * 100) / 100;
    const h = powerHistory.value.slice(-39);
    h.push(w);
    powerHistory.value = h;
  } catch { /* 电源子系统不可达时脉搏卡显示 — , 不打扰首页 */ }
}
/** sparkline: 采样归一化成 100x24 viewBox 的 polyline 坐标串 */
const sparkPoints = computed(() => {
  const h = powerHistory.value;
  if (h.length < 2) return '';
  const max = Math.max(...h, 1);
  const min = Math.min(...h);
  const span = Math.max(max - min, 1);
  return h.map((v, i) => {
    const x = (i / (h.length - 1)) * 100;
    const y = 22 - ((v - min) / span) * 20;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
});
let unsubPower: (() => void) | null = null;
// 2026-07-27 切页卡顿根治: keep-alive 下 onBeforeUnmount 不触发, 首页被缓存后
// 30s 功率采样在别的页面也一直跑。改 useActivePolling — 在首页才采, 切走即退订。
function startPowerSample(): void {
  if (unsubPower) return; // mounted+activated 双触发, 幂等
  void samplePower();
  unsubPower = polling.subscribe('dash:power', 30_000, samplePower);
}
function stopPowerSample(): void {
  if (unsubPower) { unsubPower(); unsubPower = null; }
}
useActivePolling(startPowerSample, stopPowerSample);

// ============ 场景磁贴 ============
type SceneColor = 'opening' | 'reception' | 'meeting' | 'roadshow' | 'cleaning' | 'closing';
const SCENE_META: Record<SceneColor, { ico: unknown }> = {
  opening:   { ico: Sparkles },
  reception: { ico: Calendar },
  meeting:   { ico: Users },
  roadshow:  { ico: Presentation },
  cleaning:  { ico: Wrench },
  closing:   { ico: Moon },
};
const FALLBACK_CYCLE: SceneColor[] = ['opening', 'reception', 'meeting', 'roadshow', 'cleaning', 'closing'];

function colorForScene(code: string, idx: number): SceneColor {
  const lower = code.toLowerCase();
  const match = (Object.keys(SCENE_META) as SceneColor[]).find((k) => lower.includes(k));
  return match ?? FALLBACK_CYCLE[idx % FALLBACK_CYCLE.length];
}

const scenesView = computed(() => {
  return sceneStore.scenes
    .filter((s) => s.enabled)
    .slice(0, 6)
    .map((s, idx) => ({
      ...s,
      color: colorForScene(s.code, idx),
      active: sceneStore.activeSceneCode === s.code,
    }));
});

const toast = useToastStore();

async function fireScene(code: string): Promise<void> {
  haptics.impact(); // A2: 长按走满、场景真的开始执行的那一下
  const name = sceneStore.scenes.find((s) => s.code === code)?.name ?? code;
  toast.info(`场景【${name}】启动中…`); // 即时反馈: 转满瞬间就提示, 不干等多子系统串行下发完
  try {
    await sceneStore.execute(code);
    toast.success(`场景【${name}】已切换，正在执行`);
  } catch (err) {
    toast.error(`场景【${name}】启动失败: ${(err as Error).message}`);
  }
}

// ============ 场景卡「长按激活」防误触 ============
// 触屏一碰就切换风险大 (会误触整场联动). 改成: 轻碰无反应, 按住 ~1.1s 进度环转满
// 才真正执行; 中途松手 / 划走立即取消. 误蹭绝对触发不了, 正常用就是多按住一秒.
const HOLD_MS = 1100;
const RING_C = 2 * Math.PI * 20; // 进度环周长 (r=20)
const holdCode = ref<string | null>(null); // 正在按住的场景 code (同一时刻只一个)
const holdPct = ref(0);                     // 当前进度 0..100
const ringOffset = computed(() => RING_C * (1 - holdPct.value / 100));
let holdRaf = 0;
let holdStartX = 0;
let holdStartY = 0;
let holdFired = false;

function resetHold(): void {
  if (holdRaf) cancelAnimationFrame(holdRaf);
  holdRaf = 0;
  holdCode.value = null;
  holdPct.value = 0;
}

function onHoldStart(code: string, ev: PointerEvent): void {
  if (ev.pointerType === 'mouse' && ev.button !== 0) return; // 只认左键/单指
  if (!perm.canExecute) return; // 只读账户（viewer）不可执行场景
  holdFired = false;
  holdCode.value = code;
  holdPct.value = 0;
  holdStartX = ev.clientX;
  holdStartY = ev.clientY;
  const start = performance.now();
  if (holdRaf) cancelAnimationFrame(holdRaf);
  const loop = (now: number): void => {
    if (holdCode.value !== code) return; // 已被取消
    const p = Math.min(100, ((now - start) / HOLD_MS) * 100);
    holdPct.value = p;
    if (p >= 100) {
      holdFired = true;
      resetHold();
      void fireScene(code);
      return;
    }
    holdRaf = requestAnimationFrame(loop);
  };
  holdRaf = requestAnimationFrame(loop);
}

function onHoldMove(ev: PointerEvent): void {
  if (!holdCode.value) return;
  // 移动超过 12px = 想滚动/划走 → 取消 (松手即取消的另一种形式, 也让纵向滚动可用)
  if (Math.hypot(ev.clientX - holdStartX, ev.clientY - holdStartY) > 12) resetHold();
}

function onHoldEnd(): void {
  if (holdFired) { holdFired = false; return; } // 已执行, 不提示
  const p = holdPct.value;
  resetHold();
  // 按了一下但没转满 (不是纯误蹭) → 教学提示
  if (p >= 10 && p < 100) toast.info('按住直到进度环走满才会执行', 1800);
}

// ============ 子系统状态 ============
const subsystems = computed(() => {
  function summary(category: 'lighting' | 'led' | 'audio' | 'hvac') {
    const list = category === 'lighting' ? deviceStore.lightingDevices
      : category === 'led' ? deviceStore.ledDevices
      : category === 'audio' ? deviceStore.audioDevices
      : deviceStore.hvacDevices;
    const online = list.filter((d) => {
      const s = deviceStore.statusOf(d.name);
      return s === 'online' || s === 'running';
    }).length;
    const total = list.length;
    // 三态, 跟 KPI"设备在线"同逻辑: 全在线=ok(不喊) / 部分掉线=warn(琥珀) / 全掉线=danger(红)
    const status: 'ok' | 'warn' | 'danger' =
      total === 0 ? 'ok' : online === 0 ? 'danger' : online < total ? 'warn' : 'ok';
    return { online, total, hasFault: online < total, status };
  }
  const lighting = summary('lighting');
  const led = summary('led');
  const audio = summary('audio');
  const hvac = summary('hvac');
  const power = { online: 1, total: 1, hasFault: false, status: 'ok' as const }; // 时序器/空开是真设备, 常显首页入口 (审计)
  return [
    { kind: 'light' as const, name: '灯光', ico: Lightbulb, route: 'lighting', ...lighting },
    { kind: 'led' as const, name: 'LED 大屏', ico: MonitorPlay, route: 'led', ...led },
    { kind: 'audio' as const, name: '音响', ico: Speaker, route: 'audio', ...audio },
    { kind: 'hvac' as const, name: '中央空调', ico: Snowflake, route: 'hvac', ...hvac },
    { kind: 'power' as const, name: '电源系统', ico: Zap, route: 'power', ...power }, // 审计: 之前误指 status
  ];
});

const ROLE_SCENE_ORDER = ['opening', 'reception', 'roadshow', 'closing'];
const roleScenesView = computed(() => {
  const order = new Map(ROLE_SCENE_ORDER.map((code, index) => [code, index]));
  return sceneStore.scenes
    .filter((scene) => scene.enabled && order.has(scene.code.toLowerCase()))
    .sort((a, b) => (order.get(a.code.toLowerCase()) ?? 99) - (order.get(b.code.toLowerCase()) ?? 99))
    .map((scene, index) => ({
      ...scene,
      color: colorForScene(scene.code, index),
      active: sceneStore.activeSceneCode === scene.code,
    }));
});

const roleSubsystems = computed(() => subsystems.value.filter((sub) => ['led', 'power'].includes(sub.kind)));

function goTo(name: string): void {
  router.push({ name });
}

// keep-alive 切走(不卸载)或真正卸载时, 取消可能残留的长按进度环 RAF, 避免后台空转
onDeactivated(resetHold);
onBeforeUnmount(resetHold);
</script>

<template>
  <section class="v2-dash" :class="`mode-${dashboardMode}`">
    <template v-if="dashboardMode === 'admin'">
    <!-- KPI 行 -->
    <div class="v2-kpi-row">
      <!-- 设备在线: 颜色跟着实际在线率走, 不写死。
           全在线=中性(正常不需要喊), 有掉线=琥珀, 全掉线=红。
           之前恒定挂 .success, 于是 0/8 全掉线时那个圆圈照样是绿的 —— 颜色在说谎。 -->
      <div class="v2-kpi" :class="{
        amber: totalCount > 0 && onlineCount > 0 && onlineCount < totalCount,
        danger: totalCount > 0 && onlineCount === 0,
      }">
        <div class="v2-kpi-ico"><CheckCircle2 :size="18" :stroke-width="2" /></div>
        <div class="v2-kpi-body">
          <div class="v2-kpi-label">设备在线</div>
          <div class="v2-kpi-value v2-inter">{{ onlineCount }}<span class="unit">/ {{ totalCount }}</span></div>
        </div>
      </div>
      <div class="v2-kpi">
        <div class="v2-kpi-ico"><BarChart3 :size="18" :stroke-width="2" /></div>
        <div class="v2-kpi-body">
          <div class="v2-kpi-label">运行中场景</div>
          <div class="v2-kpi-value v2-inter">{{ runningCount }}<span class="unit">个</span></div>
        </div>
      </div>
      <div class="v2-kpi">
        <div class="v2-kpi-ico"><Clock :size="18" :stroke-width="2" /></div>
        <div class="v2-kpi-body">
          <div class="v2-kpi-label">系统运行</div>
          <div class="v2-kpi-value v2-inter">{{ uptimeHours }}<span class="unit">小时</span></div>
        </div>
      </div>
      <!-- 全场脉搏 (D3): 实时功率大字 + 最近 20 分钟功率心电图。
           曲线是会话内采样, 刷新重新积累 —— 它表达"现在活不活跃", 不是报表 -->
      <div class="v2-kpi pulse" title="全场实时功率 · 曲线为最近约 20 分钟">
        <div class="v2-kpi-ico"><Zap :size="18" :stroke-width="2" /></div>
        <div class="v2-kpi-body">
          <div class="v2-kpi-label">实时功率{{ energyTotalKwh !== null ? ` · 累计 ${energyTotalKwh} kWh` : '' }}</div>
          <div class="v2-kpi-value v2-inter">{{ powerNowW ?? '—' }}<span class="unit">W</span></div>
          <svg v-if="sparkPoints" class="kpi-spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
            <polyline :points="sparkPoints" fill="none" stroke="var(--v2-primary)" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" opacity="0.9" />
          </svg>
        </div>
      </div>
    </div>

    <!-- 场景磁贴 -->
    <section class="v2-scene-block">
      <header class="v2-block-head">
        <h2 class="v2-block-title"><span class="accent">●</span>场景一键切换</h2>
        <div class="v2-block-sub">点击执行联动 · 当前 {{ runningCount }} 个运行中</div>
      </header>
      <div class="v2-scene-grid">
        <!-- 骨架占位 (A1): 场景还没从后端回来时不再是一片空白 — 生产恒有 12 个场景,
             这里只在首帧数据未到的瞬间可见 -->
        <template v-if="scenesView.length === 0">
          <div v-for="i in 6" :key="'sk' + i" class="v2-scene v2-skeleton" style="min-height: 96px"></div>
        </template>
        <button
          v-for="(s) in scenesView"
          :key="s.code"
          class="v2-scene"
          :class="{ active: s.active, holding: holdCode === s.code }"
          :data-color="s.color"
          :disabled="!perm.canExecute"
          @pointerdown="onHoldStart(s.code, $event)"
          @pointermove="onHoldMove($event)"
          @pointerup="onHoldEnd"
          @pointerleave="onHoldEnd"
          @pointercancel="onHoldEnd"
          @contextmenu.prevent
        >
          <div class="v2-scene-top">
            <div class="v2-scene-ico">
              <component :is="SCENE_META[s.color].ico" :size="22" :stroke-width="1.8" />
            </div>
            <div class="v2-scene-meta">
              <div class="v2-scene-code v2-inter">{{ s.code.toUpperCase() }}</div>
            </div>
          </div>
          <div>
            <div class="v2-scene-name">{{ s.name }}</div>
            <div class="v2-scene-desc">{{ s.description || '按住切换' }}</div>
          </div>

          <!-- 长按进度环 overlay (按住该卡时显示) -->
          <div v-show="holdCode === s.code" class="v2-scene-hold" aria-hidden="true">
            <svg class="hold-ring" viewBox="0 0 48 48">
              <circle class="ring-track" cx="24" cy="24" r="20" />
              <circle
                class="ring-fill"
                cx="24" cy="24" r="20"
                :stroke-dasharray="RING_C"
                :stroke-dashoffset="ringOffset"
              />
            </svg>
            <span class="hold-text">按住切换…</span>
          </div>
        </button>
      </div>
    </section>

    <!-- 子系统状态条 -->
    <div class="v2-subsystems">
      <div class="v2-subsystems-label">子系统</div>
      <button
        v-for="sub in subsystems"
        :key="sub.kind"
        class="v2-sub"
        :data-kind="sub.kind"
        :data-status="sub.status"
        @click="goTo(sub.route)"
      >
        <div class="v2-sub-ico"><component :is="sub.ico" :size="16" :stroke-width="2" /></div>
        <div class="v2-sub-body">
          <div class="v2-sub-name">{{ sub.name }}</div>
          <div class="v2-sub-stats v2-inter">
            <span class="online">{{ sub.online }}</span><span class="total"> / {{ sub.total }} 在线</span>
          </div>
        </div>
      </button>
    </div>
    </template>

    <!-- 展厅操作员首页：只保留四个日常场景、播控入口和关键状态。 -->
    <template v-else-if="dashboardMode === 'operator'">
      <div class="role-home role-home-operator">
        <header class="role-home-head">
          <div>
            <div class="role-home-eyebrow">SHOWROOM CONTROL</div>
            <h1>{{ roleHomeTitle }}</h1>
            <p>场景一键切换，屏幕与展厅设备集中操作</p>
          </div>
          <span class="role-home-badge">{{ perm.roleName || '展厅操作员' }}</span>
        </header>

        <section class="role-home-section role-home-scenes">
          <div class="role-home-section-head">
            <h2>一键场景</h2>
            <span>按住卡片直到进度环走满</span>
          </div>
          <div class="role-scene-grid">
            <button
              v-for="s in roleScenesView"
              :key="s.code"
              class="role-scene-card"
              :class="{ active: s.active, holding: holdCode === s.code }"
              :disabled="!perm.canExecute"
              @pointerdown="onHoldStart(s.code, $event)"
              @pointermove="onHoldMove($event)"
              @pointerup="onHoldEnd"
              @pointerleave="onHoldEnd"
              @pointercancel="onHoldEnd"
              @contextmenu.prevent
            >
              <span class="role-scene-icon"><component :is="SCENE_META[s.color].ico" :size="24" :stroke-width="1.8" /></span>
              <span class="role-scene-copy">
                <strong>{{ s.name }}</strong>
                <small>{{ s.description || '按住切换' }}</small>
              </span>
              <span v-show="holdCode === s.code" class="role-scene-hold" aria-hidden="true">
                <svg class="hold-ring" viewBox="0 0 48 48">
                  <circle class="ring-track" cx="24" cy="24" r="20" />
                  <circle class="ring-fill" cx="24" cy="24" r="20" :stroke-dasharray="RING_C" :stroke-dashoffset="ringOffset" />
                </svg>
                <span class="hold-text">按住切换…</span>
              </span>
            </button>
            <div v-if="roleScenesView.length === 0" class="role-home-empty">场景正在加载</div>
          </div>
        </section>

        <section class="role-home-section">
          <div class="role-home-section-head">
            <h2>快捷入口</h2>
            <span>仅显示当前角色可访问的功能</span>
          </div>
          <div class="role-shortcut-grid">
            <button v-for="item in roleShortcuts" :key="item.name" class="role-shortcut" @click="goTo(item.name)">
              <span class="role-shortcut-icon"><component :is="item.ico" :size="22" :stroke-width="1.8" /></span>
              <span><strong>{{ item.label }}</strong><small>{{ item.desc }}</small></span>
            </button>
          </div>
        </section>

        <section class="role-home-status">
          <div class="role-home-status-head"><h2>关键状态</h2><span>当前运行中 {{ runningCount }} 个场景</span></div>
          <div class="role-status-grid">
            <div v-for="sub in roleSubsystems" :key="sub.kind" class="role-status-item" :data-status="sub.status">
              <span class="role-status-dot"></span>
              <span><strong>{{ sub.name }}</strong><small>{{ sub.online }} / {{ sub.total }} 在线</small></span>
            </div>
          </div>
        </section>
      </div>
    </template>

  </section>
</template>

<style scoped>
.v2-dash {
  /* 业主 2026-07-26: 首页元素固定一屏显示, 不得滑动。删掉会议/清洁两个场景后,
     KPI + 4 个场景 + 子系统条正好一屏装下。height:100% + overflow:hidden 钉死,
     中间场景块(1fr)自适应剩余高度。 */
  height: 100%;
  padding: var(--v2-sp-4) var(--v2-sp-5);
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: var(--v2-sp-3);
  overflow: hidden;
}

/* ============ KPI 行 ============ */
.v2-kpi-row {
  display: grid;
  /* D3: 加"全场脉搏"后 5 张卡, auto-fit 各屏自适应换行 */
  grid-template-columns: repeat(auto-fit, minmax(168px, 1fr));
  gap: var(--v2-sp-3);
}
.kpi-spark { width: 100%; height: 22px; margin-top: 4px; display: block; }
.v2-kpi {
  padding: 14px 18px;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  display: flex;
  align-items: center;
  gap: var(--v2-sp-3);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  min-width: 0;
  /* 2026-07-26 业主: 卡片固定高度 —— "实时功率"卡带心电图曲线, 不固定的话它一
     出现就把整行 KPI 卡撑高。固定 92px 预留曲线空间, 有没有曲线高度都一样。 */
  height: 92px;
  box-sizing: border-box;
  overflow: hidden;
  cursor: default;
}
/* KPI 是参考信息, 图标一律中性。
   之前四张卡各配一个彩色圆(绿/蓝/蓝/琥珀)且恒定不变 —— 那是"用颜色装饰"的
   典型: 告警 0 条时那个琥珀圆照样亮着, 等于把警示色用成了图标背景。 */
.v2-kpi-ico {
  width: 40px; height: 40px;
  border-radius: var(--v2-r-md);
  display: grid; place-items: center;
  background: var(--v2-ov-1);
  color: var(--v2-text-2);
  flex-shrink: 0;
  filter: none;
}
/* 只有真的有告警时这张卡才染色 (模板按 alertCount 动态挂 .amber) */
.v2-kpi.amber .v2-kpi-ico {
  background: var(--v2-amber-soft);
  color: var(--v2-amber);
  filter: none;
}
.v2-kpi.amber .v2-kpi-value { color: var(--v2-amber); }
.v2-kpi.success .v2-kpi-ico {
  background: var(--v2-success-soft);
  color: var(--v2-success);
  filter: none;
}
.v2-kpi.danger .v2-kpi-ico {
  background: var(--v2-danger-soft);
  color: var(--v2-danger);
  filter: none;
}
.v2-kpi.danger .v2-kpi-value { color: var(--v2-danger); }
.v2-kpi-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.v2-kpi-label {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-2);
  letter-spacing: 1.2px;
  font-weight: 500;
  text-transform: uppercase;
}
.v2-kpi-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--v2-text-1);
  text-shadow: var(--v2-text-glow-primary);
  letter-spacing: 0.5px;
}
.v2-kpi.amber .v2-kpi-value { text-shadow: var(--v2-text-glow-amber); }
.v2-kpi.success .v2-kpi-value { text-shadow: var(--v2-text-glow-success); }
.v2-kpi.info .v2-kpi-value { color: var(--v2-text-1); text-shadow: none; }
.v2-kpi-value .unit {
  font-size: 12px;
  color: var(--v2-text-3);
  margin-left: 5px;
  font-weight: 500;
  text-shadow: none;
}

/* ============ 场景区 ============ */
.v2-scene-block {
  display: flex;
  flex-direction: column;
  gap: var(--v2-sp-3);
  min-height: 0;
}
.v2-block-head {
  display: flex; align-items: center; justify-content: space-between;
}
.v2-block-title {
  font-size: var(--v2-fs-md);
  font-weight: 600;
  letter-spacing: 0.5px;
  margin: 0;
}
.v2-block-title .accent {
  color: var(--v2-primary);
  margin-right: var(--v2-sp-2);
}
.v2-block-sub {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-3);
}

.v2-scene-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(2, 1fr);
  gap: var(--v2-sp-3);
  min-height: 0;
}

.v2-scene {
  position: relative;
  padding: var(--v2-sp-4) var(--v2-sp-4);
  /* v3: 默认就是该场景的色温渐变, 不再等 active. 业主从灰扑扑变彩色卡墙. */
  background: linear-gradient(135deg, var(--scene-bg-1-dim), var(--scene-bg-2-dim));
  border: 1px solid var(--scene-border-dim);
  border-radius: var(--v2-r-lg);
  cursor: pointer;
  overflow: hidden;
  transition: all 0.32s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
  text-align: left;
  color: var(--v2-text-1);
  min-height: 120px;
  /* 长按防误触: 禁文字选中/长按菜单; pan-y 让纵向滚动仍可用, 静止按住才触发 */
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  touch-action: pan-y;
}
/* 按住中: 轻微下压反馈 */
.v2-scene.holding {
  transform: scale(0.975);
  border-color: var(--scene-border);
}
/* 长按进度环 overlay */
.v2-scene-hold {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(6, 8, 24, 0.5);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.hold-ring {
  width: 46px; height: 46px;
  transform: rotate(-90deg); /* 12 点方向起步 */
}
.hold-ring .ring-track {
  fill: none; stroke: rgba(255, 255, 255, 0.18); stroke-width: 4;
}
.hold-ring .ring-fill {
  fill: none; stroke: var(--v2-primary, #4C9AFF); stroke-width: 4; stroke-linecap: round;
  filter: drop-shadow(0 0 6px var(--v2-primary, #4C9AFF));
}
.hold-text {
  font-size: 12px; font-weight: 600; letter-spacing: 1px;
  color: #fff;
}
/* 卡片右上角光晕 — 各场景自己的色 */
.v2-scene::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 100% 0%, var(--scene-glow), transparent 65%);
  opacity: 0.85;
  transition: opacity 0.28s ease;
  pointer-events: none;
}
/* 顶部 1px 场景色发光光带 — v3 标志元素 */
/* v4: 顶部彩色发光光带取消 —— 6 张卡各来一条, 正是"花花绿绿"的主要来源之一 */
.v2-scene::after { display: none; }

/* hover: 只提一档表面 + 描边转亮。现场是触屏为主, hover 本来就用得少,
   不值得为它挂三层辉光 */
.v2-scene:hover {
  transform: none;
  border-color: var(--v2-border-strong);
  background: var(--v2-surf-1-hover);
  box-shadow: none;
}

/* 运行中: 全屏唯一用强调色的场景卡 —— 这才是颜色该花的地方。
   底色/描边/光晕由 design-tokens.css 的全局"活跃/选中"规则统一给(强调色染底 + 实边 + 光晕),
   这里只管本页特有的部分(图标/圆点/描述文字), 别再各写一份背景, 否则全站选中态又不一致。 */
.v2-scene.active .active-dot {
  position: absolute;
  top: var(--v2-sp-3); right: var(--v2-sp-3);
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--v2-primary);
  box-shadow: none;
  animation: none;
}

.v2-scene-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.v2-scene-ico {
  width: 44px; height: 44px;
  border-radius: var(--v2-r-md);
  display: grid; place-items: center;
  background: var(--scene-icon-bg);
  color: var(--v2-text-2);
  filter: none;
  transition: color 0.22s ease, background 0.22s ease;
}
.v2-scene:hover .v2-scene-ico {
  background: var(--v2-ov-2);
  color: var(--v2-text-1);
}
.v2-scene.active .v2-scene-ico {
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
}
.v2-scene-meta { text-align: right; }

/* v4: OPENING / RECEPTION / MEETING 这类英文角标隐藏。
   它不传递任何信息(中文名就在下面), 纯装饰; 而且它上的是场景色, 本身就是
   彩虹感的一部分。想恢复的话删掉这一条即可, 模板没动。 */
.v2-scene-code { display: none; }

.v2-scene-name {
  font-size: 17px;
  font-weight: 600;
  margin-top: var(--v2-sp-3);
  letter-spacing: 0.3px;
  color: var(--v2-text-1);
  /* 阴影去掉: 那是为了让白字压住彩色渐变底才加的, 现在底是纯中性色, 不需要 */
  text-shadow: none;
}
.v2-scene-desc {
  font-size: 12px;
  color: var(--v2-text-3);
  margin-top: 6px;
  letter-spacing: 0.2px;
}
.v2-scene.active .v2-scene-desc { color: var(--v2-text-2); }

/* ============ 场景配色 (v4: 不再按场景分色) ============
 * 过去 6 个场景各占一种霓虹渐变(琥珀/极光紫/电光青/霓虹粉/霓虹绿/深空蓝)。
 * 问题不是"不好看", 是把颜色这个最强的信号花在了"分类"上:
 *   - 6 张卡一起喊 = 没有重点, 眼睛不知道看哪
 *   - 颜色预算用光后, 真正需要颜色的地方(设备掉线)反而没得可用 ——
 *     LED 大屏 0/2 掉线时, 它和正常的灯光/音响长得一样花, 一眼看不出来
 * 现在全部共用中性表面, 只有"运行中"那张用强调色标出。分类交给图标和文字。
 * data-color 属性保留(模板不动), 只是不再产生颜色差异。
 */
.v2-scene[data-color] {
  --scene-fg: var(--v2-text-2);
  --scene-glow: transparent;
  --scene-icon-bg: var(--v2-ov-1);
  --scene-bg-1-dim: var(--v2-surf-1);
  --scene-bg-2-dim: var(--v2-surf-1);
  --scene-bg-1: var(--v2-surf-1-hover);
  --scene-bg-2: var(--v2-surf-1-hover);
  --scene-border: var(--v2-primary);
  --scene-border-dim: var(--v2-border-soft);
}

/* ============ 子系统状态 ============ */
.v2-subsystems {
  display: grid;
  grid-template-columns: auto repeat(6, 1fr);
  gap: var(--v2-sp-3);
  align-items: center;
  padding: var(--v2-sp-3) var(--v2-sp-4);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.v2-subsystems-label {
  font-size: var(--v2-fs-sm);
  color: var(--v2-text-2);
  padding-right: var(--v2-sp-3);
  border-right: 1px solid var(--v2-border-soft);
  font-weight: 500;
  letter-spacing: 1px;
}
.v2-sub {
  display: flex;
  align-items: center;
  gap: var(--v2-sp-3);
  padding: var(--v2-sp-2) var(--v2-sp-3);
  cursor: pointer;
  border-radius: var(--v2-r-sm);
  transition: all 0.22s ease;
  background: transparent;
  border: 1px solid transparent;
  color: inherit;
  text-align: left;
  position: relative;
}
.v2-sub:hover {
  background: var(--v2-ov-1);
  border-color: var(--v2-border-strong);
  box-shadow: none;
}
.v2-sub-ico {
  width: 34px; height: 34px;
  border-radius: var(--v2-r-sm);
  display: grid; place-items: center;
  background: var(--sub-bg);
  color: var(--sub-fg);
  flex-shrink: 0;
  filter: none;
  transition: color 0.22s ease;
}
.v2-sub:hover .v2-sub-ico { color: var(--v2-text-1); }
.v2-sub-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.v2-sub-name {
  font-size: var(--v2-fs-sm);
  font-weight: 600;
  color: var(--v2-text-1);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* 在线状态点。保留语义色(绿=正常/琥珀=异常), 但去掉辉光和呼吸动画 ——
   一屏上五个点同时呼吸发光, 反而让真正异常的那个不显眼 */
.v2-sub-name::before {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--v2-success);
  box-shadow: none;
  animation: none;
}
.v2-sub-stats {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-3);
}
/* 正常时在线数就是普通文字 —— 只有异常才配得上颜色 */
.v2-sub-stats .online {
  color: var(--v2-text-2);
  font-weight: 500;
  text-shadow: none;
  font-variant-numeric: tabular-nums;
}
.v2-sub[data-status="warn"] .v2-sub-name::before { background: var(--v2-warning); }
.v2-sub[data-status="warn"] .v2-sub-stats .online {
  color: var(--v2-warning);
  font-weight: 600;
}
/* 异常那一行整行提亮, 让它在列表里真正跳出来 */
.v2-sub[data-status="warn"] .v2-sub-name { color: var(--v2-text-1); }
.v2-sub[data-status="warn"] .v2-sub-ico { color: var(--v2-warning); }
/* 全掉线 = danger 红, 比"部分掉线"的琥珀更重 —— 一眼看出是整个子系统下线, 不是个别 */
.v2-sub[data-status="danger"] .v2-sub-name::before { background: var(--v2-danger); }
.v2-sub[data-status="danger"] .v2-sub-stats .online { color: var(--v2-danger); font-weight: 600; }
.v2-sub[data-status="danger"] .v2-sub-name { color: var(--v2-text-1); }
.v2-sub[data-status="danger"] .v2-sub-ico { color: var(--v2-danger); }

/* v4: 子系统不再按品类分色(原来灯光黄/LED青/音响绿/空调蓝/电源紫)。
   图标一律中性 —— 这样"LED 大屏 0/2"掉线时, 琥珀色是整屏唯一的一处, 一眼可见。 */
.v2-sub[data-kind] { --sub-fg: var(--v2-text-2); --sub-bg: var(--v2-ov-1); }

/* ============ 展厅操作员首页 ============
 * 场景是轻量灯光组合，切换后立即接管当前执行；首页固定在一个视口内，
 * 避免操作员在现场上下滑动寻找入口。
 */
.v2-dash.mode-operator {
  display: grid;
  grid-template-rows: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  overflow: hidden;
}
.role-home-operator {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto auto;
  gap: clamp(8px, 1.2vh, 14px);
  overflow: hidden;
}
.role-home-operator .role-home-scenes {
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.role-home-operator .role-home-scenes .role-scene-grid {
  flex: 1 1 auto;
  min-height: 0;
  align-content: stretch;
}
.role-home-operator .role-scene-card { min-height: 0; }
.role-home-operator .role-shortcut-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.role-home-operator .role-shortcut {
  min-height: 0;
  padding: 9px 12px;
}
.role-home-operator .role-home-status {
  min-height: 0;
  padding: 8px 12px;
}
.role-home-operator .role-status-item { padding: 4px 0; }
.role-home {
  max-width: 1180px;
  min-width: 0;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: var(--v2-sp-4);
}
.role-home-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--v2-sp-4);
  padding: var(--v2-sp-2) 0;
}
.role-home-eyebrow {
  color: var(--v2-primary);
  font-size: 11px;
  letter-spacing: 2px;
  font-weight: 700;
}
.role-home-head h1 {
  margin: 6px 0 4px;
  color: var(--v2-text-1);
  font-size: clamp(25px, 3vw, 34px);
  letter-spacing: 0.4px;
}
.role-home-head p {
  margin: 0;
  color: var(--v2-text-2);
  font-size: var(--v2-fs-sm);
}
.role-home-badge {
  flex-shrink: 0;
  padding: 8px 12px;
  border: 1px solid var(--v2-border-strong);
  border-radius: 999px;
  color: var(--v2-text-2);
  background: var(--v2-ov-1);
  font-size: var(--v2-fs-xs);
}
.role-home-section,
.role-home-status {
  min-width: 0;
  padding: var(--v2-sp-4);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  background: var(--v2-surf-1);
  backdrop-filter: blur(4px);
  -webkit-backdrop-filter: blur(4px);
}
.role-home-section-head,
.role-home-status-head {
  min-width: 0;
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--v2-sp-3);
  margin-bottom: var(--v2-sp-3);
}
.role-home-section-head h2,
.role-home-status-head h2 {
  margin: 0;
  color: var(--v2-text-1);
  font-size: var(--v2-fs-md);
  font-weight: 650;
}
.role-home-section-head span,
.role-home-status-head span {
  min-width: 0;
  text-align: right;
  color: var(--v2-text-3);
  font-size: var(--v2-fs-xs);
}
.role-scene-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--v2-sp-3);
}
.role-scene-card {
  position: relative;
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 92px;
  padding: 14px;
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: border-color 0.2s ease, background 0.2s ease, transform 0.2s ease;
}
.role-scene-card:hover { border-color: var(--v2-border-strong); }
.role-scene-card.active {
  border-color: var(--v2-primary);
  background: var(--v2-primary-soft);
}
.role-scene-card.holding { transform: scale(0.98); }
.role-scene-card:disabled { cursor: default; opacity: 0.88; }
.role-scene-icon {
  display: grid;
  place-items: center;
  width: 46px;
  height: 46px;
  flex-shrink: 0;
  border-radius: var(--v2-r-md);
  color: var(--v2-primary);
  background: var(--v2-ov-1);
}
.role-scene-copy {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}
.role-scene-copy strong { font-size: 16px; font-weight: 650; }
.role-scene-copy small { color: var(--v2-text-3); font-size: var(--v2-fs-xs); line-height: 1.35; }
.role-scene-hold {
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  background: rgba(6, 8, 24, 0.66);
  backdrop-filter: blur(2px);
  -webkit-backdrop-filter: blur(2px);
}
.role-shortcut-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--v2-sp-3);
}
.role-shortcut {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 68px;
  padding: 12px 14px;
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  background: transparent;
  color: var(--v2-text-1);
  text-align: left;
  cursor: pointer;
}
.role-shortcut:hover { border-color: var(--v2-border-strong); background: var(--v2-ov-1); }
.role-shortcut-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  flex-shrink: 0;
  color: var(--v2-primary);
  border-radius: var(--v2-r-sm);
  background: var(--v2-primary-soft);
}
.role-shortcut > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 3px; }
.role-shortcut strong { font-size: var(--v2-fs-sm); font-weight: 650; }
.role-shortcut small { color: var(--v2-text-3); font-size: var(--v2-fs-xs); }
.role-home-status-head { margin-bottom: var(--v2-sp-2); }
.role-status-grid {
  min-width: 0;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px 20px;
}
.role-status-item {
  display: flex;
  align-items: center;
  gap: 9px;
  min-width: 0;
  padding: 9px 0;
  color: var(--v2-text-2);
}
.role-status-item > span:last-child { display: flex; min-width: 0; flex-direction: column; gap: 2px; }
.role-status-item strong { color: var(--v2-text-1); font-size: var(--v2-fs-sm); font-weight: 600; }
.role-status-item small { color: var(--v2-text-3); font-size: var(--v2-fs-xs); }
.role-status-dot { width: 8px; height: 8px; flex-shrink: 0; border-radius: 50%; background: var(--v2-success); }
.role-status-item[data-status="warn"] .role-status-dot { background: var(--v2-warning); }
.role-status-item[data-status="danger"] .role-status-dot { background: var(--v2-danger); }
.role-home-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 88px;
  color: var(--v2-text-3);
  font-size: var(--v2-fs-sm);
}

@media (max-width: 760px) {
  .role-home-operator { gap: 8px; }
  .role-home-operator .role-home-head { padding: 0; }
  .role-home-operator .role-home-head h1 { font-size: 22px; margin: 2px 0; }
  .role-home-operator .role-home-head p {
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .role-home-operator .role-home-section,
  .role-home-operator .role-home-status { padding: 10px; }
  .role-home-operator .role-scene-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .role-home-operator .role-scene-icon { width: 36px; height: 36px; }
  .role-home-operator .role-scene-copy strong { font-size: var(--v2-fs-sm); }
  .role-home-operator .role-scene-copy small {
    font-size: 10px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .role-home-operator .role-shortcut-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
  }
  .role-home-operator .role-shortcut { padding: 8px; gap: 8px; }
  .role-home-operator .role-shortcut-icon { width: 30px; height: 30px; }
  .role-home-operator .role-shortcut strong {
    font-size: var(--v2-fs-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .role-home-operator .role-shortcut small { display: none; }
  .role-home-operator .role-status-grid { gap: 4px 12px; }
  .role-home-operator .role-status-item { padding: 3px 0; }
}

@media (max-height: 700px) {
  .role-home-operator { gap: 6px; }
  .role-home-operator .role-home-head p,
  .role-home-operator .role-home-section-head span,
  .role-home-operator .role-home-status-head span,
  .role-home-operator .role-scene-copy small { display: none; }
  .role-home-operator .role-home-section,
  .role-home-operator .role-home-status { padding: 8px 10px; }
  .role-home-operator .role-home-section:not(.role-home-scenes) .role-home-section-head,
  .role-home-operator .role-home-status-head { margin-bottom: 4px; }
  .role-home-operator .role-scene-icon { width: 32px; height: 32px; }
  .role-home-operator .role-shortcut-icon { width: 28px; height: 28px; }
}

/* ============ 中宽屏 (≤960): 子系统行能横向滚, 保持单行不换 ============ */
@media (max-width: 960px) {
  .v2-dash { padding: var(--v2-sp-3); }
  .v2-subsystems {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .v2-sub { flex-shrink: 0; min-width: 130px; }
}

/* ============ 窄屏 (≤720, 平板竖屏): KPI 2×2, 场景 2×3 ============ */
@media (max-width: 720px) {
  .v2-kpi-row { grid-template-columns: repeat(2, 1fr); }
  .v2-scene-grid {
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: repeat(3, 1fr);
  }
  .v2-subsystems {
    grid-template-columns: auto repeat(2, 1fr);
    grid-auto-flow: row;
    overflow-x: visible;
  }
  .v2-sub { min-width: 0; }
}

/* ============ 手机 (≤480, iPhone / Android 竖屏): 场景 1 列大磁贴 ============
 * Sprint H 2026-05-31: 手机优化, 业主可能用手机操作.
 */
@media (max-width: 480px) {
  .v2-dash {
    padding: var(--v2-sp-3);
    gap: var(--v2-sp-3);
  }
  /* KPI 紧凑: 2×2 + 字号小 */
  .v2-kpi { padding: 10px 12px; gap: 10px; }
  .v2-kpi-ico { width: 32px; height: 32px; }
  .v2-kpi-value { font-size: 18px; }
  .v2-kpi-label { font-size: 10px; }

  /* 场景磁贴 2 列 (业主反馈: 便于一只手指快速点) */
  .v2-scene-grid {
    grid-template-columns: repeat(2, 1fr);
    grid-template-rows: auto;
    gap: var(--v2-sp-2);
  }
  .v2-scene { min-height: 102px; padding: 12px; gap: 4px; }
  .v2-scene-ico { width: 36px; height: 36px; }
  .v2-scene-name { font-size: 14px; margin-top: 6px; letter-spacing: 0.3px; }
  .v2-scene-desc { font-size: 10px; margin-top: 3px; line-height: 1.3; }
  .v2-scene-code { font-size: 9px; letter-spacing: 1px; }

  /* 子系统状态条变 2 列网格 */
  .v2-subsystems {
    grid-template-columns: 1fr 1fr;
    grid-auto-flow: row;
    padding: var(--v2-sp-3);
    gap: var(--v2-sp-2);
  }
  .v2-subsystems-label {
    grid-column: 1 / -1;
    border-right: none;
    border-bottom: 1px solid var(--v2-border-soft);
    padding: 0 0 8px;
  }
  .v2-sub { padding: 8px 10px; }
  .v2-sub-ico { width: 30px; height: 30px; }
  .v2-sub-name { font-size: 12px; }
}
</style>
