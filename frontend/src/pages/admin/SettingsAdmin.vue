<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import {
  Settings, RefreshCw, Activity, Database, Cpu, HardDrive, Clock,
  GitBranch, Server, AlertTriangle, CloudDownload, RotateCcw,
  XCircle, Loader, Beaker, Bug, Network,
} from 'lucide-vue-next';
import { useSystemStore } from '@/stores/system';
import { useDeviceStore } from '@/stores/device';
import { usePermissionStore } from '@/stores/permission';
import { deviceService } from '@/services/device.service';
import {
  adminMonitorService,
  adminBackupService,
  type BackupItem,
} from '@/services/admin.service';
import type { SystemResources } from '@/types/api';

const sys = useSystemStore();
const deviceStore = useDeviceStore();
const perm = usePermissionStore();

const probing = ref(false);
const backingUp = ref(false);
const restoring = ref(false);
const resources = ref<SystemResources | null>(null);
const backups = ref<BackupItem[]>([]);

async function refresh(): Promise<void> {
  try {
    await Promise.all([
      sys.fetchInfo(),
      deviceStore.fetchGateways(),
      loadResources(),
      loadBackups(),
    ]);
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  }
}

async function loadResources(): Promise<void> {
  try {
    resources.value = await adminMonitorService.status();
  } catch {
    /* ignore — endpoint optional */
  }
}

async function loadBackups(): Promise<void> {
  try {
    backups.value = await adminBackupService.list();
  } catch {
    backups.value = [];
  }
}

async function probe(): Promise<void> {
  if (!perm.canExecute) { ElMessage.warning('当前角色无权限'); return; }
  probing.value = true;
  try {
    await deviceService.triggerHealthProbe();
    await deviceStore.fetchGateways();
    ElMessage.success('健康检查已触发');
  } catch (err) {
    ElMessage.error('触发失败: ' + (err as Error).message);
  } finally {
    probing.value = false;
  }
}

async function backupNow(): Promise<void> {
  if (!perm.canExecute) { ElMessage.warning('当前角色无权限'); return; }
  backingUp.value = true;
  try {
    const r = await adminBackupService.create();
    ElMessage.success(`已备份: ${(r.sizeBytes / 1024).toFixed(1)} KB`);
    await loadBackups();
  } catch (err) {
    ElMessage.error('备份失败: ' + (err as Error).message);
  } finally {
    backingUp.value = false;
  }
}

async function restoreSimulate(item?: BackupItem): Promise<void> {
  if (!perm.canExecute) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await ElMessageBox.confirm(
      `即将模拟恢复 ${item?.name ?? '最新快照'}。\n\n注: 该操作仅返回会执行的步骤, 不会真正覆盖数据库 (生产恢复请走 deploy/scripts/restore.ps1)。`,
      '恢复确认',
      { type: 'warning', confirmButtonText: '模拟执行', cancelButtonText: '取消' },
    );
    restoring.value = true;
    const r = await adminBackupService.restore(item?.name);
    ElMessage.success(`模拟恢复: ${r.selected ?? '无可用快照'}`);
  } catch (err) {
    if ((err as Error).message !== 'cancel') {
      ElMessage.error('恢复失败: ' + (err as Error).message);
    }
  } finally {
    restoring.value = false;
  }
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function fmtUptime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${Math.floor(sec % 60)}s`;
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}

function statusTagCls(state?: string): string {
  switch (state) {
    case 'online': return 'is-on';
    case 'reconnecting': return 'is-warning';
    case 'error':
    case 'offline':
      return 'is-error';
    default: return 'is-off';
  }
}

const shortCommit = computed(() => sys.info?.commit?.slice(0, 7) ?? null);

const flagItems = computed(() => [
  {
    key: 'mock',
    label: 'MOCK 模式',
    desc: '使用内存模拟设备 — 演示 / 离线开发用',
    icon: Beaker,
    on: sys.info?.mockMode ?? false,
    badge: sys.info?.mockMode ? 'MOCK' : '真实',
    cls: sys.info?.mockMode ? 'is-warning' : 'is-on',
  },
  {
    key: 'test',
    label: 'TEST 模式',
    desc: '测试操作只入 test_logs, 不污染 OperationLog',
    icon: Bug,
    on: sys.info?.testMode ?? false,
    badge: sys.info?.testMode ? '启用' : '关闭',
    cls: sys.info?.testMode ? 'is-warning' : 'is-off',
  },
  {
    key: 'debug',
    label: 'DEBUG 日志',
    desc: '日志等级 = debug, 性能略降, 排障详细',
    icon: Activity,
    on: sys.info?.debug ?? false,
    badge: sys.info?.debug ? '启用' : '关闭',
    cls: sys.info?.debug ? 'is-warning' : 'is-off',
  },
]);

onMounted(refresh);
</script>

<template>
  <section class="page">
    <!-- ============ Hero ============ -->
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><Settings :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">系统设置</h2>
          <div class="sc-subtle">运行模式 · 资源 · 备份 · 危险操作</div>
        </div>
      </div>
      <div class="hero-right">
        <button class="sc-touch sc-act sc-act-neutral hero-btn" @click="refresh">
          <RefreshCw :size="16" :stroke-width="2" /> 刷新
        </button>
      </div>
    </header>

    <!-- ============ 版本 / 运行状态卡 ============ -->
    <div class="info-grid">
      <div class="info-card hero-card">
        <div class="info-label">版本</div>
        <div class="info-value">
          <span class="ver-num">v{{ sys.info?.version ?? '—' }}</span>
          <span class="ver-sprint">{{ sys.info?.sprint ?? '—' }}</span>
        </div>
        <div class="info-foot">
          <span class="info-mono">
            <GitBranch :size="11" :stroke-width="2" />
            {{ shortCommit ?? '本地' }}{{ sys.info?.ref ? '·' + sys.info.ref : '' }}
          </span>
          <span v-if="sys.info?.buildTime" class="info-mono">
            <Clock :size="11" :stroke-width="2" />
            {{ fmtTime(sys.info.buildTime) }}
          </span>
        </div>
      </div>

      <div class="info-card">
        <div class="info-label">环境</div>
        <div class="info-value">
          <span class="env-tag" :class="sys.info?.env === 'production' ? 'is-prod' : 'is-dev'">
            {{ sys.info?.env ?? '—' }}
          </span>
        </div>
        <div class="info-foot">
          <span class="info-mono">
            <Server :size="11" :stroke-width="2" />
            {{ sys.info?.host ?? sys.info?.hostMachine ?? '—' }}
          </span>
        </div>
      </div>

      <div class="info-card">
        <div class="info-label">运行时</div>
        <div class="info-value">
          <span class="ver-num">{{ sys.info?.nodeVersion ?? '—' }}</span>
        </div>
        <div class="info-foot">
          <span class="info-mono">
            <Cpu :size="11" :stroke-width="2" />
            {{ sys.info?.platform ?? '—' }}
          </span>
          <span v-if="resources?.uptime" class="info-mono">
            <Clock :size="11" :stroke-width="2" />
            {{ fmtUptime(resources.uptime.processSec) }}
          </span>
        </div>
      </div>

      <div class="info-card">
        <div class="info-label">WebSocket</div>
        <div class="info-value">
          <span class="sc-status" :class="sys.wsState === 'open' ? 'is-on' : 'is-error'">
            <span class="sc-status-dot" />
            {{ sys.wsState }}
          </span>
        </div>
        <div class="info-foot">
          <span class="info-mono">
            <Network :size="11" :stroke-width="2" />
            {{ sys.info?.websocketPath ?? '/ws/status' }}
          </span>
        </div>
      </div>
    </div>

    <!-- ============ 运行模式 + 网关健康 ============ -->
    <div class="grid-2">
      <!-- 运行模式 -->
      <div class="sc-panel section">
        <div class="section-head">
          <div class="section-title">
            <Settings :size="16" :stroke-width="1.75" /> 运行模式
          </div>
          <span class="sc-subtle">需在服务器 .env 修改 · 重启生效</span>
        </div>
        <div class="flags">
          <div v-for="f in flagItems" :key="f.key" class="flag-row">
            <component :is="f.icon" class="flag-ico" :size="22" :stroke-width="1.75" />
            <div class="flag-body">
              <div class="flag-label">{{ f.label }}</div>
              <div class="flag-desc">{{ f.desc }}</div>
            </div>
            <span class="sc-status" :class="f.cls">
              <span class="sc-status-dot" />
              {{ f.badge }}
            </span>
          </div>
        </div>
      </div>

      <!-- 网关健康 -->
      <div class="sc-panel section">
        <div class="section-head">
          <div class="section-title">
            <Activity :size="16" :stroke-width="1.75" /> 设备网关健康
          </div>
          <button
            class="sc-touch sc-act sc-act-primary section-btn"
            :disabled="!perm.canExecute || probing"
            @click="probe"
          >
            <Loader v-if="probing" :size="14" class="spin" :stroke-width="2" />
            <Activity v-else :size="14" :stroke-width="2" />
            立即探活
          </button>
        </div>
        <div v-if="deviceStore.gateways.length === 0" class="empty">
          <Beaker :size="18" :stroke-width="1.5" />
          <div>
            MOCK 模式下不注册真实网关。<br />
            <code>.env</code> 中 <code>MOCK_MODE=false</code> 后, 这里会出现 4 个网关
            (lighting / led / audio / hvac)。
          </div>
        </div>
        <div v-else class="gw-list">
          <div v-for="g in deviceStore.gateways" :key="g.gateway" class="gw-row">
            <div class="gw-body">
              <div class="gw-name">{{ g.gateway }}</div>
              <div class="gw-endpoint">{{ g.endpoint }}</div>
              <div v-if="g.lastError" class="gw-err">
                <XCircle :size="11" :stroke-width="2" /> {{ g.lastError }}
              </div>
            </div>
            <div class="gw-meta">
              <span class="sc-status" :class="statusTagCls(g.state)">
                <span class="sc-status-dot" /> {{ g.state }}
              </span>
              <span v-if="g.attempts > 0" class="gw-fail">失败 {{ g.attempts }} 次</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ============ 系统资源 ============ -->
    <div class="sc-panel section">
      <div class="section-head">
        <div class="section-title">
          <Cpu :size="16" :stroke-width="1.75" /> 系统资源
        </div>
        <span class="sc-subtle">
          <span v-if="resources?.timestamp">采样: {{ fmtTime(resources.timestamp) }}</span>
        </span>
      </div>
      <div v-if="resources" class="res-grid">
        <div class="res-cell">
          <div class="res-label"><Cpu :size="12" :stroke-width="2" /> CPU</div>
          <div class="res-value">{{ resources.cpu.usagePercent.toFixed(1) }}%</div>
          <div class="res-bar"><div class="res-fill is-cpu" :style="{ width: Math.min(100, resources.cpu.usagePercent) + '%' }" /></div>
          <div class="res-sub">{{ resources.cpu.cores }} 核 · load1m {{ resources.cpu.loadAvg1m.toFixed(2) }}</div>
        </div>
        <div class="res-cell">
          <div class="res-label"><Activity :size="12" :stroke-width="2" /> 内存</div>
          <div class="res-value">{{ resources.memory.usagePercent.toFixed(1) }}%</div>
          <div class="res-bar"><div class="res-fill is-mem" :style="{ width: Math.min(100, resources.memory.usagePercent) + '%' }" /></div>
          <div class="res-sub">{{ resources.memory.usedMb }} / {{ resources.memory.totalMb }} MB</div>
        </div>
        <div class="res-cell">
          <div class="res-label"><HardDrive :size="12" :stroke-width="2" /> 磁盘</div>
          <div class="res-value">{{ resources.disk.usagePercent.toFixed(1) }}%</div>
          <div class="res-bar"><div class="res-fill is-disk" :style="{ width: Math.min(100, resources.disk.usagePercent) + '%' }" /></div>
          <div class="res-sub">{{ resources.disk.usedGb.toFixed(1) }} / {{ resources.disk.totalGb.toFixed(0) }} GB</div>
        </div>
        <div class="res-cell">
          <div class="res-label"><Clock :size="12" :stroke-width="2" /> 进程运行</div>
          <div class="res-value">{{ fmtUptime(resources.uptime.processSec) }}</div>
          <div class="res-sub">系统运行 {{ fmtUptime(resources.uptime.osSec) }}</div>
          <div class="res-sub">PID {{ resources.pid }}</div>
        </div>
      </div>
      <div v-else class="empty">
        <Loader :size="18" class="spin" :stroke-width="2" /> 加载中...
      </div>
    </div>

    <!-- ============ 备份与恢复 ============ -->
    <div class="sc-panel section">
      <div class="section-head">
        <div class="section-title">
          <Database :size="16" :stroke-width="1.75" /> 数据库备份与恢复
        </div>
        <button
          class="sc-touch sc-act sc-act-primary section-btn"
          :disabled="!perm.canExecute || backingUp"
          @click="backupNow"
        >
          <Loader v-if="backingUp" :size="14" class="spin" :stroke-width="2" />
          <CloudDownload v-else :size="14" :stroke-width="2" />
          立即备份
        </button>
      </div>
      <div v-if="backups.length === 0" class="empty">
        <Database :size="18" :stroke-width="1.5" />
        <div>还没有备份快照。点击右上角「立即备份」生成第一份。</div>
      </div>
      <div v-else class="backup-list">
        <div v-for="(b, i) in backups.slice(0, 8)" :key="b.name" class="backup-row">
          <div class="backup-num">{{ i + 1 }}</div>
          <div class="backup-body">
            <div class="backup-name">{{ b.name }}</div>
            <div class="backup-meta">
              <span class="info-mono">{{ fmtBytes(b.sizeBytes) }}</span>
              <span class="sc-subtle">·</span>
              <span>{{ fmtTime(b.createdAt) }}</span>
            </div>
          </div>
          <button
            class="row-btn"
            :disabled="!perm.canExecute || restoring"
            @click="restoreSimulate(b)"
          >
            <RotateCcw :size="13" :stroke-width="2" /> 模拟恢复
          </button>
        </div>
        <div v-if="backups.length > 8" class="more-hint">
          还有 {{ backups.length - 8 }} 份较旧备份 (生产环境 deploy/scripts/restore.ps1 可访问全部)
        </div>
      </div>
    </div>

    <!-- ============ 危险操作 ============ -->
    <div class="sc-panel section danger-zone">
      <div class="section-head">
        <div class="section-title danger">
          <AlertTriangle :size="16" :stroke-width="2" /> 危险操作
        </div>
        <span class="sc-subtle">需运维授权 · 操作会影响线上服务</span>
      </div>
      <div class="danger-rows">
        <div class="danger-row">
          <div class="danger-body">
            <div class="danger-name">重启后端服务</div>
            <div class="danger-desc">通过 PM2 重新加载进程, 短暂 (≤5 秒) 不可用</div>
          </div>
          <span class="sc-subtle danger-cmd">
            <code>pm2 reload smart-control-backend</code>
          </span>
        </div>
        <div class="danger-row">
          <div class="danger-body">
            <div class="danger-name">真实恢复数据库</div>
            <div class="danger-desc">线上恢复请走服务器 PowerShell, 本页只提供模拟</div>
          </div>
          <span class="sc-subtle danger-cmd">
            <code>deploy\scripts\restore.ps1 -Snapshot &lt;name&gt; -Force</code>
          </span>
        </div>
        <div class="danger-row">
          <div class="danger-body">
            <div class="danger-name">切换 MOCK / 真实模式</div>
            <div class="danger-desc">编辑 backend/.env 的 MOCK_MODE 后重启服务生效</div>
          </div>
          <span class="sc-subtle danger-cmd">
            <code>pm2 reload smart-control-backend --update-env</code>
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }

.hero {
  display: flex; align-items: center; justify-content: space-between;
}
.hero-left { display: flex; align-items: center; gap: 14px; }
.hero-right { display: flex; gap: 10px; }
.hero-btn { min-height: 42px; padding: 0 16px; }

/* ===== 顶部 4 张状态卡 ===== */
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
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #3b82f6 0%, #7c3aed 80%, transparent 100%);
}
.info-card.hero-card::before {
  background: linear-gradient(90deg, #10b981 0%, #3b82f6 50%, #7c3aed 100%);
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
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
}
.ver-sprint {
  font-size: 12px;
  color: var(--text-secondary);
  padding: 2px 8px;
  border-radius: 999px;
  background: var(--bg-elevated);
  font-weight: 500;
  letter-spacing: 0.5px;
}
.env-tag {
  font-size: 14px;
  padding: 4px 12px;
  border-radius: 999px;
  font-weight: 600;
  letter-spacing: 1px;
}
.env-tag.is-prod {
  background: rgba(16, 185, 129, 0.14);
  color: #34d399;
  border: 1px solid rgba(16, 185, 129, 0.32);
}
.env-tag.is-dev {
  background: rgba(245, 158, 11, 0.14);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.32);
}

.info-foot {
  display: flex; flex-wrap: wrap; gap: 10px;
  margin-top: 6px;
}
.info-mono {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-secondary);
}

/* ===== Section panel ===== */
.section { display: flex; flex-direction: column; gap: 14px; }
.section-head {
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
}
.section-title {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 15px; font-weight: 600;
}
.section-title.danger { color: #fbbf24; }
.section-btn { min-height: 36px; padding: 0 14px; font-size: 13px; }
.grid-2 {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
}

/* ===== 运行模式 ===== */
.flags { display: flex; flex-direction: column; gap: 8px; }
.flag-row {
  display: flex; align-items: center; gap: 14px;
  padding: 12px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
}
.flag-ico { color: #93c5fd; flex-shrink: 0; }
.flag-body { flex: 1; min-width: 0; }
.flag-label { font-weight: 600; font-size: 14px; }
.flag-desc { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }

/* ===== 网关健康 ===== */
.gw-list { display: flex; flex-direction: column; gap: 8px; }
.gw-row {
  display: flex; align-items: flex-start; gap: 12px; justify-content: space-between;
  padding: 12px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
}
.gw-body { flex: 1; min-width: 0; }
.gw-name { font-weight: 600; font-size: 14px; }
.gw-endpoint {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.gw-err {
  font-size: 12px;
  color: #f87171;
  display: inline-flex; align-items: center; gap: 4px;
  margin-top: 4px;
}
.gw-meta { text-align: right; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.gw-fail { font-size: 11px; color: var(--text-secondary); }

/* ===== 系统资源 ===== */
.res-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.res-cell {
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: 12px;
  padding: 14px 16px;
}
.res-label {
  font-size: 11px; color: var(--text-secondary);
  letter-spacing: 1px; text-transform: uppercase;
  display: inline-flex; align-items: center; gap: 4px;
}
.res-value {
  font-size: 26px; font-weight: 700;
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  margin: 6px 0;
  font-variant-numeric: tabular-nums;
}
.res-bar {
  height: 6px;
  background: var(--bg-panel);
  border-radius: 3px;
  overflow: hidden;
}
.res-fill {
  height: 100%;
  transition: width 0.4s ease;
  border-radius: 3px;
}
.res-fill.is-cpu  { background: linear-gradient(90deg, #10b981, #06b6d4); }
.res-fill.is-mem  { background: linear-gradient(90deg, #3b82f6, #7c3aed); }
.res-fill.is-disk { background: linear-gradient(90deg, #f59e0b, #ef4444); }
.res-sub {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 5px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}

/* ===== 备份列表 ===== */
.backup-list { display: flex; flex-direction: column; gap: 6px; }
.backup-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
}
.backup-num {
  width: 28px; height: 28px;
  display: flex; align-items: center; justify-content: center;
  background: rgba(59, 130, 246, 0.18);
  border: 1px solid rgba(59, 130, 246, 0.3);
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #93c5fd;
  flex-shrink: 0;
}
.backup-body { flex: 1; min-width: 0; }
.backup-name {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 13px;
  font-weight: 600;
}
.backup-meta {
  display: flex; gap: 6px; align-items: center;
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 2px;
}
.row-btn {
  background: var(--bg-panel);
  color: var(--text-secondary);
  border: 1px solid var(--border-soft);
  border-radius: 8px;
  padding: 6px 12px;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  font-family: inherit;
  touch-action: manipulation;
  transition: all 0.15s;
}
.row-btn:hover:not(:disabled) {
  color: #c7d2fe;
  border-color: rgba(99, 102, 241, 0.5);
}
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }
.more-hint { font-size: 12px; color: var(--text-secondary); padding: 6px 4px; }

/* ===== 危险操作 ===== */
.danger-zone {
  border-color: rgba(245, 158, 11, 0.32);
  background:
    linear-gradient(180deg, rgba(245, 158, 11, 0.06) 0%, transparent 60%),
    var(--bg-panel);
}
.danger-rows { display: flex; flex-direction: column; gap: 6px; }
.danger-row {
  display: flex; align-items: center; justify-content: space-between; gap: 14px;
  padding: 10px 14px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
}
.danger-body { flex: 1; min-width: 0; }
.danger-name { font-weight: 600; font-size: 14px; }
.danger-desc { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.danger-cmd code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: #fbbf24;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.22);
  padding: 3px 8px;
  border-radius: 6px;
  white-space: nowrap;
}

/* ===== Empty state ===== */
.empty {
  padding: 22px 18px;
  color: var(--text-secondary);
  font-size: 13px;
  background: var(--bg-elevated);
  border: 1px dashed var(--border-soft);
  border-radius: 10px;
  display: flex; align-items: center; gap: 12px;
}
.empty code {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  background: var(--bg-panel);
  padding: 1px 6px;
  border-radius: 4px;
  color: #93c5fd;
}

/* ===== Loader 旋转 ===== */
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1280px) {
  .info-grid { grid-template-columns: repeat(2, 1fr); }
  .grid-2 { grid-template-columns: 1fr; }
  .res-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
