<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useSystemStore } from '@/stores/system';
import { useDeviceStore } from '@/stores/device';
import { usePermissionStore } from '@/stores/permission';
import { deviceService } from '@/services/device.service';

const sys = useSystemStore();
const deviceStore = useDeviceStore();
const perm = usePermissionStore();

const probing = ref(false);

async function refresh(): Promise<void> {
  try {
    await Promise.all([sys.fetchInfo(), deviceStore.fetchGateways()]);
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
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

const networkConfig = computed(() => ({
  controlNet: '192.168.50.0/24',
  daliGateway: '192.168.50.20',
  ledHost: '192.168.50.30',
  audioHost: '192.168.50.40',
  hvacHost: '192.168.50.50',
}));


function statusTagType(state?: string): string {
  switch (state) {
    case 'online': return 'success';
    case 'reconnecting': return 'warning';
    case 'error':
    case 'offline':
      return 'danger';
    default: return 'info';
  }
}

onMounted(refresh);
</script>

<template>
  <section class="page">
    <header class="bar">
      <div class="sc-subtle">系统参数与健康状态</div>
      <div class="right">
        <el-button @click="refresh">刷新</el-button>
        <el-button type="primary" :disabled="!perm.canExecute" :loading="probing" @click="probe">立即探活</el-button>
      </div>
    </header>

    <el-row :gutter="16">
      <el-col :span="12">
        <div class="card">
          <div class="card-title">中控系统信息</div>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="应用名">{{ sys.info?.app ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="运行环境">{{ sys.info?.env ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="版本">v{{ sys.info?.version ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="Sprint">{{ sys.info?.sprint ?? '—' }}</el-descriptions-item>
            <el-descriptions-item label="Mock 模式">
              <el-tag :type="sys.info?.mockMode ? 'info' : 'success'" size="small">
                {{ sys.info?.mockMode ? '模拟设备 (MOCK_MODE=true)' : '真实设备' }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="API 前缀">{{ sys.info?.apiPrefix ?? '/api' }}</el-descriptions-item>
            <el-descriptions-item label="WebSocket 路径">{{ sys.info?.websocketPath ?? '/ws/status' }}</el-descriptions-item>
            <el-descriptions-item label="WebSocket 状态">
              <el-tag :type="sys.wsState === 'open' ? 'success' : 'warning'" size="small">
                {{ sys.wsState }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="模拟延迟">
              {{ sys.info?.mockLatencyMs ?? '—' }} ms
            </el-descriptions-item>
            <el-descriptions-item label="日志等级">
              info (固定, 修改请编辑服务器 .env 的 LOG_LEVEL)
            </el-descriptions-item>
          </el-descriptions>
        </div>
      </el-col>

      <el-col :span="12">
        <div class="card">
          <div class="card-title">控制网段</div>
          <el-descriptions :column="1" border size="small">
            <el-descriptions-item label="控制网">{{ networkConfig.controlNet }}</el-descriptions-item>
            <el-descriptions-item label="DALI 灯光网关">{{ networkConfig.daliGateway }} :80</el-descriptions-item>
            <el-descriptions-item label="LED 播控主机">{{ networkConfig.ledHost }} :5200</el-descriptions-item>
            <el-descriptions-item label="音响 DSP">{{ networkConfig.audioHost }} :80</el-descriptions-item>
            <el-descriptions-item label="空调 Modbus">{{ networkConfig.hvacHost }} :502</el-descriptions-item>
          </el-descriptions>
          <div class="hint sc-subtle">
            修改网络参数需编辑服务器后端 <code>.env</code> 文件并重启服务，前端只读展示。
          </div>
        </div>
      </el-col>
    </el-row>

    <div class="card">
      <div class="card-title">设备网关健康状态</div>
      <div v-if="deviceStore.gateways.length === 0" class="empty">
        MOCK 模式下不注册真实网关。当 .env 中 MOCK_MODE=false 后，这里会出现 4 个网关 (lighting / led / audio / hvac)。
      </div>
      <el-table v-else :data="deviceStore.gateways" size="small">
        <el-table-column prop="gateway" label="网关" width="220" />
        <el-table-column prop="endpoint" label="端点" min-width="240" />
        <el-table-column label="状态" width="120">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.state)" size="small">{{ row.state }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="attempts" label="失败次数" width="100" />
        <el-table-column label="最后错误" min-width="280">
          <template #default="{ row }">
            <code v-if="row.lastError" class="err">{{ row.lastError }}</code>
            <span v-else class="sc-subtle">—</span>
          </template>
        </el-table-column>
        <el-table-column label="更新时间" width="180">
          <template #default="{ row }">{{ new Date(row.updatedAt).toLocaleString() }}</template>
        </el-table-column>
      </el-table>
    </div>

    <div class="card">
      <div class="card-title">关键 API 端点</div>
      <el-table :data="endpoints" size="small">
        <el-table-column prop="path" label="路径" width="280">
          <template #default="{ row }"><code>{{ row.path }}</code></template>
        </el-table-column>
        <el-table-column prop="desc" label="说明" />
      </el-table>
    </div>
  </section>
</template>

<script lang="ts">
const endpoints = [
  { path: 'GET  /api/system/info', desc: '系统信息（版本/MOCK 模式/WS 路径）' },
  { path: 'GET  /api/system/health', desc: '健康检查（uptime / 数据库连接）' },
  { path: 'GET  /api/system/runtime/gateways', desc: '4 个设备网关连接状态' },
  { path: 'POST /api/system/runtime/health/probe', desc: '立即触发健康探活' },
  { path: 'CRUD /api/devices', desc: '设备台账' },
  { path: 'CRUD /api/scenes + /api/scenes/:id/actions', desc: '场景 / 场景动作' },
  { path: 'POST /api/scenes/:code/execute', desc: '执行场景' },
  { path: 'CRUD /api/scheduler', desc: '定时任务 (cron 触发)' },
  { path: 'CRUD /api/users', desc: '用户与角色 (Sprint-06)' },
  { path: 'GET  /api/logs', desc: '操作日志' },
  { path: 'WS   /ws/status', desc: '实时设备/场景/报警推送' },
];
</script>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.bar { display: flex; justify-content: space-between; align-items: center; }
.bar .right { display: flex; gap: 10px; }
.card {
  background: var(--bg-panel);
  border-radius: 12px;
  padding: 16px 18px;
  border: 1px solid var(--border-soft);
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.card-title { font-size: 15px; font-weight: 600; }
.hint { font-size: 12px; margin-top: 4px; }
.empty {
  padding: 16px;
  color: var(--text-secondary);
  font-size: 14px;
  background: var(--bg-elevated);
  border-radius: 8px;
}
.err {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  color: var(--color-error);
}
code {
  background: var(--bg-elevated);
  padding: 1px 6px;
  border-radius: 4px;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
}
</style>
