<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  Activity, RefreshCw, Cpu, MemoryStick, HardDrive, Clock, Server,
  Database, Wifi, CalendarClock, Beaker, BellRing, AlertTriangle, Loader,
  XCircle,
} from 'lucide-vue-next';
import { adminMonitorService } from '@/services/admin.service';
import { useDeviceStore } from '@/stores/device';
import { useSystemStore } from '@/stores/system';
import type { HealthReport, LogsSummary, SystemResources } from '@/types/api';

const deviceStore = useDeviceStore();
const sys = useSystemStore();

const health = ref<HealthReport | null>(null);
const res = ref<SystemResources | null>(null);
const logs = ref<LogsSummary | null>(null);
const loading = ref(false);
// PERFORMANCE_AUDIT P0-#3: 统一 polling 调度器
import { polling } from '@/services/polling.service';
let unsubscribePoll: (() => void) | null = null;

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [h, r, l] = await Promise.all([
      adminMonitorService.health(),
      adminMonitorService.status(),
      adminMonitorService.logsSummary(),
    ]);
    health.value = h;
    res.value = r;
    logs.value = l;
    await deviceStore.fetchGateways();
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

const overall = computed<{ text: string; cls: string }>(() => {
  if (!health.value) return { text: '加载中', cls: 'is-warning' };
  if (health.value.status === 'ok') return { text: '系统正常', cls: 'is-on' };
  if (health.value.status === 'degraded') return { text: '部分降级', cls: 'is-warning' };
  return { text: '系统故障', cls: 'is-error' };
});

function fmtUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}

function deviceOnlineRatio(): number {
  if (!health.value) return 0;
  const total = health.value.deviceOnlineCount + health.value.deviceOfflineCount;
  if (total === 0) return 0;
  return Math.round((health.value.deviceOnlineCount / total) * 100);
}

function gatewayState(name: string): string {
  return deviceStore.gateways.find((g) => g.gateway === name)?.state ?? 'unknown';
}

function statusCls(state: string): string {
  switch (state) {
    case 'online': case 'up': case 'ok': return 'is-on';
    case 'reconnecting': case 'degraded': return 'is-warning';
    case 'error': case 'offline': case 'down': return 'is-error';
    default: return 'is-off';
  }
}

const wsLabel = computed<{ text: string; cls: string }>(() => {
  switch (sys.wsState) {
    case 'open': return { text: '在线', cls: 'is-on' };
    case 'connecting': return { text: '连接中', cls: 'is-warning' };
    default: return { text: '断开', cls: 'is-error' };
  }
});

const GATEWAYS = [
  { key: 'lighting-dali-gateway', label: 'DALI 灯光' },
  { key: 'lighting-dali-cy64a',   label: 'CY-DALI64A' },
  { key: 'led-nova-vx1000',       label: 'LED 诺瓦' },
  { key: 'audio-dsp',             label: '音响 DSP' },
  { key: 'hvac-modbus',           label: '空调 Modbus' },
];

onMounted(() => {
  void refresh();
  unsubscribePoll = polling.subscribe('admin:monitor', 8_000, refresh);
});

onBeforeUnmount(() => {
  if (unsubscribePoll) unsubscribePoll();
});
</script>

<template>
  <section class="page">
    <!-- Hero -->
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><Activity :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">运维监控</h2>
          <div class="sc-subtle">系统资源 · 服务状态 · 设备在线率 · 报警与今日运行</div>
        </div>
      </div>
      <div class="hero-right">
        <span class="sc-status" :class="overall.cls">
          <span class="sc-status-dot" /> {{ overall.text }}
        </span>
        <button class="sc-touch sc-act sc-act-neutral hero-btn" :disabled="loading" @click="refresh">
          <Loader v-if="loading" :size="16" class="spin" :stroke-width="2" />
          <RefreshCw v-else :size="16" :stroke-width="2" />
          刷新
        </button>
      </div>
    </header>

    <!-- 顶部 4 张应用元信息卡 -->
    <div class="info-grid">
      <div class="info-card">
        <div class="info-label">应用</div>
        <div class="info-value"><span class="ver-num">v{{ res?.version ?? '—' }}</span></div>
        <div class="info-foot">
          <span class="info-mono"><Server :size="11" :stroke-width="2" /> {{ res?.app ?? '—' }}</span>
          <span class="info-mono">{{ res?.sprint ?? '—' }}</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-label">环境</div>
        <div class="info-value">
          <span class="env-tag" :class="res?.env === 'production' ? 'is-prod' : 'is-dev'">
            {{ res?.env ?? '—' }}
          </span>
        </div>
        <div class="info-foot">
          <span class="info-mono">{{ res?.nodeVersion ?? '—' }}</span>
          <span class="info-mono">{{ res?.platform ?? '—' }}/{{ res?.arch ?? '—' }}</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-label">运行时长</div>
        <div class="info-value"><span class="ver-num">{{ fmtUptime(res?.uptime.processSec ?? 0) }}</span></div>
        <div class="info-foot">
          <span class="info-mono"><Clock :size="11" :stroke-width="2" /> 系统 {{ fmtUptime(res?.uptime.osSec ?? 0) }}</span>
          <span class="info-mono">PID {{ res?.pid ?? '—' }}</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-label">MOCK 模式</div>
        <div class="info-value">
          <span class="env-tag" :class="res?.mockMode ? 'is-mock' : 'is-prod'">
            {{ res?.mockMode ? '模拟设备' : '真实设备' }}
          </span>
        </div>
        <div class="info-foot">
          <span class="info-mono">{{ health?.timestamp ? new Date(health.timestamp).toLocaleTimeString('zh-CN', { hour12: false }) : '—' }}</span>
        </div>
      </div>
    </div>

    <!-- 3 张资源仪表盘 -->
    <div class="grid-3">
      <div class="sc-panel res-card">
        <div class="section-head">
          <div class="section-title"><Cpu :size="16" :stroke-width="1.75" /> CPU</div>
          <span class="sc-subtle">{{ res?.cpu.cores ?? '—' }} 核 · load1m {{ res?.cpu.loadAvg1m?.toFixed(2) ?? '—' }}</span>
        </div>
        <div class="res-value">{{ res?.cpu.usagePercent?.toFixed(1) ?? '—' }}%</div>
        <div class="res-bar">
          <div class="res-fill is-cpu" :style="{ width: Math.min(100, res?.cpu.usagePercent ?? 0) + '%' }" />
        </div>
      </div>
      <div class="sc-panel res-card">
        <div class="section-head">
          <div class="section-title"><MemoryStick :size="16" :stroke-width="1.75" /> 内存</div>
          <span class="sc-subtle">{{ res?.memory.usedMb ?? '—' }} / {{ res?.memory.totalMb ?? '—' }} MB</span>
        </div>
        <div class="res-value">{{ res?.memory.usagePercent?.toFixed(1) ?? '—' }}%</div>
        <div class="res-bar">
          <div class="res-fill is-mem" :style="{ width: Math.min(100, res?.memory.usagePercent ?? 0) + '%' }" />
        </div>
      </div>
      <div class="sc-panel res-card">
        <div class="section-head">
          <div class="section-title"><HardDrive :size="16" :stroke-width="1.75" /> 磁盘</div>
          <span class="sc-subtle">{{ res?.disk.usedGb?.toFixed(1) ?? '—' }} / {{ res?.disk.totalGb?.toFixed(0) ?? '—' }} GB</span>
        </div>
        <div class="res-value">{{ res?.disk.usagePercent?.toFixed(1) ?? '—' }}%</div>
        <div class="res-bar">
          <div class="res-fill is-disk" :style="{ width: Math.min(100, res?.disk.usagePercent ?? 0) + '%' }" />
        </div>
      </div>
    </div>

    <!-- 服务状态 + 网关状态 -->
    <div class="grid-2">
      <div class="sc-panel section">
        <div class="section-head">
          <div class="section-title"><Server :size="16" :stroke-width="1.75" /> 服务状态</div>
        </div>
        <div class="svc-list">
          <!--
            显示整体健康 status (ok/degraded/down), 不再显示 apiStatus ——
            后者在 health.service 里是硬编码常量 'up', 这个灯永远是绿的, 纯骗人:
            数据库挂了、调度器没起, 它照样显示正常。status 才是真算出来的
            (db 挂=down / ws|scheduler 没起=degraded)。2026-07-19 改。
          -->
          <div class="svc-row">
            <span class="svc-name"><Server :size="14" :stroke-width="2" /> 整体</span>
            <span class="sc-status" :class="statusCls(health?.status ?? '')">
              <span class="sc-status-dot" /> {{ health?.status ?? '—' }}
            </span>
          </div>
          <div class="svc-row">
            <span class="svc-name"><Database :size="14" :stroke-width="2" /> 数据库</span>
            <span class="sc-status" :class="statusCls(health?.databaseStatus ?? '')">
              <span class="sc-status-dot" /> {{ health?.databaseStatus ?? '—' }}
            </span>
          </div>
          <div class="svc-row">
            <span class="svc-name"><Wifi :size="14" :stroke-width="2" /> WebSocket</span>
            <span class="sc-status" :class="wsLabel.cls">
              <span class="sc-status-dot" /> {{ wsLabel.text }}
            </span>
          </div>
          <div class="svc-row">
            <span class="svc-name"><CalendarClock :size="14" :stroke-width="2" /> 定时任务</span>
            <span class="sc-status" :class="statusCls(health?.schedulerStatus ?? '')">
              <span class="sc-status-dot" /> {{ health?.schedulerStatus ?? '—' }}
            </span>
          </div>
          <div class="svc-row">
            <span class="svc-name"><Beaker :size="14" :stroke-width="2" /> MOCK 模式</span>
            <span class="sc-status" :class="res?.mockMode ? 'is-warning' : 'is-on'">
              <span class="sc-status-dot" /> {{ res?.mockMode ? '启用' : '关闭' }}
            </span>
          </div>
        </div>
      </div>

      <div class="sc-panel section">
        <div class="section-head">
          <div class="section-title"><Activity :size="16" :stroke-width="1.75" /> 设备网关</div>
          <span class="sc-subtle">
            在线率 {{ deviceOnlineRatio() }}%
            ({{ health?.deviceOnlineCount ?? 0 }}/{{ (health?.deviceOnlineCount ?? 0) + (health?.deviceOfflineCount ?? 0) }})
          </span>
        </div>
        <div v-if="deviceStore.gateways.length === 0" class="empty">
          <Beaker :size="18" :stroke-width="1.5" />
          <div>MOCK 模式下不注册真实网关 · 切真实模式后这里显示 4-5 个网关状态</div>
        </div>
        <div v-else class="svc-list">
          <div v-for="g in GATEWAYS" :key="g.key" v-show="deviceStore.gateways.some((gw) => gw.gateway === g.key)" class="svc-row">
            <span class="svc-name">{{ g.label }}</span>
            <span class="sc-status" :class="statusCls(gatewayState(g.key))">
              <span class="sc-status-dot" /> {{ gatewayState(g.key) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- 设备在线率 + 报警 + 今日运行 -->
    <div class="grid-3">
      <!-- 设备在线 -->
      <div class="sc-panel section">
        <div class="section-head">
          <div class="section-title"><Activity :size="16" :stroke-width="1.75" /> 设备在线率</div>
        </div>
        <div class="big-num" :class="deviceOnlineRatio() >= 80 ? 'is-good' : 'is-bad'">
          {{ deviceOnlineRatio() }}<span>%</span>
        </div>
        <div class="num-foot">
          <span class="sc-status is-on"><span class="sc-status-dot" /> 在线 {{ health?.deviceOnlineCount ?? 0 }}</span>
          <span class="sc-status is-off"><span class="sc-status-dot" /> 离线 {{ health?.deviceOfflineCount ?? 0 }}</span>
        </div>
      </div>

      <!-- 当前报警 -->
      <div class="sc-panel section">
        <div class="section-head">
          <div class="section-title"><BellRing :size="16" :stroke-width="1.75" /> 当前报警</div>
          <span class="sc-subtle">24h 新增 {{ logs?.alerts.last24h ?? 0 }}</span>
        </div>
        <div class="big-num" :class="(logs?.alerts.active ?? 0) > 0 ? 'is-bad' : 'is-good'">
          {{ logs?.alerts.active ?? 0 }}
        </div>
        <div class="lv-list">
          <div class="lv-row" v-for="lv in ['emergency','critical','warning','info'] as const" :key="lv">
            <span class="lv-dot" :class="'lv-' + lv" />
            <span class="lv-label">{{ lv }}</span>
            <span class="lv-num">{{ logs?.alerts.byLevel[lv] ?? 0 }}</span>
          </div>
        </div>
      </div>

      <!-- 今日运行 -->
      <div class="sc-panel section">
        <div class="section-head">
          <div class="section-title"><CalendarClock :size="16" :stroke-width="1.75" /> 今日运行</div>
        </div>
        <div class="kpi-list">
          <div class="kpi-row">
            <span class="kpi-label">操作次数</span>
            <span class="kpi-val">{{ logs?.operations ?? 0 }}</span>
          </div>
          <div class="kpi-row">
            <span class="kpi-label">场景执行</span>
            <span class="kpi-val">{{ logs?.sceneExecutions ?? 0 }}</span>
          </div>
          <div class="kpi-row">
            <span class="kpi-label kpi-bad"><AlertTriangle :size="13" :stroke-width="2" /> 执行失败</span>
            <span class="kpi-val" :class="(logs?.sceneFailures ?? 0) > 0 ? 'kpi-bad' : ''">
              {{ logs?.sceneFailures ?? 0 }}
            </span>
          </div>
          <div class="kpi-row">
            <span class="kpi-label kpi-bad"><XCircle :size="13" :stroke-width="2" /> 设备离线</span>
            <span class="kpi-val" :class="(logs?.deviceOffline ?? 0) > 0 ? 'kpi-bad' : ''">
              {{ logs?.deviceOffline ?? 0 }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }

/* Hero */
.hero {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
}
.hero-left { display: flex; align-items: center; gap: 14px; }
.hero-right { display: flex; align-items: center; gap: 10px; }
.hero-btn { min-height: 42px; padding: 0 16px; }

/* 4 张元信息卡 (沿用 SettingsAdmin 的 info-card 风格) */
.info-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.info-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 16px 18px 14px;
  position: relative;
  overflow: hidden;
}
.info-card::before {
  content: '';
  position: absolute; top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #4C9AFF 0%, #9BA1A9 80%, transparent 100%);
}
.info-label {
  font-size: 11px; color: var(--text-secondary);
  letter-spacing: 1.5px; text-transform: uppercase;
}
.info-value {
  margin: 6px 0 4px;
  font-size: 22px; font-weight: 700;
  display: flex; align-items: baseline; gap: 8px;
}
.ver-num {
  background: linear-gradient(135deg, #4C9AFF, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
}
.env-tag {
  font-size: 14px; padding: 4px 12px; border-radius: 999px;
  font-weight: 600; letter-spacing: 1px;
}
.env-tag.is-prod {
  background: rgba(63, 191, 135, 0.14);
  color: #3FBF87;
  border: 1px solid rgba(63, 191, 135, 0.32);
}
.env-tag.is-dev {
  background: rgba(224, 160, 48, 0.14);
  color: #E0A030;
  border: 1px solid rgba(224, 160, 48, 0.32);
}
.env-tag.is-mock {
  background: var(--v2-ov-2);
  color: #9BA1A9;
  border: 1px solid var(--v2-border-soft);
}
.info-foot { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 6px; }
.info-mono {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-secondary);
}

/* Section panel */
.section { display: flex; flex-direction: column; gap: 14px; }
.section-head {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
}
.section-title {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 600;
}
.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }

/* 资源卡 */
.res-card { display: flex; flex-direction: column; gap: 12px; }
.res-value {
  font-size: 36px; font-weight: 700;
  background: linear-gradient(135deg, #4C9AFF, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
  letter-spacing: -1px;
}
.res-bar { height: 6px; background: var(--bg-elevated); border-radius: 3px; overflow: hidden; }
.res-fill { height: 100%; transition: width 0.4s ease; border-radius: 3px; }
.res-fill.is-cpu  { background: linear-gradient(90deg, #3FBF87, #06b6d4); }
.res-fill.is-mem  { background: linear-gradient(90deg, #4C9AFF, #9BA1A9); }
.res-fill.is-disk { background: linear-gradient(90deg, #E0A030, #E5645D); }

/* 服务列表 / 网关列表 */
.svc-list { display: flex; flex-direction: column; gap: 6px; }
.svc-row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 10px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  font-size: 14px;
}
.svc-name {
  display: inline-flex; align-items: center; gap: 8px;
  font-weight: 500;
}

/* 大数 KPI 卡 */
.big-num {
  font-size: 56px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  letter-spacing: -2px;
  background: linear-gradient(135deg, #3FBF87, #3FBF87);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.big-num.is-bad {
  background: linear-gradient(135deg, #E5645D, #E5645D);
  -webkit-background-clip: text;
  background-clip: text;
}
.big-num span { font-size: 24px; -webkit-text-fill-color: var(--text-secondary); color: var(--text-secondary); margin-left: 4px; }
.num-foot { display: flex; gap: 8px; flex-wrap: wrap; }

/* 报警等级 / KPI 列表 */
.lv-list { display: flex; flex-direction: column; gap: 4px; }
.lv-row {
  display: flex; align-items: center; gap: 10px;
  padding: 6px 10px;
  font-size: 13px;
}
.lv-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.lv-emergency { background: #dc2626; box-shadow: 0 0 8px #dc2626; }
.lv-critical  { background: #E5645D; }
.lv-warning   { background: #E0A030; }
.lv-info      { background: #4C9AFF; }
.lv-label { color: var(--text-secondary); flex: 1; letter-spacing: 1px; text-transform: uppercase; font-size: 11px; }
.lv-num {
  font-weight: 700;
  font-variant-numeric: tabular-nums;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

.kpi-list { display: flex; flex-direction: column; gap: 6px; }
.kpi-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 10px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  font-size: 14px;
}
.kpi-label {
  color: var(--text-secondary);
  display: inline-flex; align-items: center; gap: 6px;
}
.kpi-bad { color: #E5645D; }
.kpi-val {
  font-weight: 700;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
  font-size: 16px;
}

/* Empty */
.empty {
  padding: 18px 16px;
  color: var(--text-secondary);
  font-size: 13px;
  background: var(--bg-elevated);
  border: 1px dashed var(--border-soft);
  border-radius: 10px;
  display: flex; align-items: center; gap: 12px;
}

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1280px) {
  .info-grid { grid-template-columns: repeat(2, 1fr); }
  .grid-3 { grid-template-columns: 1fr 1fr; }
  .grid-2 { grid-template-columns: 1fr; }
}
</style>
