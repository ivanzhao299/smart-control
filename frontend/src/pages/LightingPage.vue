<script setup lang="ts">
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
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
      <h2 class="sc-title">💡 灯光控制</h2>
      <div class="sc-subtle">DALI 分区控制 · 支持 0-100% 亮度调节</div>
    </header>

    <div class="zones">
      <div v-for="z in zones" :key="z.id" class="zone-card sc-panel" :class="{ 'is-on': z.on, 'is-error': !!z.error }">
        <div class="zone-head">
          <div>
            <div class="zone-name">{{ z.name }}</div>
            <div class="zone-meta">Zone {{ z.id }} · {{ z.floor }}</div>
          </div>
          <span class="sc-pill" :class="z.error ? 'is-error' : z.on ? 'is-success' : 'is-default'">
            {{ z.error ? '故障' : z.on ? '开' : '关' }}
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
          <button class="sc-touch act on" :disabled="z.busy" @click="setOn(z)">开</button>
          <button class="sc-touch act off" :disabled="z.busy" @click="setOff(z)">关</button>
        </div>

        <div v-if="z.error" class="err-msg">{{ z.error }}</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 20px; }
.page-head { display: flex; align-items: baseline; gap: 14px; }
.zones {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}
.zone-card {
  display: flex; flex-direction: column; gap: 14px;
  border-color: var(--border-soft);
  transition: border-color 0.18s ease;
}
.zone-card.is-on { border-color: var(--color-primary); }
.zone-card.is-error { border-color: var(--color-error); }
.zone-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.zone-name { font-size: 20px; font-weight: 600; }
.zone-meta { font-size: 12px; color: var(--text-secondary); margin-top: 4px; letter-spacing: 1px; }

.brightness-display {
  display: flex; flex-direction: column; gap: 10px;
}
.value { font-size: 36px; font-weight: 700; color: var(--color-primary); }
.value span { font-size: 18px; color: var(--text-secondary); margin-left: 4px; }
.bar { height: 8px; background: var(--bg-elevated); border-radius: 4px; overflow: hidden; }
.fill { height: 100%; background: linear-gradient(90deg, #f59e0b 0%, #2563eb 100%); transition: width 0.2s; }

.actions { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.act {
  color: #fff;
  background: var(--bg-elevated);
}
.act.on { background: var(--color-success); }
.act.off { background: var(--color-error); }
.act:disabled { opacity: 0.55; cursor: not-allowed; }

.err-msg {
  font-size: 13px; color: var(--color-error);
  background: rgba(239,68,68,0.08); padding: 6px 10px; border-radius: 8px;
}

@media (max-width: 1100px) {
  .zones { grid-template-columns: 1fr; }
}
</style>
