<script setup lang="ts">
import { computed } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { Zap } from 'lucide-vue-next';
import SceneButton from '@/components/SceneButton.vue';
import StatusCard from '@/components/StatusCard.vue';
import { useSceneStore } from '@/stores/scene';
import { useDeviceStore } from '@/stores/device';
import { categoryIconFor } from '@/composables/useIcons';
import type { DeviceStatus } from '@/types/api';

const sceneStore = useSceneStore();
const deviceStore = useDeviceStore();
const router = useRouter();

function deviceList(category: 'lighting' | 'led' | 'audio' | 'hvac') {
  return category === 'lighting' ? deviceStore.lightingDevices
    : category === 'led' ? deviceStore.ledDevices
    : category === 'audio' ? deviceStore.audioDevices
    : deviceStore.hvacDevices;
}

function deriveCategoryStatus(category: 'lighting' | 'led' | 'audio' | 'hvac'): DeviceStatus {
  const list = deviceList(category);
  if (list.length === 0) {
    const gw = deviceStore.gatewayBySource.get(category);
    return (gw?.state as DeviceStatus) ?? 'offline';
  }
  const statuses = list.map((d) => deviceStore.statusOf(d.name));
  if (statuses.some((s) => s === 'error')) return 'error';
  if (statuses.some((s) => s === 'reconnecting')) return 'reconnecting';
  if (statuses.some((s) => s === 'running')) return 'running';
  if (statuses.some((s) => s === 'online')) return 'online';
  return 'offline';
}

function summary(category: 'lighting' | 'led' | 'audio' | 'hvac'): string {
  const list = deviceList(category);
  const online = list.filter((d) => {
    const s = deviceStore.statusOf(d.name);
    return s === 'online' || s === 'running';
  }).length;
  return `${online} / ${list.length} 在线`;
}

const categories = computed(() => [
  { key: 'lighting' as const, title: '灯光系统', icon: categoryIconFor('lighting'), to: '/lighting' },
  { key: 'led' as const, title: 'LED 大屏', icon: categoryIconFor('led'), to: '/led' },
  { key: 'audio' as const, title: '音响系统', icon: categoryIconFor('audio'), to: '/audio' },
  { key: 'hvac' as const, title: '中央空调', icon: categoryIconFor('hvac'), to: '/hvac' },
]);

const powerStatus = computed<DeviceStatus>(() => {
  if (deviceStore.errorDevices.length > 0) return 'error';
  if (deviceStore.offlineDevices.length > 0) return 'reconnecting';
  return 'online';
});

async function runScene(code: string): Promise<void> {
  const scene = sceneStore.scenes.find((s) => s.code === code);
  const name = scene?.name ?? code;
  try {
    const exec = await sceneStore.execute(code);
    ElMessage({
      type: 'success',
      message: `场景【${name}】已启动 (executionId=${exec.executionId.slice(0, 8)})`,
      duration: 2200,
    });
  } catch (err) {
    ElMessage.error(`场景【${name}】启动失败: ${(err as Error).message}`);
  }
}

async function stopScene(code: string): Promise<void> {
  try {
    await sceneStore.stop(code);
    ElMessage.warning(`场景【${code}】已请求停止`);
  } catch (err) {
    ElMessage.error(`停止失败: ${(err as Error).message}`);
  }
}

function goTo(to: string): void {
  router.push(to);
}
</script>

<template>
  <section class="dashboard">
    <!-- 背景装饰: 网格 + 4 角落辉光 -->
    <div class="bg-grid" aria-hidden="true"></div>
    <div class="bg-glow glow-tl" aria-hidden="true"></div>
    <div class="bg-glow glow-br" aria-hidden="true"></div>

    <!-- 场景区 (上半) -->
    <div class="block scene-block">
      <div class="block-head">
        <h2 class="block-title">
          <span class="title-bar"></span>
          场景一键切换
        </h2>
        <div class="block-sub">点击场景按钮执行联动 · 当前 {{ sceneStore.runningByCode.size }} 个运行中</div>
      </div>

      <div class="scene-grid">
        <SceneButton
          v-for="s in sceneStore.orderedScenes"
          :key="s.code"
          :code="s.code"
          :name="s.name"
          :icon="sceneStore.iconFor(s.code)"
          :active="sceneStore.runningByCode.get(s.code) != null"
          :loading="sceneStore.pendingCode === s.code"
          :error="sceneStore.lastExecution?.sceneCode === s.code && sceneStore.lastExecution?.status === 'failed'"
          @click="runScene(s.code)"
        />
      </div>

      <div v-if="sceneStore.runningByCode.size > 0" class="running-row">
        <span class="sc-subtle">运行中:</span>
        <span v-for="r in sceneStore.running" :key="r.executionId" class="run-chip">
          {{ r.sceneName }}
          <button class="stop-btn" @click="stopScene(r.sceneCode)">停止</button>
        </span>
      </div>
    </div>

    <!-- 子系统区 (下半, 紧凑横排 5 卡) -->
    <div class="block subsystem-block">
      <div class="block-head">
        <h2 class="block-title">
          <span class="title-bar"></span>
          子系统状态
        </h2>
        <div class="block-sub">点击卡片进入对应控制页</div>
      </div>

      <div class="cards-grid">
        <StatusCard
          v-for="c in categories"
          :key="c.key"
          :title="c.title"
          :icon="c.icon"
          :status="deriveCategoryStatus(c.key)"
          :subtitle="summary(c.key)"
          :to="c.to"
          @go="goTo"
        />
        <StatusCard
          title="电源/系统"
          :icon="Zap"
          :status="powerStatus"
          :subtitle="`故障 ${deviceStore.errorDevices.length} · 离线 ${deviceStore.offlineDevices.length}`"
          to="/status"
          @go="goTo"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
/* 顶层容器: 撑满 content 区, 按内容自然堆叠 + 自身滚动
   注意: 不用 grid 1fr auto. 之前用过, 在 .block { min-height: 0 } 配合下,
   1fr 轨道允许被压到比 scene-grid 内容更小, 第 3 行场景 (清洁 + 闭馆)
   溢出 scene-block 边界, 被后续 subsystem 卡片背景盖住 — 看上去就是 "卡片交叠". */
.dashboard {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

/* ============ 背景科技感装饰 ============ */
.bg-grid {
  position: absolute;
  inset: -20px;
  background-image:
    linear-gradient(rgba(99, 102, 241, 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(99, 102, 241, 0.05) 1px, transparent 1px);
  background-size: 40px 40px;
  mask-image: radial-gradient(ellipse 80% 70% at 50% 50%, black 50%, transparent 100%);
  -webkit-mask-image: radial-gradient(ellipse 80% 70% at 50% 50%, black 50%, transparent 100%);
  pointer-events: none;
  z-index: 0;
  opacity: 0.5;
}
/* 用纯 radial-gradient 模拟辉光 (省 filter blur 的 GPU 开销) */
.bg-glow {
  position: absolute;
  width: 480px; height: 480px;
  pointer-events: none;
  z-index: 0;
  opacity: 0.32;
}
.glow-tl {
  top: -200px; left: -200px;
  background: radial-gradient(circle at 50% 50%, #06b6d4 0%, transparent 60%);
}
.glow-br {
  bottom: -200px; right: -200px;
  background: radial-gradient(circle at 50% 50%, #a855f7 0%, transparent 60%);
}

/* ============ 区块 ============ */
.block {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  min-width: 0;
}
.block-head {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}
.block-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  letter-spacing: 1px;
}
.title-bar {
  width: 3px;
  height: 14px;
  border-radius: 2px;
  background: linear-gradient(180deg, #06b6d4 0%, #a855f7 100%);
  box-shadow: 0 0 6px rgba(124, 58, 237, 0.6);
}
.block-sub {
  font-size: 11px;
  color: var(--text-secondary);
  letter-spacing: 0.5px;
}

/* ============ 场景网格 (4 列 × 2 行, 7 个场景 占 4+3) ============ */
.scene-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}
/* 中等屏 1200-1400 */
@media (max-width: 1400px) {
  .scene-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
/* 小平板 ≤ 1100 */
@media (max-width: 1100px) {
  .scene-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
}
/* 7-8" 极小屏 */
@media (max-width: 720px) {
  .scene-grid { grid-template-columns: 1fr; }
}

/* ============ 子系统状态卡 (5 卡横排, 紧凑) ============ */
.cards-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 10px;
}
@media (max-width: 1400px) {
  .cards-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
@media (max-width: 1100px) {
  .cards-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
}
@media (max-width: 720px) {
  .cards-grid { grid-template-columns: 1fr; }
}

/* ============ 运行中 chip ============ */
.running-row {
  display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
  padding: 8px 12px;
  background: linear-gradient(90deg, rgba(16, 185, 129, 0.08) 0%, transparent 100%);
  border-radius: 10px;
  border: 1px solid rgba(16, 185, 129, 0.25);
}
.run-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 4px 9px;
  background: rgba(16, 185, 129, 0.18);
  color: var(--text-primary);
  border-radius: 999px;
  font-size: 12px;
  border: 1px solid rgba(16, 185, 129, 0.35);
}
.stop-btn {
  border: none;
  background: var(--color-error);
  color: #fff;
  padding: 2px 8px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 11px;
}
.stop-btn:hover { background: #dc2626; box-shadow: 0 0 8px rgba(239, 68, 68, 0.5); }
</style>
