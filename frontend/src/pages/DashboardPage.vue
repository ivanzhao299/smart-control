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
    <div class="section-head">
      <h2 class="sc-title">场景一键切换</h2>
      <div class="sc-subtle">点击下方场景按钮即可执行对应联动</div>
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
      <span
        v-for="r in sceneStore.running"
        :key="r.executionId"
        class="run-chip"
      >
        {{ r.sceneName }}
        <button class="stop-btn" @click="stopScene(r.sceneCode)">停止</button>
      </span>
    </div>

    <div class="section-head" style="margin-top: 24px;">
      <h2 class="sc-title">子系统状态</h2>
      <div class="sc-subtle">点击卡片进入对应控制页</div>
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
  </section>
</template>

<style scoped>
.dashboard { display: flex; flex-direction: column; gap: 12px; }
.section-head { display: flex; align-items: baseline; gap: 14px; }
.scene-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}
/* 1920×1200 Android 平板等大屏: 场景按钮升 4 列, 7 个场景 → 4+3 不空行 */
@media (min-width: 1600px) {
  .scene-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
}
.cards-grid {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 12px;
}
.running-row {
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
  padding: 10px 14px; background: var(--bg-panel); border-radius: var(--radius-md);
  border: 1px solid var(--border-soft);
}
.run-chip {
  display: inline-flex; align-items: center; gap: 8px;
  padding: 6px 10px;
  background: rgba(37, 99, 235, 0.18);
  color: var(--text-primary);
  border-radius: 999px;
  font-size: 14px;
}
.stop-btn {
  border: none; background: var(--color-error); color: #fff;
  padding: 3px 10px; border-radius: 999px; cursor: pointer; font-size: 12px;
}

/* 中尺寸平板 (1280px 主流横屏) */
@media (max-width: 1400px) {
  .cards-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
}
/* 小尺寸平板 (1024-1280) */
@media (max-width: 1100px) {
  .scene-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .cards-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
}
/* 极小屏 (7-8" 平板) */
@media (max-width: 720px) {
  .scene-grid { grid-template-columns: 1fr; }
  .cards-grid { grid-template-columns: 1fr; }
}
</style>
