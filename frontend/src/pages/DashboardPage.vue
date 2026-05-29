<script setup lang="ts">
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
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

async function fireScene(code: string): Promise<void> {
  const name = sceneStore.scenes.find((s) => s.code === code)?.name ?? code;
  try {
    await sceneStore.execute(code);
    ElMessage.success(`场景【${name}】已启动`);
  } catch (err) {
    ElMessage.error(`场景【${name}】启动失败: ${(err as Error).message}`);
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
  height: 100%;
  padding: var(--v2-sp-5);
  display: grid;
  grid-template-rows: auto 1fr auto;
  gap: var(--v2-sp-4);
  min-height: 0;
  overflow: hidden;
}

/* ============ KPI 行 ============ */
.v2-kpi-row {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: var(--v2-sp-3);
}
.v2-kpi {
  padding: var(--v2-sp-3) var(--v2-sp-4);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  display: flex;
  align-items: center;
  gap: var(--v2-sp-3);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.v2-kpi-ico {
  width: 36px; height: 36px;
  border-radius: var(--v2-r-sm);
  display: grid; place-items: center;
  background: var(--v2-primary-soft);
  color: var(--v2-primary);
  flex-shrink: 0;
}
.v2-kpi.amber .v2-kpi-ico { background: var(--v2-amber-soft); color: var(--v2-amber); }
.v2-kpi.success .v2-kpi-ico { background: rgba(16, 185, 129, 0.14); color: var(--v2-success); }
.v2-kpi.info .v2-kpi-ico { background: rgba(59, 130, 246, 0.14); color: var(--v2-info); }
.v2-kpi-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.v2-kpi-label {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-3);
  letter-spacing: 1px;
}
.v2-kpi-value {
  font-size: 18px;
  font-weight: 600;
  color: var(--v2-text-1);
}
.v2-kpi-value .unit {
  font-size: 11px;
  color: var(--v2-text-3);
  margin-left: 4px;
  font-weight: 400;
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
  padding: var(--v2-sp-4);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-lg);
  cursor: pointer;
  overflow: hidden;
  transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  text-align: left;
  color: var(--v2-text-1);
  min-height: 130px;
}
.v2-scene::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(circle at 100% 0%, var(--scene-glow), transparent 70%);
  opacity: 0.5;
  transition: opacity 0.25s ease;
  pointer-events: none;
}
.v2-scene:hover {
  transform: translateY(-2px);
  border-color: var(--v2-border-strong);
  background: var(--v2-surf-1-hover);
}
.v2-scene:hover::before { opacity: 0.8; }

.v2-scene.active {
  background: linear-gradient(135deg, var(--scene-bg-1), var(--scene-bg-2));
  border-color: var(--scene-border);
  box-shadow: 0 8px 32px -10px var(--scene-glow);
}
.v2-scene.active::after {
  content: '';
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
  width: 40px; height: 40px;
  border-radius: var(--v2-r-md);
  display: grid; place-items: center;
  background: var(--scene-icon-bg);
  color: var(--scene-fg);
  transition: all 0.22s ease;
}
.v2-scene.active .v2-scene-ico {
  background: rgba(255, 255, 255, 0.18);
  color: white;
}
.v2-scene-meta { text-align: right; }
.v2-scene-code {
  font-size: 10px;
  color: var(--v2-text-3);
  letter-spacing: 1.5px;
}
.v2-scene.active .v2-scene-code { color: rgba(255, 255, 255, 0.65); }
.v2-scene-name {
  font-size: 18px;
  font-weight: 600;
  margin-top: var(--v2-sp-4);
  letter-spacing: 0.5px;
}
.v2-scene-desc {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-3);
  margin-top: 4px;
  letter-spacing: 0.5px;
}
.v2-scene.active .v2-scene-desc { color: rgba(255, 255, 255, 0.75); }

/* 场景配色 */
.v2-scene[data-color="opening"] {
  --scene-fg: #f59e0b;
  --scene-glow: rgba(245, 158, 11, 0.18);
  --scene-icon-bg: rgba(245, 158, 11, 0.12);
  --scene-bg-1: #f59e0b; --scene-bg-2: #ea580c;
  --scene-border: rgba(245, 158, 11, 0.65);
}
.v2-scene[data-color="reception"] {
  --scene-fg: #818cf8;
  --scene-glow: rgba(129, 140, 248, 0.18);
  --scene-icon-bg: rgba(129, 140, 248, 0.12);
  --scene-bg-1: #6366f1; --scene-bg-2: #8b5cf6;
  --scene-border: rgba(129, 140, 248, 0.65);
}
.v2-scene[data-color="meeting"] {
  --scene-fg: #2dd4bf;
  --scene-glow: rgba(45, 212, 191, 0.18);
  --scene-icon-bg: rgba(45, 212, 191, 0.12);
  --scene-bg-1: #14b8a6; --scene-bg-2: #0891b2;
  --scene-border: rgba(45, 212, 191, 0.65);
}
.v2-scene[data-color="roadshow"] {
  --scene-fg: #f472b6;
  --scene-glow: rgba(244, 114, 182, 0.18);
  --scene-icon-bg: rgba(244, 114, 182, 0.12);
  --scene-bg-1: #ec4899; --scene-bg-2: #f97316;
  --scene-border: rgba(244, 114, 182, 0.65);
}
.v2-scene[data-color="cleaning"] {
  --scene-fg: #38bdf8;
  --scene-glow: rgba(56, 189, 248, 0.18);
  --scene-icon-bg: rgba(56, 189, 248, 0.12);
  --scene-bg-1: #0ea5e9; --scene-bg-2: #06b6d4;
  --scene-border: rgba(56, 189, 248, 0.65);
}
.v2-scene[data-color="closing"] {
  --scene-fg: #a78bfa;
  --scene-glow: rgba(167, 139, 250, 0.18);
  --scene-icon-bg: rgba(167, 139, 250, 0.12);
  --scene-bg-1: #6366f1; --scene-bg-2: #1e293b;
  --scene-border: rgba(167, 139, 250, 0.5);
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
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.v2-subsystems-label {
  font-size: var(--v2-fs-sm);
  color: var(--v2-text-2);
  padding-right: var(--v2-sp-3);
  border-right: 1px solid var(--v2-border-soft);
}
.v2-sub {
  display: flex;
  align-items: center;
  gap: var(--v2-sp-3);
  padding: var(--v2-sp-2) var(--v2-sp-3);
  cursor: pointer;
  border-radius: var(--v2-r-sm);
  transition: background 0.18s ease;
  background: transparent;
  border: none;
  color: inherit;
  text-align: left;
}
.v2-sub:hover { background: var(--v2-surf-1); }
.v2-sub-ico {
  width: 32px; height: 32px;
  border-radius: var(--v2-r-sm);
  display: grid; place-items: center;
  background: var(--sub-bg);
  color: var(--sub-fg);
  flex-shrink: 0;
}
.v2-sub-body { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.v2-sub-name {
  font-size: var(--v2-fs-sm);
  font-weight: 500;
  color: var(--v2-text-1);
}
.v2-sub-stats {
  font-size: var(--v2-fs-xs);
  color: var(--v2-text-3);
}
.v2-sub-stats .online { color: var(--v2-success); font-weight: 500; }
.v2-sub[data-status="warn"] .v2-sub-stats .online { color: var(--v2-warning); }
.v2-sub[data-status="warn"] .v2-sub-name::after {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--v2-warning);
  margin-left: 6px;
  box-shadow: 0 0 6px var(--v2-warning);
}

.v2-sub[data-kind="light"]  { --sub-fg: #fbbf24; --sub-bg: rgba(251, 191, 36, 0.12); }
.v2-sub[data-kind="led"]    { --sub-fg: #38bdf8; --sub-bg: rgba(56, 189, 248, 0.12); }
.v2-sub[data-kind="audio"]  { --sub-fg: #34d399; --sub-bg: rgba(52, 211, 153, 0.12); }
.v2-sub[data-kind="hvac"]   { --sub-fg: #60a5fa; --sub-bg: rgba(96, 165, 250, 0.12); }
.v2-sub[data-kind="power"]  { --sub-fg: #c084fc; --sub-bg: rgba(192, 132, 252, 0.12); }

/* ============ 窄屏 ============ */
@media (max-width: 1024px) {
  .v2-dash { padding: var(--v2-sp-3); }
  .v2-kpi-row { grid-template-columns: repeat(2, 1fr); }
  .v2-scene-grid { grid-template-columns: repeat(2, 1fr); grid-template-rows: repeat(3, 1fr); }
  .v2-subsystems { grid-template-columns: auto repeat(2, 1fr); grid-auto-flow: row; }
}
</style>
