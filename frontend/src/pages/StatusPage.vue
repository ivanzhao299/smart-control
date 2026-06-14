<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  ArrowLeft, Activity, RefreshCw, Cpu, MemoryStick, AlertCircle, Wifi,
  RadioReceiver, Trash2,
} from 'lucide-vue-next';
import { useDeviceStore } from '@/stores/device';
import { useSceneStore } from '@/stores/scene';
import { useSystemStore } from '@/stores/system';
import { deviceService } from '@/services/device.service';
import { adminMonitorService } from '@/services/admin.service';
import { polling } from '@/services/polling.service';
import type { HealthReport, SystemResources } from '@/types/api';

const router = useRouter();
const deviceStore = useDeviceStore();
const sceneStore = useSceneStore();
const sys = useSystemStore();

const health = ref<HealthReport | null>(null);
const res = ref<SystemResources | null>(null);

async function refreshResource(): Promise<void> {
  try {
    const [h, r] = await Promise.all([
      adminMonitorService.health(),
      adminMonitorService.status(),
    ]);
    health.value = h;
    res.value = r;
  } catch { /* 后端未起或权限不足时容错 */ }
}

// PERFORMANCE_AUDIT P0-#3: 走统一 polling 调度器, WS 在线时自动降速
let unsubscribePoll: (() => void) | null = null;
onMounted(() => {
  void refreshResource();
  unsubscribePoll = polling.subscribe('status:resource', 10_000, refreshResource);
});
onBeforeUnmount(() => {
  if (unsubscribePoll) unsubscribePoll();
});

const deviceOnlineRatio = computed(() => {
  if (!health.value) return 0;
  const total = health.value.deviceOnlineCount + health.value.deviceOfflineCount;
  if (total === 0) return 0;
  return Math.round((health.value.deviceOnlineCount / total) * 100);
});

function gaugeColor(p: number): string {
  if (p >= 90) return 'var(--v2-danger)';
  if (p >= 70) return 'var(--v2-warning)';
  return 'var(--v2-success)';
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
    const r = await deviceService.clearGatewayFaults();
    await deviceStore.fetchGateways();
    ElMessage.success(r?.message ?? '已清空旧告警');
  } catch (err) {
    ElMessage.error(`清空失败: ${(err as Error).message}`);
  } finally { clearing.value = false; }
}

const rows = computed(() =>
  deviceStore.devices.map((d) => ({ ...d, runtimeStatus: deviceStore.statusOf(d.name) })),
);

function statusCls(s: string): string {
  if (s === 'online' || s === 'running') return 'success';
  if (s === 'reconnecting') return 'warn';
  if (s === 'error' || s === 'offline') return 'danger';
  return 'idle';
}

function gatewayLabel(name: string): string {
  if (name.includes('lighting')) return '灯光网关';
  if (name.includes('led')) return 'LED 控制器';
  if (name.includes('audio')) return '音响 DSP';
  if (name.includes('hvac')) return '空调网关';
  return name;
}

function goBack(): void { router.push({ name: 'dashboard' }); }
</script>

<template>
  <section class="v2-page">
    <header class="v2-page-head">
      <div class="back-row">
        <button class="v2-back-btn" @click="goBack" title="返回首页">
          <ArrowLeft :size="18" :stroke-width="2" />
        </button>
        <div class="title-block">
          <div class="title"><Activity :size="18" :stroke-width="1.8" /> 系统状态</div>
          <div class="sub">设备 / 网关 / 告警 / 中控主机</div>
        </div>
      </div>
      <div class="quick-actions">
        <button class="v2-quick" :disabled="clearing" @click="clearFaults">
          <Trash2 :size="14" :stroke-width="2" /> {{ clearing ? '清空中...' : '清空旧告警' }}
        </button>
        <button class="v2-quick" :disabled="probing" @click="probe">
          <RadioReceiver :size="14" :stroke-width="2" /> {{ probing ? '探活中...' : '立即探活' }}
        </button>
        <button class="v2-quick primary" :disabled="refreshing" @click="refresh">
          <RefreshCw :size="14" :stroke-width="2" /> {{ refreshing ? '刷新中...' : '刷新' }}
        </button>
      </div>
    </header>

    <!-- 指标 4 卡 -->
    <div class="v2-metrics">
      <div class="metric">
        <div class="metric-label">设备在线率</div>
        <div class="metric-num v2-inter" :style="{ color: gaugeColor(100 - deviceOnlineRatio) }">
          {{ deviceOnlineRatio }}<span class="unit">%</span>
        </div>
        <div class="metric-sub">
          在线 {{ health?.deviceOnlineCount ?? 0 }} · 离线 {{ health?.deviceOfflineCount ?? 0 }}
          <span v-if="(health?.reconnectingCount ?? 0) > 0" class="recon">· 重连 {{ health?.reconnectingCount }}</span>
        </div>
      </div>
      <div class="metric">
        <div class="metric-label"><Cpu :size="14" :stroke-width="2" /> CPU</div>
        <div class="metric-num v2-inter" :style="{ color: gaugeColor(res?.cpu.usagePercent ?? 0) }">
          {{ res?.cpu.usagePercent ?? 0 }}<span class="unit">%</span>
        </div>
        <div class="metric-sub">{{ res?.cpu.cores ?? '—' }} 核 · 负载 {{ res?.cpu.loadAvg1m ?? '—' }}</div>
      </div>
      <div class="metric">
        <div class="metric-label"><MemoryStick :size="14" :stroke-width="2" /> 内存</div>
        <div class="metric-num v2-inter" :style="{ color: gaugeColor(res?.memory.usagePercent ?? 0) }">
          {{ res?.memory.usagePercent ?? 0 }}<span class="unit">%</span>
        </div>
        <div class="metric-sub">{{ res?.memory.usedMb ?? '—' }} / {{ res?.memory.totalMb ?? '—' }} MB</div>
      </div>
      <div class="metric">
        <div class="metric-label"><AlertCircle :size="14" :stroke-width="2" /> 当前告警</div>
        <div class="metric-num v2-inter" :style="{ color: sys.alerts.length > 0 ? 'var(--v2-danger)' : 'var(--v2-success)' }">
          {{ sys.alerts.length }}<span class="unit">条</span>
        </div>
        <div class="metric-sub"><Wifi :size="11" :stroke-width="2" /> WS {{ sys.wsState }}</div>
      </div>
    </div>

    <!-- 两栏: 中控主机 + 网关 -->
    <div class="grid-2">
      <div class="v2-card">
        <div class="card-head"><span class="accent">●</span>中控主机</div>
        <div class="kv">
          <div><span>应用</span><strong>{{ sys.info?.app ?? '—' }}</strong></div>
          <div><span>环境</span><strong>{{ sys.info?.env ?? '—' }}</strong></div>
          <div><span>版本</span><strong>{{ sys.info?.version ?? '—' }}</strong></div>
          <div><span>Sprint</span><strong>{{ sys.info?.sprint ?? '—' }}</strong></div>
          <div><span>MOCK_MODE</span><strong :style="{ color: sys.info?.mockMode ? 'var(--v2-info)' : 'var(--v2-success)' }">{{ sys.info?.mockMode ? 'true' : 'false' }}</strong></div>
          <div><span>WebSocket</span><strong>{{ sys.wsState }}</strong></div>
        </div>

        <div class="card-head" style="margin-top: 16px;"><span class="accent">●</span>执行中场景</div>
        <div v-if="sceneStore.running.length === 0" class="empty">无场景在执行</div>
        <div v-else class="run-list">
          <div v-for="r in sceneStore.running" :key="r.executionId" class="run-row">
            <strong>{{ r.sceneName }}</strong>
            <span class="v2-mini-pill info">{{ r.status }}</span>
            <span class="run-meta v2-inter">{{ r.succeeded }}/{{ r.totalActions }}</span>
          </div>
        </div>
      </div>

      <div class="v2-card">
        <div class="card-head"><span class="accent">●</span>设备网关</div>
        <div v-if="deviceStore.gateways.length === 0" class="empty">
          MOCK 模式下不注册真实网关. 设 MOCK_MODE=false 后会出现 4 个网关.
        </div>
        <div v-else class="gw-list">
          <div v-for="g in deviceStore.gateways" :key="g.gateway" class="gw-row">
            <div class="gw-meta">
              <div class="gw-name">{{ gatewayLabel(g.gateway) }}</div>
              <div class="gw-endpoint v2-inter">{{ g.endpoint }}</div>
            </div>
            <span class="v2-mini-pill" :class="statusCls(g.state)">{{ g.state }}</span>
          </div>
          <div v-for="g in deviceStore.gateways.filter((g) => g.lastError)" :key="`err-${g.gateway}`" class="gw-err">
            <AlertCircle :size="12" :stroke-width="2" /> {{ gatewayLabel(g.gateway) }}: {{ g.lastError }}
          </div>
        </div>
      </div>
    </div>

    <!-- 设备列表 -->
    <div class="v2-card">
      <div class="card-head">
        <span class="accent">●</span>设备列表
        <span class="card-sub">共 {{ deviceStore.totalCount }} · 在线 {{ deviceStore.onlineCount }} · 离线 {{ deviceStore.offlineDevices.length }}</span>
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
            <div class="dm v2-inter">{{ d.protocol }} · {{ d.adapter }}</div>
          </div>
          <div>{{ d.category }}</div>
          <div>{{ d.floor || '-' }} {{ d.zone || '' }}</div>
          <div><span class="v2-mini-pill" :class="statusCls(d.runtimeStatus)">{{ d.runtimeStatus }}</span></div>
        </div>
      </div>
    </div>

    <!-- 报警列表 -->
    <div class="v2-card">
      <div class="card-head">
        <span class="accent">●</span>报警记录
        <button v-if="sys.alerts.length > 0" class="link" @click="sys.clearAlerts()">清空</button>
      </div>
      <div v-if="sys.alerts.length === 0" class="empty">暂无报警</div>
      <div v-else class="alert-list">
        <div v-for="a in sys.alerts" :key="a.id" class="alert-row" :class="`lvl-${a.level}`">
          <span class="lvl">{{ a.level }}</span>
          <span class="src">{{ a.source }}</span>
          <span class="msg">{{ a.message }}</span>
          <span class="at v2-inter">{{ new Date(a.at).toLocaleTimeString() }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.v2-page { padding: var(--v2-sp-5); display: flex; flex-direction: column; gap: var(--v2-sp-4); }

.v2-page-head { display: flex; justify-content: space-between; align-items: center; gap: var(--v2-sp-4); flex-wrap: wrap; }
.back-row { display: flex; align-items: center; gap: var(--v2-sp-4); }
.v2-back-btn {
  width: 36px; height: 36px; border-radius: var(--v2-r-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  display: grid; place-items: center; cursor: pointer; color: var(--v2-text-2);
  transition: all 0.18s ease;
}
.v2-back-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.title-block { display: flex; flex-direction: column; }
.title { font-size: 15px; font-weight: 600; color: var(--v2-text-1); display: inline-flex; align-items: center; gap: var(--v2-sp-2); }
.sub { font-size: var(--v2-fs-xs); color: var(--v2-text-3); margin-top: 2px; }
.quick-actions { display: flex; gap: var(--v2-sp-2); }
.v2-quick {
  padding: 8px 14px; border-radius: var(--v2-r-sm); font-size: var(--v2-fs-sm);
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2); cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: all 0.18s ease; min-height: 36px;
}
.v2-quick:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.v2-quick.primary {
  background: var(--v2-primary-soft); color: var(--v2-primary);
  border-color: rgba(6, 182, 212, 0.3);
}
.v2-quick:disabled { opacity: 0.5; cursor: not-allowed; }

/* Metrics */
.v2-metrics {
  display: grid; grid-template-columns: repeat(4, 1fr); gap: var(--v2-sp-3);
}
.metric {
  padding: var(--v2-sp-4);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
}
.metric-label {
  font-size: var(--v2-fs-xs); color: var(--v2-text-3);
  letter-spacing: 1px;
  display: inline-flex; align-items: center; gap: 6px;
}
.metric-num {
  font-size: 32px; font-weight: 700;
  line-height: 1.15; margin-top: var(--v2-sp-1);
  color: var(--v2-text-1);
}
.metric-num .unit { font-size: 16px; color: var(--v2-text-3); margin-left: 2px; }
.metric-sub {
  font-size: var(--v2-fs-xs); color: var(--v2-text-3);
  margin-top: var(--v2-sp-1);
  display: inline-flex; align-items: center; gap: 6px;
}
.metric-sub .recon { color: var(--v2-warning); margin-left: 4px; }

@media (max-width: 1100px) {
  .v2-metrics { grid-template-columns: repeat(2, 1fr); }
}

/* Card */
.v2-card {
  padding: var(--v2-sp-4);
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: var(--v2-r-md);
  backdrop-filter: blur(5px); -webkit-backdrop-filter: blur(5px);
}
.card-head {
  font-size: var(--v2-fs-md);
  font-weight: 600;
  margin-bottom: var(--v2-sp-3);
  display: flex; align-items: center; gap: var(--v2-sp-2);
  color: var(--v2-text-1);
  letter-spacing: 0.5px;
}
.card-head .accent { color: var(--v2-primary); }
.card-sub {
  font-size: var(--v2-fs-xs); color: var(--v2-text-3);
  margin-left: auto;
  font-weight: 400;
}
.empty { color: var(--v2-text-3); padding: var(--v2-sp-3) 0; font-size: 14px; }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--v2-sp-3); }
@media (max-width: 1100px) { .grid-2 { grid-template-columns: 1fr; } }

/* KV */
.kv { display: grid; grid-template-columns: 1fr 1fr; gap: var(--v2-sp-2) var(--v2-sp-4); font-size: 14px; }
.kv > div { display: flex; justify-content: space-between; align-items: center; }
.kv span { color: var(--v2-text-3); font-size: var(--v2-fs-xs); }
.kv strong { color: var(--v2-text-1); font-weight: 500; font-size: 13px; }

/* Gateway list */
.gw-list { display: flex; flex-direction: column; gap: var(--v2-sp-2); }
.gw-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: var(--v2-sp-3); background: var(--v2-surf-2);
  border-radius: var(--v2-r-sm);
}
.gw-meta { min-width: 0; }
.gw-name { font-size: 14px; font-weight: 600; color: var(--v2-text-1); }
.gw-endpoint { font-size: 11px; color: var(--v2-text-3); margin-top: 2px; letter-spacing: 0.5px; }
.gw-err {
  font-size: 11px; color: var(--v2-danger);
  padding: var(--v2-sp-2) var(--v2-sp-3);
  background: rgba(239, 68, 68, 0.06);
  border-radius: var(--v2-r-sm);
  display: inline-flex; align-items: center; gap: 6px;
}

.run-list { display: flex; flex-direction: column; gap: var(--v2-sp-2); }
.run-row {
  display: flex; align-items: center; gap: var(--v2-sp-2);
  padding: var(--v2-sp-2) var(--v2-sp-3);
  background: var(--v2-surf-2); border-radius: var(--v2-r-sm); font-size: 13px;
}
.run-meta { color: var(--v2-text-3); font-size: var(--v2-fs-xs); margin-left: auto; }

/* Table */
.table { display: flex; flex-direction: column; }
.thead, .trow {
  display: grid; grid-template-columns: 1.4fr 0.6fr 1fr 0.7fr;
  gap: var(--v2-sp-3); align-items: center;
  padding: var(--v2-sp-3);
  border-bottom: 1px solid var(--v2-border-soft);
}
.thead { font-size: var(--v2-fs-xs); color: var(--v2-text-3); letter-spacing: 1px; }
.trow:last-child { border-bottom: none; }
.dn { font-weight: 600; color: var(--v2-text-1); font-size: 14px; }
.dm { font-size: 11px; color: var(--v2-text-3); margin-top: 2px; }

/* Mini pill */
.v2-mini-pill {
  display: inline-block;
  padding: 2px 8px;
  font-size: 11px;
  border-radius: 999px;
  letter-spacing: 0.5px;
  font-weight: 500;
}
.v2-mini-pill.success { background: rgba(16, 185, 129, 0.14); color: var(--v2-success); }
.v2-mini-pill.warn { background: var(--v2-amber-soft); color: var(--v2-amber); }
.v2-mini-pill.danger { background: rgba(239, 68, 68, 0.12); color: var(--v2-danger); }
.v2-mini-pill.idle { background: var(--v2-surf-2); color: var(--v2-text-3); }
.v2-mini-pill.info { background: var(--v2-primary-soft); color: var(--v2-primary); }

/* Alert rows */
.alert-list { display: flex; flex-direction: column; gap: 6px; }
.alert-row {
  display: grid; grid-template-columns: 60px 160px 1fr 80px;
  gap: var(--v2-sp-3); align-items: center;
  padding: var(--v2-sp-2) var(--v2-sp-3);
  border-radius: var(--v2-r-sm);
  background: var(--v2-surf-2);
  font-size: 13px;
}
.alert-row.lvl-error { background: rgba(239, 68, 68, 0.1); }
.alert-row.lvl-warning { background: rgba(245, 158, 11, 0.1); }
.alert-row .lvl { font-weight: 700; text-transform: uppercase; font-size: 10px; letter-spacing: 1px; }
.alert-row.lvl-error .lvl { color: var(--v2-danger); }
.alert-row.lvl-warning .lvl { color: var(--v2-warning); }
.alert-row .src { color: var(--v2-text-2); font-size: 12px; }
.alert-row .msg { color: var(--v2-text-1); }
.alert-row .at { color: var(--v2-text-3); font-size: 11px; }

@media (max-width: 1100px) {
  .alert-row { grid-template-columns: 1fr; gap: 4px; }
}

.link {
  background: transparent; border: none;
  color: var(--v2-primary); cursor: pointer;
  font-size: 13px; margin-left: auto;
}
</style>
