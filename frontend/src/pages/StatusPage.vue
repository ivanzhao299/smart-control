<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useDeviceStore } from '@/stores/device';
import { useSceneStore } from '@/stores/scene';
import { useSystemStore } from '@/stores/system';
import { deviceService } from '@/services/device.service';
import { adminMonitorService } from '@/services/admin.service';
import type { HealthReport, SystemResources } from '@/types/api';

const deviceStore = useDeviceStore();
const sceneStore = useSceneStore();
const sys = useSystemStore();

const health = ref<HealthReport | null>(null);
const res = ref<SystemResources | null>(null);
let pollTimer: number | undefined;

async function refreshResource(): Promise<void> {
  try {
    const [h, r] = await Promise.all([
      adminMonitorService.health(),
      adminMonitorService.status(),
    ]);
    health.value = h;
    res.value = r;
  } catch {
    // 后端未起或权限不足时容错
  }
}

onMounted(() => {
  void refreshResource();
  pollTimer = window.setInterval(refreshResource, 10_000);
});

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer);
});

const deviceOnlineRatio = computed(() => {
  if (!health.value) return 0;
  const total = health.value.deviceOnlineCount + health.value.deviceOfflineCount;
  if (total === 0) return 0;
  return Math.round((health.value.deviceOnlineCount / total) * 100);
});

function gaugeColor(percent: number): string {
  if (percent >= 90) return 'var(--color-error)';
  if (percent >= 70) return 'var(--color-warning)';
  return 'var(--color-success)';
}

const refreshing = ref(false);
async function refresh(): Promise<void> {
  refreshing.value = true;
  try {
    await deviceStore.refreshAll();
    await sceneStore.refreshRunning();
    await refreshResource();
    ElMessage.success('已刷新');
  } catch (err) {
    ElMessage.error(`刷新失败: ${(err as Error).message}`);
  } finally { refreshing.value = false; }
}

const probing = ref(false);
async function probe(): Promise<void> {
  probing.value = true;
  try {
    await deviceService.triggerHealthProbe();
    await deviceStore.fetchGateways();
    ElMessage.success('已触发健康探活');
  } catch (err) {
    ElMessage.error(`探活失败: ${(err as Error).message}`);
  } finally { probing.value = false; }
}

const clearing = ref(false);
async function clearFaults(): Promise<void> {
  clearing.value = true;
  try {
    const res = await deviceService.clearGatewayFaults();
    await deviceStore.fetchGateways();
    ElMessage.success(res?.message ?? '已清空旧告警');
  } catch (err) {
    ElMessage.error(`清空失败: ${(err as Error).message}`);
  } finally { clearing.value = false; }
}

const rows = computed(() =>
  deviceStore.devices.map((d) => ({
    ...d,
    runtimeStatus: deviceStore.statusOf(d.name),
  })),
);

function statusPillClass(s: string): string {
  switch (s) {
    case 'online':
    case 'running': return 'is-success';
    case 'reconnecting': return 'is-warning';
    case 'error': return 'is-error';
    case 'disabled': return 'is-default';
    default: return 'is-error';
  }
}

function gatewayLabel(name: string): string {
  if (name.includes('lighting')) return '灯光网关';
  if (name.includes('led')) return 'LED 播控';
  if (name.includes('audio')) return '音响 DSP';
  if (name.includes('hvac')) return '空调网关';
  return name;
}
</script>

<template>
  <section class="page">
    <header class="page-head">
      <h2 class="sc-title">📡 系统状态</h2>
      <div class="sc-subtle">设备在线列表 · 网关连接状态 · 报警 / 中控信息</div>
      <div class="actions">
        <button class="sc-touch act" :disabled="clearing" @click="clearFaults">{{ clearing ? '清空中…' : '清空旧告警' }}</button>
        <button class="sc-touch act" :disabled="probing" @click="probe">立即探活</button>
        <button class="sc-touch act primary" :disabled="refreshing" @click="refresh">{{ refreshing ? '刷新中…' : '刷新' }}</button>
      </div>
    </header>

    <!-- Sprint-05 spec Task-010: 设备在线率 + CPU + 内存 顶部指标 -->
    <div class="metrics-row">
      <div class="metric-card">
        <div class="metric-label">设备在线率</div>
        <div class="metric-num" :style="{ color: deviceOnlineRatio >= 80 ? 'var(--color-success)' : 'var(--color-warning)' }">
          {{ deviceOnlineRatio }}<span>%</span>
        </div>
        <div class="metric-sub">
          在线 {{ health?.deviceOnlineCount ?? 0 }} / 离线 {{ health?.deviceOfflineCount ?? 0 }}
          <span v-if="(health?.reconnectingCount ?? 0) > 0" class="recon">· 重连 {{ health?.reconnectingCount }}</span>
        </div>
      </div>
      <div class="metric-card">
        <div class="metric-label">CPU</div>
        <div class="metric-num" :style="{ color: gaugeColor(res?.cpu.usagePercent ?? 0) }">
          {{ res?.cpu.usagePercent ?? 0 }}<span>%</span>
        </div>
        <div class="metric-sub">负载 {{ res?.cpu.loadAvg1m ?? '—' }} · {{ res?.cpu.cores ?? '—' }} 核</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">内存</div>
        <div class="metric-num" :style="{ color: gaugeColor(res?.memory.usagePercent ?? 0) }">
          {{ res?.memory.usagePercent ?? 0 }}<span>%</span>
        </div>
        <div class="metric-sub">{{ res?.memory.usedMb ?? '—' }} / {{ res?.memory.totalMb ?? '—' }} MB</div>
      </div>
      <div class="metric-card">
        <div class="metric-label">当前报警</div>
        <div class="metric-num" :style="{ color: sys.alerts.length > 0 ? 'var(--color-error)' : 'var(--color-success)' }">
          {{ sys.alerts.length }}
        </div>
        <div class="metric-sub">WS {{ sys.wsState }}</div>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="sc-panel">
        <div class="panel-head">
          <span>中控主机</span>
        </div>
        <div class="kv">
          <div><span>应用</span><strong>{{ sys.info?.app ?? '—' }}</strong></div>
          <div><span>环境</span><strong>{{ sys.info?.env ?? '—' }}</strong></div>
          <div><span>版本</span><strong>{{ sys.info?.version ?? '—' }}</strong></div>
          <div><span>Sprint</span><strong>{{ sys.info?.sprint ?? '—' }}</strong></div>
          <div><span>MOCK_MODE</span><strong :style="{ color: sys.info?.mockMode ? 'var(--color-info)' : 'var(--color-success)' }">{{ sys.info?.mockMode ? 'true' : 'false' }}</strong></div>
          <div><span>WebSocket</span><strong>{{ sys.wsState }}</strong></div>
        </div>
        <div class="panel-head" style="margin-top: 14px;">
          <span>正在执行的场景</span>
        </div>
        <div v-if="sceneStore.running.length === 0" class="empty">无场景在执行</div>
        <div v-else class="run-list">
          <div v-for="r in sceneStore.running" :key="r.executionId" class="run-row">
            <strong>{{ r.sceneName }}</strong>
            <span class="sc-pill is-info">{{ r.status }}</span>
            <span class="run-meta">{{ r.succeeded }}/{{ r.totalActions }} 已完成</span>
          </div>
        </div>
      </div>

      <div class="sc-panel">
        <div class="panel-head">
          <span>设备网关</span>
        </div>
        <div v-if="deviceStore.gateways.length === 0" class="empty">
          MOCK 模式下不注册真实网关。在 .env 中设置 MOCK_MODE=false 后将出现 4 个网关。
        </div>
        <div v-else class="gw-list">
          <div v-for="g in deviceStore.gateways" :key="g.gateway" class="gw-row">
            <div>
              <div class="gw-name">{{ gatewayLabel(g.gateway) }}</div>
              <div class="gw-endpoint">{{ g.endpoint }}</div>
            </div>
            <span class="sc-pill" :class="statusPillClass(g.state)">{{ g.state }}</span>
          </div>
          <div v-for="g in deviceStore.gateways.filter((g) => g.lastError)" :key="`err-${g.gateway}`" class="gw-err">
            {{ gatewayLabel(g.gateway) }}: {{ g.lastError }}
          </div>
        </div>
      </div>
    </div>

    <div class="sc-panel">
      <div class="panel-head">
        <span>设备列表 ({{ deviceStore.totalCount }})</span>
        <span class="sc-pill is-success">在线 {{ deviceStore.onlineCount }}</span>
        <span class="sc-pill is-error" v-if="deviceStore.offlineDevices.length > 0">离线 {{ deviceStore.offlineDevices.length }}</span>
        <span class="sc-pill is-warning" v-if="deviceStore.errorDevices.length > 0">故障 {{ deviceStore.errorDevices.length }}</span>
      </div>
      <div class="table">
        <div class="thead">
          <div>设备</div>
          <div>类型</div>
          <div>位置</div>
          <div>状态</div>
        </div>
        <div v-for="d in rows" :key="d.id" class="trow">
          <div>
            <div class="dn">{{ d.name }}</div>
            <div class="dm">{{ d.protocol }} · {{ d.adapter }}</div>
          </div>
          <div>{{ d.category }}</div>
          <div>{{ d.floor || '-' }} {{ d.zone || '' }}</div>
          <div><span class="sc-pill" :class="statusPillClass(d.runtimeStatus)">{{ d.runtimeStatus }}</span></div>
        </div>
      </div>
    </div>

    <div class="sc-panel">
      <div class="panel-head">
        <span>报警记录</span>
        <button class="link" v-if="sys.alerts.length > 0" @click="sys.clearAlerts()">清空</button>
      </div>
      <div v-if="sys.alerts.length === 0" class="empty">暂无报警</div>
      <div v-else class="alert-list">
        <div v-for="a in sys.alerts" :key="a.id" class="alert-row" :class="`lvl-${a.level}`">
          <span class="lvl">{{ a.level }}</span>
          <span class="src">{{ a.source }}</span>
          <span class="msg">{{ a.message }}</span>
          <span class="at">{{ new Date(a.at).toLocaleTimeString() }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.page-head { display: flex; align-items: baseline; gap: 14px; }
.actions { margin-left: auto; display: flex; gap: 10px; }
.act { background: var(--bg-elevated); color: var(--text-primary); padding: 0 20px; min-height: 44px; font-size: 14px; }
.act.primary { background: var(--color-primary); color: #fff; }
.act:disabled { opacity: 0.55; }

.metrics-row {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px;
}
.metric-card {
  background: var(--bg-panel); border: 1px solid var(--border-soft);
  border-radius: 14px; padding: 14px 18px;
}
.metric-label { font-size: 12px; color: var(--text-secondary); letter-spacing: 1px; }
.metric-num { font-size: 32px; font-weight: 700; font-variant-numeric: tabular-nums; line-height: 1.15; margin-top: 2px; }
.metric-num span { font-size: 18px; color: var(--text-secondary); margin-left: 2px; }
.metric-sub { font-size: 12px; color: var(--text-secondary); margin-top: 4px; }
.metric-sub .recon { color: var(--color-warning); margin-left: 4px; }

@media (max-width: 1100px) {
  .metrics-row { grid-template-columns: repeat(2, 1fr); }
}

.grid { display: grid; gap: 16px; }
.grid-2 { grid-template-columns: 1fr 1fr; }

.panel-head { display: flex; align-items: center; gap: 10px; font-weight: 600; color: var(--text-primary); margin-bottom: 12px; }
.empty { color: var(--text-secondary); padding: 12px 0; font-size: 14px; }
.kv {
  display: grid; grid-template-columns: 1fr 1fr; gap: 10px 18px;
  font-size: 14px;
}
.kv > div { display: flex; justify-content: space-between; align-items: center; }
.kv span { color: var(--text-secondary); }
.kv strong { color: var(--text-primary); }

.gw-list { display: flex; flex-direction: column; gap: 10px; }
.gw-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 12px; background: var(--bg-elevated); border-radius: 10px;
}
.gw-name { font-size: 15px; font-weight: 600; }
.gw-endpoint { font-size: 12px; color: var(--text-secondary); margin-top: 2px; letter-spacing: 0.5px; }
.gw-err { font-size: 12px; color: var(--color-error); padding: 4px 12px; }

.run-list { display: flex; flex-direction: column; gap: 8px; }
.run-row {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 12px; background: var(--bg-elevated); border-radius: 10px; font-size: 14px;
}
.run-meta { color: var(--text-secondary); font-size: 12px; margin-left: auto; }

.table { display: flex; flex-direction: column; }
.thead, .trow {
  display: grid; grid-template-columns: 1.4fr 0.6fr 1fr 0.7fr;
  gap: 12px; align-items: center;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border-soft);
}
.thead {
  font-size: 12px; color: var(--text-secondary); letter-spacing: 1px;
}
.trow:last-child { border-bottom: none; }
.dn { font-weight: 600; }
.dm { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

.alert-list { display: flex; flex-direction: column; gap: 6px; }
.alert-row {
  display: grid; grid-template-columns: 70px 160px 1fr 90px;
  gap: 12px; align-items: center;
  padding: 8px 12px; border-radius: 8px; font-size: 13px;
  background: var(--bg-elevated);
}
.alert-row.lvl-error { background: rgba(239,68,68,0.12); }
.alert-row.lvl-warning { background: rgba(245,158,11,0.12); }
.alert-row .lvl { font-weight: 700; text-transform: uppercase; font-size: 11px; }
.alert-row.lvl-error .lvl { color: var(--color-error); }
.alert-row.lvl-warning .lvl { color: var(--color-warning); }
.alert-row .at { color: var(--text-secondary); font-variant-numeric: tabular-nums; }

.link { background: transparent; border: none; color: var(--color-primary); cursor: pointer; font-size: 13px; margin-left: auto; }

@media (max-width: 1100px) {
  .grid-2 { grid-template-columns: 1fr; }
  .alert-row { grid-template-columns: 1fr; }
}
</style>
