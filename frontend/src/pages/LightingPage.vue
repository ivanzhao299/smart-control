<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { Lightbulb, Power, PowerOff, AlertCircle } from 'lucide-vue-next';
import { lightingService } from '@/services/lighting.service';

interface ZoneRow {
  id: number;
  name: string;
  floor: string;
  brightness: number;
  on: boolean;
  busy: boolean;
  error: string | null;
}

const zones = ref<ZoneRow[]>([
  { id: 1, name: '一层主灯光', floor: '1F', brightness: 80, on: false, busy: false, error: null },
  { id: 2, name: '二层主灯光', floor: '2F', brightness: 80, on: false, busy: false, error: null },
  { id: 3, name: '会议区灯光', floor: '1F', brightness: 70, on: false, busy: false, error: null },
  { id: 4, name: '路演区灯光', floor: '1F', brightness: 60, on: false, busy: false, error: null },
]);

async function setOn(z: ZoneRow): Promise<void> {
  z.busy = true; z.error = null;
  try {
    const res = await lightingService.zoneOn(z.id);
    if (!res.ok) throw new Error(res.error || '执行失败');
    z.on = true;
    if (z.brightness === 0) z.brightness = 100;
    ElMessage.success(`${z.name} 已开启`);
  } catch (err) {
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 开启失败: ${z.error}`);
  } finally { z.busy = false; }
}

async function setOff(z: ZoneRow): Promise<void> {
  z.busy = true; z.error = null;
  try {
    const res = await lightingService.zoneOff(z.id);
    if (!res.ok) throw new Error(res.error || '执行失败');
    z.on = false;
    ElMessage.warning(`${z.name} 已关闭`);
  } catch (err) {
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 关闭失败: ${z.error}`);
  } finally { z.busy = false; }
}

async function applyBrightness(z: ZoneRow): Promise<void> {
  z.busy = true; z.error = null;
  try {
    const res = await lightingService.setBrightness(z.id, z.brightness);
    if (!res.ok) throw new Error(res.error || '执行失败');
    z.on = z.brightness > 0;
    ElMessage.success(`${z.name} 亮度已设为 ${z.brightness}%`);
  } catch (err) {
    z.error = (err as Error).message;
    ElMessage.error(`${z.name} 亮度调节失败: ${z.error}`);
  } finally { z.busy = false; }
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="sc-head-ico"><Lightbulb :size="22" :stroke-width="1.75" /></div>
      <div>
        <h2 class="sc-title">灯光控制</h2>
        <div class="sc-subtle">DALI 分区控制 · 支持 0-100% 亮度调节</div>
      </div>
    </header>

    <div class="zones">
      <div v-for="z in zones" :key="z.id" class="zone-card sc-panel" :class="{ 'is-on': z.on, 'is-error': !!z.error }">
        <div class="zone-head">
          <div>
            <div class="zone-name">{{ z.name }}</div>
            <div class="zone-meta">Zone {{ z.id }} · {{ z.floor }}</div>
          </div>
          <span class="sc-status" :class="z.error ? 'is-error' : z.on ? 'is-on' : 'is-off'">
            <span class="sc-status-dot" />
            {{ z.error ? '故障' : z.on ? '已开启' : '已关闭' }}
          </span>
        </div>

        <div class="brightness-display">
          <div class="value">{{ z.brightness }}<span>%</span></div>
          <div class="bar"><div class="fill" :style="{ width: z.brightness + '%' }"></div></div>
        </div>

        <el-slider
          v-model="z.brightness"
          :min="0"
          :max="100"
          :step="5"
          :disabled="z.busy"
          @change="applyBrightness(z)"
          show-stops
        />

        <div class="actions">
          <button class="sc-touch sc-act sc-act-success" :disabled="z.busy || z.on" @click="setOn(z)">
            <Power :size="20" :stroke-width="2" /> 开启
          </button>
          <button class="sc-touch sc-act sc-act-danger" :disabled="z.busy || !z.on" @click="setOff(z)">
            <PowerOff :size="20" :stroke-width="2" /> 关闭
          </button>
        </div>

        <div v-if="z.error" class="sc-err">
          <AlertCircle :size="16" :stroke-width="2" /> {{ z.error }}
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 20px; }
.page-head { display: flex; align-items: center; gap: 14px; }
.zones {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.zone-card {
  display: flex; flex-direction: column; gap: 14px;
  transition: border-color 0.18s ease, box-shadow 0.18s ease;
}
.zone-card.is-on {
  border-color: rgba(245, 158, 11, 0.55);
  box-shadow: 0 12px 32px -10px rgba(245, 158, 11, 0.28);
}
.zone-card.is-error { border-color: rgba(239, 68, 68, 0.55); }
.zone-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.zone-name { font-size: 20px; font-weight: 600; }
.zone-meta {
  font-size: 12px; color: var(--text-secondary); margin-top: 4px;
  letter-spacing: 1px; font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.brightness-display {
  display: flex; flex-direction: column; gap: 10px;
}
.value {
  font-size: 40px; font-weight: 700;
  background: linear-gradient(135deg, #fbbf24 0%, #f59e0b 50%, #60a5fa 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  letter-spacing: 1px;
  font-variant-numeric: tabular-nums;
}
.value span { font-size: 18px; color: var(--text-secondary); margin-left: 4px; -webkit-text-fill-color: var(--text-secondary); }
.bar { height: 8px; background: var(--bg-elevated); border-radius: 4px; overflow: hidden; }
.fill {
  height: 100%;
  background: linear-gradient(90deg, #fbbf24 0%, #f59e0b 50%, #60a5fa 100%);
  transition: width 0.25s ease;
  box-shadow: 0 0 12px rgba(251, 191, 36, 0.5);
}

.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }

@media (max-width: 1100px) {
  .zones { grid-template-columns: 1fr; }
}
</style>
