<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
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
let pollTimer: number | undefined;

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

const overallStatus = computed(() => {
  if (!health.value) return { text: '加载中', cls: 'is-info' };
  if (health.value.status === 'ok') return { text: '正常', cls: 'is-ok' };
  if (health.value.status === 'degraded') return { text: '部分降级', cls: 'is-warn' };
  return { text: '故障', cls: 'is-err' };
});

function fmtUptime(sec: number): string {
  if (!sec) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}天 ${h}时 ${m}分`;
  if (h > 0) return `${h}时 ${m}分 ${s}秒`;
  if (m > 0) return `${m}分 ${s}秒`;
  return `${s}秒`;
}

function gaugeColor(percent: number): string {
  if (percent >= 90) return 'var(--color-error)';
  if (percent >= 70) return 'var(--color-warning)';
  return 'var(--color-success)';
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

function gatewayTag(state: string): string {
  switch (state) {
    case 'online': return 'success';
    case 'reconnecting': return 'warning';
    case 'error':
    case 'offline':
      return 'danger';
    default: return 'info';
  }
}

const wsLabel = computed(() => {
  switch (sys.wsState) {
    case 'open': return { text: '在线', cls: 'success' };
    case 'connecting': return { text: '连接中', cls: 'warning' };
    default: return { text: '断开', cls: 'danger' };
  }
});

onMounted(() => {
  void refresh();
  pollTimer = window.setInterval(refresh, 8000);
});

onBeforeUnmount(() => {
  if (pollTimer) window.clearInterval(pollTimer);
});
</script>

<template>
  <section class="page">
    <!-- 顶部全局状态 -->
    <div class="hero">
      <div class="hero-left">
        <div class="hero-icon" :class="overallStatus.cls">●</div>
        <div>
          <div class="hero-status">系统状态: <strong>{{ overallStatus.text }}</strong></div>
          <div class="hero-meta">
            {{ res?.app ?? '—' }} · v{{ res?.version ?? '—' }} · {{ res?.sprint ?? '—' }} ·
            {{ res?.env ?? '—' }} · {{ res?.nodeVersion ?? '—' }} on {{ res?.platform ?? '—' }}
          </div>
        </div>
      </div>
      <div class="hero-right">
        <el-button @click="refresh" :loading="loading">刷新</el-button>
      </div>
    </div>

    <!-- 资源监控 -->
    <div class="grid-3">
      <div class="card">
        <div class="card-title">CPU</div>
        <div class="gauge">
          <div class="gauge-num" :style="{ color: gaugeColor(res?.cpu.usagePercent ?? 0) }">
            {{ res?.cpu.usagePercent ?? 0 }}<span>%</span>
          </div>
          <el-progress
            :percentage="Math.min(100, res?.cpu.usagePercent ?? 0)"
            :color="gaugeColor(res?.cpu.usagePercent ?? 0)"
            :show-text="false"
            :stroke-width="10"
          />
          <div class="gauge-sub">负载 (1m): {{ res?.cpu.loadAvg1m ?? '—' }} · {{ res?.cpu.cores ?? '—' }} 核</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">内存</div>
        <div class="gauge">
          <div class="gauge-num" :style="{ color: gaugeColor(res?.memory.usagePercent ?? 0) }">
            {{ res?.memory.usagePercent ?? 0 }}<span>%</span>
          </div>
          <el-progress
            :percentage="Math.min(100, res?.memory.usagePercent ?? 0)"
            :color="gaugeColor(res?.memory.usagePercent ?? 0)"
            :show-text="false"
            :stroke-width="10"
          />
          <div class="gauge-sub">{{ res?.memory.usedMb ?? '—' }} / {{ res?.memory.totalMb ?? '—' }} MB</div>
        </div>
      </div>
      <div class="card">
        <div class="card-title">磁盘</div>
        <div class="gauge">
          <div class="gauge-num" :style="{ color: gaugeColor(res?.disk.usagePercent ?? 0) }">
            {{ res?.disk.usagePercent ?? 0 }}<span>%</span>
          </div>
          <el-progress
            :percentage="Math.min(100, res?.disk.usagePercent ?? 0)"
            :color="gaugeColor(res?.disk.usagePercent ?? 0)"
            :show-text="false"
            :stroke-width="10"
          />
          <div class="gauge-sub">{{ res?.disk.usedGb ?? '—' }} / {{ res?.disk.totalGb ?? '—' }} GB</div>
        </div>
      </div>
    </div>

    <!-- 服务状态 + 运行时长 -->
    <div class="grid-2">
      <div class="card">
        <div class="card-title">服务状态</div>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="API">
            <el-tag :type="health?.apiStatus === 'up' ? 'success' : 'danger'" size="small">
              {{ health?.apiStatus ?? '—' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="数据库">
            <el-tag :type="health?.databaseStatus === 'up' ? 'success' : 'danger'" size="small">
              {{ health?.databaseStatus ?? '—' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="WebSocket">
            <el-tag :type="(wsLabel.cls as 'success' | 'warning' | 'danger')" size="small">
              {{ wsLabel.text }}
            </el-tag>
            <span class="sc-subtle"> · 后端报告 {{ health?.websocketStatus ?? '—' }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="定时任务">
            <el-tag :type="health?.schedulerStatus === 'up' ? 'success' : 'warning'" size="small">
              {{ health?.schedulerStatus ?? '—' }}
            </el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="MOCK 模式">
            <el-tag :type="res?.mockMode ? 'info' : 'success'" size="small">
              {{ res?.mockMode ? '是' : '否' }}
            </el-tag>
          </el-descriptions-item>
        </el-descriptions>
      </div>

      <div class="card">
        <div class="card-title">运行时长</div>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="进程">{{ fmtUptime(res?.uptime.processSec ?? 0) }}</el-descriptions-item>
          <el-descriptions-item label="操作系统">{{ fmtUptime(res?.uptime.osSec ?? 0) }}</el-descriptions-item>
          <el-descriptions-item label="PID">{{ res?.pid ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="架构">{{ res?.arch ?? '—' }}</el-descriptions-item>
          <el-descriptions-item label="后端时间">{{ health?.timestamp ? new Date(health.timestamp).toLocaleString() : '—' }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </div>

    <!-- 设备 + 报警 + 今日运行 -->
    <div class="grid-3">
      <div class="card">
        <div class="card-title">设备在线率</div>
        <div class="big-num" :class="deviceOnlineRatio() >= 80 ? 'is-ok' : 'is-warn'">
          {{ deviceOnlineRatio() }}<span>%</span>
        </div>
        <div class="sc-subtle">
          在线 {{ health?.deviceOnlineCount ?? 0 }} / 离线 {{ health?.deviceOfflineCount ?? 0 }}
        </div>
        <div class="gateway-list">
          <div v-for="g in ['lighting-dali-gateway','led-nova-vx1000','audio-dsp','hvac-modbus']" :key="g" class="gw-row">
            <span class="gw-name">{{ g }}</span>
            <el-tag :type="(gatewayTag(gatewayState(g)) as 'success'|'warning'|'danger'|'info')" size="small">
              {{ gatewayState(g) }}
            </el-tag>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">当前报警</div>
        <div class="big-num" :class="(logs?.alerts.active ?? 0) > 0 ? 'is-err' : 'is-ok'">
          {{ logs?.alerts.active ?? 0 }}
        </div>
        <div class="sc-subtle">最近 24 小时新增 {{ logs?.alerts.last24h ?? 0 }} 条</div>
        <div class="level-rows">
          <div class="lv-row" v-for="lv in ['emergency','critical','warning','info'] as const" :key="lv">
            <span :class="['lv-dot', 'lv-' + lv]"></span>
            <span class="lv-label">{{ lv }}</span>
            <span class="lv-num">{{ logs?.alerts.byLevel[lv] ?? 0 }}</span>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-title">今日运行</div>
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="操作次数">{{ logs?.operations ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="场景执行">{{ logs?.sceneExecutions ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="执行失败">{{ logs?.sceneFailures ?? 0 }}</el-descriptions-item>
          <el-descriptions-item label="设备离线">{{ logs?.deviceOffline ?? 0 }}</el-descriptions-item>
        </el-descriptions>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.hero {
  display: flex; justify-content: space-between; align-items: center;
  background: var(--bg-panel); border-radius: 14px; padding: 18px 22px;
  border: 1px solid var(--border-soft);
}
.hero-left { display: flex; gap: 14px; align-items: center; }
.hero-icon {
  font-size: 30px; line-height: 1;
}
.hero-icon.is-ok { color: var(--color-success); }
.hero-icon.is-warn { color: var(--color-warning); }
.hero-icon.is-err { color: var(--color-error); }
.hero-status { font-size: 18px; font-weight: 600; }
.hero-meta { font-size: 13px; color: var(--text-secondary); margin-top: 2px; }

.grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.grid-3 { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px; }

.card {
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 18px 20px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.card-title { font-size: 14px; color: var(--text-secondary); letter-spacing: 1px; }

.gauge { display: flex; flex-direction: column; gap: 8px; }
.gauge-num { font-size: 38px; font-weight: 700; font-variant-numeric: tabular-nums; }
.gauge-num span { font-size: 18px; color: var(--text-secondary); margin-left: 4px; }
.gauge-sub { font-size: 12px; color: var(--text-secondary); }

.big-num {
  font-size: 36px; font-weight: 700; color: var(--text-primary);
}
.big-num.is-ok { color: var(--color-success); }
.big-num.is-warn { color: var(--color-warning); }
.big-num.is-err { color: var(--color-error); }
.big-num span { font-size: 18px; color: var(--text-secondary); margin-left: 2px; }

.gateway-list { display: flex; flex-direction: column; gap: 4px; margin-top: 8px; }
.gw-row { display: flex; justify-content: space-between; align-items: center; padding: 4px 0; border-top: 1px dashed var(--border-soft); font-size: 13px; }
.gw-name { color: var(--text-primary); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }

.level-rows { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.lv-row { display: flex; align-items: center; gap: 8px; font-size: 13px; padding: 2px 0; }
.lv-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
.lv-emergency, .lv-critical { background: var(--color-error); }
.lv-warning { background: var(--color-warning); }
.lv-info { background: var(--color-info); }
.lv-label { color: var(--text-secondary); flex: 1; }
.lv-num { font-weight: 600; font-variant-numeric: tabular-nums; }

@media (max-width: 1100px) {
  .grid-3 { grid-template-columns: 1fr 1fr; }
  .grid-2 { grid-template-columns: 1fr; }
}
</style>
