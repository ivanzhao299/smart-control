<script setup lang="ts">
import { computed } from 'vue';
import { useToastStore } from '@/stores/toast';
import { useRouter } from 'vue-router';
import {
  CheckCircle2, BarChart3, Clock, TriangleAlert,
  Sparkles, Calendar, Users, Presentation, Wrench, Moon,
  Lightbulb, MonitorPlay, Speaker, Snowflake, Zap,
} from 'lucide-vue-next';
import { useSceneStore } from '@/stores/scene';
import { useDeviceStore } from '@/stores/device';
import { useSystemStore } from '@/stores/system';

const sceneStore = useSceneStore();
const deviceStore = useDeviceStore();
const sys = useSystemStore();
const router = useRouter();

// ============ KPI ============
const onlineCount = computed(() => deviceStore.onlineCount);
const totalCount = computed(() => deviceStore.totalCount);
const runningCount = computed(() => sceneStore.running.length);
const uptimeHours = computed(() => {
  const s = sys.info?.uptimeSec ?? 0;
  return (s / 3600).toFixed(1);
});
const alertCount = computed(() => sys.alerts.length);

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
  const name = sceneStore.scenes.find((s) => s.code === code)?.name ?? code;
  try {
    await sceneStore.execute(code);
    toast.success(`场景【${name}】已启动`);
  } catch (err) {
    toast.error(`场景【${name}】启动失败: ${(err as Error).message}`);
  }
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
    return { online, total: list.length, hasFault: online < list.length };
  }
  const lighting = summary('lighting');
  const led = summary('led');
  const audio = summary('audio');
  const hvac = summary('hvac');
  const power = { online: 0, total: 0, hasFault: false };
  return [
    { kind: 'light' as const, name: '灯光', ico: Lightbulb, route: 'lighting', ...lighting },
    { kind: 'led' as const, name: 'LED 大屏', ico: MonitorPlay, route: 'led', ...led },
    { kind: 'audio' as const, name: '音响', ico: Speaker, route: 'audio', ...audio },
    { kind: 'hvac' as const, name: '中央空调', ico: Snowflake, route: 'hvac', ...hvac },
    { kind: 'power' as const, name: '电源系统', ico: Zap, route: 'status', ...power },
  ];
});

function goTo(name: string): void {
  router.push({ name });
}
</script>

<template>
  <section class="v2-dash">
    <!-- KPI 行 -->
    <div class="v2-kpi-row">
      <div class="v2-kpi success">
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
      <div class="v2-kpi info">
        <div class="v2-kpi-ico"><Clock :size="18" :stroke-width="2" /></div>
        <div class="v2-kpi-body">
          <div class="v2-kpi-label">系统运行</div>
          <div class="v2-kpi-value v2-inter">{{ uptimeHours }}<span class="unit">小时</span></div>
        </div>
      </div>
      <div class="v2-kpi amber">
        <div class="v2-kpi-ico"><TriangleAlert :size="18" :stroke-width="2" /></div>
        <div class="v2-kpi-body">
          <div class="v2-kpi-label">告警</div>
          <div class="v2-kpi-value v2-inter">{{ alertCount }}<span class="unit">条</span></div>
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
        <button
          v-for="(s) in scenesView"
          :key="s.code"
          class="v2-scene"
          :class="{ active: s.active }"
          :data-color="s.color"
          @click="fireScene(s.code)"
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
            <div class="v2-scene-desc">{{ s.description || '点击执行' }}</div>
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
        :data-status="sub.hasFault ? 'warn' : 'ok'"
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
  </section>
</template>

<style scoped>
.v2-dash {
  min-height: 100%;
  padding: var(--v2-sp-4) var(--v2-sp-5);
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: var(--v2-sp-3);
  /* 优先按 iPad 1180×820 不滚装下; 窗口过窄/过矮时允许纵向滚, 不再让子系统盖住场景 */
  overflow-y: auto;
}

/* ============ KPI 行 ============ */
.v2-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--v2-sp-3);
}
.v2-kpi {
  padding: 14px 18px;
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  display: flex;
  align-items: center;
  gap: var(--v2-sp-3);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  min-width: 0;
  cursor: default;
}
.v2-kpi-ico {
  width: 40px; height: 40px;
  border-radius: var(--v2-r-md);
  display: grid; place-items: center;
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
  flex-shrink: 0;
  filter: drop-shadow(0 0 8px var(--v2-primary-soft));
}
.v2-kpi.amber .v2-kpi-ico {
  background: var(--v2-amber-soft);
  color: var(--v2-amber);
  filter: drop-shadow(0 0 8px rgba(255, 184, 0, 0.5));
}
.v2-kpi.success .v2-kpi-ico {
  background: var(--v2-success-soft);
  color: var(--v2-success);
  filter: drop-shadow(0 0 8px rgba(0, 231, 138, 0.5));
}
.v2-kpi.info .v2-kpi-ico {
  background: var(--v2-info-soft);
  color: var(--v2-info);
  filter: drop-shadow(0 0 8px rgba(91, 143, 255, 0.5));
}
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
.v2-kpi.info .v2-kpi-value { color: #BFD7FF; text-shadow: 0 0 18px rgba(91, 143, 255, 0.6); }
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
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
  text-align: left;
  color: var(--v2-text-1);
  min-height: 120px;
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
.v2-scene::after {
  content: '';
  position: absolute;
  top: 0; left: 10%; right: 10%;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--scene-fg) 50%, transparent);
  box-shadow: 0 0 8px var(--scene-fg);
  opacity: 0.7;
  pointer-events: none;
}
.v2-scene:hover {
  transform: translateY(-4px);
  border-color: var(--scene-border);
  background: linear-gradient(135deg, var(--scene-bg-1), var(--scene-bg-2));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.4),
    0 12px 40px -8px var(--scene-glow),
    0 0 48px -10px var(--scene-glow) !important;
}
.v2-scene:hover::before { opacity: 1; }
.v2-scene:hover::after { opacity: 1; }

.v2-scene.active {
  background: linear-gradient(135deg, var(--scene-bg-1), var(--scene-bg-2));
  border-color: var(--scene-border);
}
.v2-scene.active .active-dot {
  position: absolute;
  top: var(--v2-sp-3); right: var(--v2-sp-3);
  width: 8px; height: 8px;
  border-radius: 50%;
  background: white;
  box-shadow: 0 0 12px white, 0 0 24px var(--scene-fg);
  animation: v2-pulse 2s ease-out infinite;
}

.v2-scene-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
}
.v2-scene-ico {
  width: 48px; height: 48px;
  border-radius: var(--v2-r-md);
  display: grid; place-items: center;
  background: var(--scene-icon-bg);
  color: var(--scene-fg);
  filter: drop-shadow(0 0 8px var(--scene-glow));
  transition: all 0.22s ease;
}
.v2-scene:hover .v2-scene-ico {
  background: rgba(255, 255, 255, 0.22);
  color: white;
  filter: drop-shadow(0 0 12px var(--scene-fg));
}
.v2-scene.active .v2-scene-ico {
  background: rgba(255, 255, 255, 0.25);
  color: white;
  filter: drop-shadow(0 0 14px white);
}
.v2-scene-meta { text-align: right; }
.v2-scene-code {
  font-size: 11px;
  color: var(--scene-fg);
  letter-spacing: 2px;
  font-weight: 600;
  opacity: 0.7;
}
.v2-scene:hover .v2-scene-code,
.v2-scene.active .v2-scene-code {
  color: rgba(255, 255, 255, 0.9);
  opacity: 1;
}
.v2-scene-name {
  font-size: 18px;
  font-weight: 700;
  margin-top: var(--v2-sp-3);
  letter-spacing: 0.5px;
  color: var(--v2-text-1);
  text-shadow: 0 1px 8px rgba(0, 0, 0, 0.5);
}
.v2-scene-desc {
  font-size: 12px;
  color: rgba(255, 255, 255, 0.78);
  margin-top: 6px;
  letter-spacing: 0.3px;
}
.v2-scene:hover .v2-scene-desc,
.v2-scene.active .v2-scene-desc { color: rgba(255, 255, 255, 0.92); }

/* ============ 场景配色 (v3 蔚来车机风) ============
 * 每个场景三档色:
 *   *-bg-1-dim / *-bg-2-dim : 默认状态卡片底 (28-22% 不饱和, 业主一眼看出"哦这是xx场景")
 *   *-bg-1 / *-bg-2         : hover / active 状态卡片底 (鲜亮饱和)
 *   *-fg / *-glow / *-border / *-border-dim / *-icon-bg : 配套
 */
.v2-scene[data-color="opening"] {
  --scene-fg: #FFB800;              /* 琥珀-亮 */
  --scene-glow: rgba(255, 184, 0, 0.55);
  --scene-icon-bg: rgba(255, 184, 0, 0.20);
  --scene-bg-1-dim: rgba(255, 120, 0, 0.22);
  --scene-bg-2-dim: rgba(255, 80, 0, 0.10);
  --scene-bg-1: #FF8800;
  --scene-bg-2: #E04500;
  --scene-border: rgba(255, 184, 0, 0.7);
  --scene-border-dim: rgba(255, 184, 0, 0.35);
}
.v2-scene[data-color="reception"] {
  --scene-fg: #C084FC;              /* 极光紫-亮 */
  --scene-glow: rgba(168, 85, 247, 0.55);
  --scene-icon-bg: rgba(168, 85, 247, 0.20);
  --scene-bg-1-dim: rgba(168, 85, 247, 0.22);
  --scene-bg-2-dim: rgba(99, 102, 241, 0.10);
  --scene-bg-1: #A855F7;
  --scene-bg-2: #6366F1;
  --scene-border: rgba(192, 132, 252, 0.7);
  --scene-border-dim: rgba(192, 132, 252, 0.35);
}
.v2-scene[data-color="meeting"] {
  --scene-fg: #00E5FF;              /* 电光青 — v3 主色 */
  --scene-glow: rgba(0, 229, 255, 0.55);
  --scene-icon-bg: rgba(0, 229, 255, 0.20);
  --scene-bg-1-dim: rgba(0, 229, 255, 0.22);
  --scene-bg-2-dim: rgba(0, 184, 212, 0.10);
  --scene-bg-1: #00B8D4;
  --scene-bg-2: #006B85;
  --scene-border: rgba(0, 229, 255, 0.7);
  --scene-border-dim: rgba(0, 229, 255, 0.35);
}
.v2-scene[data-color="roadshow"] {
  --scene-fg: #F472B6;              /* 霓虹粉 */
  --scene-glow: rgba(244, 114, 182, 0.55);
  --scene-icon-bg: rgba(244, 114, 182, 0.20);
  --scene-bg-1-dim: rgba(244, 114, 182, 0.22);
  --scene-bg-2-dim: rgba(236, 72, 153, 0.10);
  --scene-bg-1: #EC4899;
  --scene-bg-2: #DB2777;
  --scene-border: rgba(244, 114, 182, 0.7);
  --scene-border-dim: rgba(244, 114, 182, 0.35);
}
.v2-scene[data-color="cleaning"] {
  --scene-fg: #00E78A;              /* 霓虹绿 */
  --scene-glow: rgba(0, 231, 138, 0.55);
  --scene-icon-bg: rgba(0, 231, 138, 0.20);
  --scene-bg-1-dim: rgba(0, 231, 138, 0.22);
  --scene-bg-2-dim: rgba(16, 185, 129, 0.10);
  --scene-bg-1: #10B981;
  --scene-bg-2: #047857;
  --scene-border: rgba(0, 231, 138, 0.7);
  --scene-border-dim: rgba(0, 231, 138, 0.35);
}
.v2-scene[data-color="closing"] {
  --scene-fg: #5B8FFF;              /* 深空蓝-亮 */
  --scene-glow: rgba(91, 143, 255, 0.55);
  --scene-icon-bg: rgba(91, 143, 255, 0.20);
  --scene-bg-1-dim: rgba(91, 143, 255, 0.22);
  --scene-bg-2-dim: rgba(67, 56, 202, 0.10);
  --scene-bg-1: #4F46E5;
  --scene-bg-2: #1E1B4B;
  --scene-border: rgba(91, 143, 255, 0.7);
  --scene-border-dim: rgba(91, 143, 255, 0.35);
}

/* ============ 子系统状态 ============ */
.v2-subsystems {
  display: grid;
  grid-template-columns: auto repeat(5, 1fr);
  gap: var(--v2-sp-3);
  align-items: center;
  padding: var(--v2-sp-3) var(--v2-sp-4);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  backdrop-filter: blur(14px);
  -webkit-backdrop-filter: blur(14px);
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
  background: rgba(255, 255, 255, 0.04);
  border-color: var(--sub-fg);
  box-shadow: 0 0 16px -4px var(--sub-fg);
}
.v2-sub-ico {
  width: 36px; height: 36px;
  border-radius: var(--v2-r-sm);
  display: grid; place-items: center;
  background: var(--sub-bg);
  color: var(--sub-fg);
  flex-shrink: 0;
  filter: drop-shadow(0 0 6px var(--sub-bg));
  transition: filter 0.22s ease;
}
.v2-sub:hover .v2-sub-ico {
  filter: drop-shadow(0 0 10px var(--sub-fg));
}
.v2-sub-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.v2-sub-name {
  font-size: var(--v2-fs-sm);
  font-weight: 600;
  color: var(--v2-text-1);
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
/* 在线心跳点 — 子系统都加, 不只是 warn */
.v2-sub-name::before {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--v2-success);
  box-shadow: 0 0 8px var(--v2-success);
  animation: v2-glow-breathe 2.4s ease-in-out infinite;
}
.v2-sub-stats {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-2);
}
.v2-sub-stats .online {
  color: var(--sub-fg);
  font-weight: 600;
  text-shadow: 0 0 6px var(--sub-bg);
}
.v2-sub[data-status="warn"] .v2-sub-name::before {
  background: var(--v2-warning);
  box-shadow: 0 0 8px var(--v2-warning);
}
.v2-sub[data-status="warn"] .v2-sub-stats .online { color: var(--v2-warning); }

.v2-sub[data-kind="light"]  { --sub-fg: #FFB800; --sub-bg: rgba(255, 184, 0, 0.22); }
.v2-sub[data-kind="led"]    { --sub-fg: #00E5FF; --sub-bg: rgba(0, 229, 255, 0.22); }
.v2-sub[data-kind="audio"]  { --sub-fg: #00E78A; --sub-bg: rgba(0, 231, 138, 0.22); }
.v2-sub[data-kind="hvac"]   { --sub-fg: #5B8FFF; --sub-bg: rgba(91, 143, 255, 0.22); }
.v2-sub[data-kind="power"]  { --sub-fg: #C084FC; --sub-bg: rgba(192, 132, 252, 0.22); }

/* ============ 中宽屏 (≤960): 子系统行能横向滚, 保持单行不换 ============ */
@media (max-width: 960px) {
  .v2-dash { padding: var(--v2-sp-3); }
  .v2-subsystems {
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }
  .v2-sub { flex-shrink: 0; min-width: 130px; }
}

/* ============ 窄屏 (≤720, 手机/小窗): KPI 2×2, 场景 2×3 ============ */
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
</style>
