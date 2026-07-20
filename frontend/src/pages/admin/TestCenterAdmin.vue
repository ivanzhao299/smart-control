<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import {
  adminDeviceService,
  adminSceneService,
  adminTestService,
} from '@/services/admin.service';
import { TestTube2, CheckCircle2, XCircle } from 'lucide-vue-next';
import type { Device, SceneSummary, TestLog } from '@/types/api';

const activeTab = ref<'device' | 'subsystem' | 'scene' | 'network' | 'logs' | 'report'>('device');

const devices = ref<Device[]>([]);
const scenes = ref<SceneSummary[]>([]);

onMounted(async () => {
  try {
    const [d, s] = await Promise.all([adminDeviceService.list(), adminSceneService.list()]);
    devices.value = d.list;
    scenes.value = s.list;
  } catch {
    // ignore
  }
  void refreshLogs();
});

/* ---------- 单设备 ---------- */
const dev = reactive({
  deviceId: '',
  command: '',
  paramsRaw: '{}',
  loading: false,
  result: null as null | { success: boolean; durationMs: number; data?: unknown; error?: string; command: string },
});

const cmdSuggestions: Record<string, string[]> = {
  lighting: ['turnOn', 'turnOff', 'setBrightness', 'getStatus'],
  led: ['powerOn', 'powerOff', 'switchInput', 'playMedia', 'showWelcome', 'getStatus'],
  audio: ['setVolume', 'mute', 'unmute', 'playBgm', 'stopBgm'],
  hvac: ['turnOn', 'turnOff', 'setTemperature', 'setMode', 'setFanSpeed', 'getStatus'],
  power: ['turnOn', 'turnOff', 'getStatus'],
};

const selectedDeviceCategory = computed(() => {
  const d = devices.value.find((x) => x.name === dev.deviceId);
  return d?.category ?? '';
});

async function runDeviceTest(): Promise<void> {
  if (!dev.deviceId || !dev.command) { ElMessage.warning('请选择设备并填命令'); return; }
  let params: Record<string, unknown> = {};
  try {
    params = dev.paramsRaw.trim() ? JSON.parse(dev.paramsRaw) : {};
  } catch {
    ElMessage.error('参数 JSON 格式不合法'); return;
  }
  dev.loading = true;
  dev.result = null;
  try {
    const r = await adminTestService.device(dev.deviceId, dev.command, params);
    dev.result = { success: r.success, durationMs: r.durationMs, data: r.result, error: r.error, command: r.command };
    ElMessage[r.success ? 'success' : 'error'](r.success ? '测试成功' : `测试失败: ${r.error ?? ''}`);
    void refreshLogs();
  } catch (err) {
    ElMessage.error('请求失败: ' + (err as Error).message);
  } finally {
    dev.loading = false;
  }
}

/* ---------- 子系统 ---------- */
const sub = reactive({
  type: 'lighting' as 'lighting' | 'led' | 'audio' | 'hvac' | 'power',
  command: '',
  paramsRaw: '{}',
  loading: false,
  result: null as null | { success: boolean; total: number; ok: number; fail: number; devices: Array<{ deviceId: string; success: boolean; error?: string; durationMs: number }>; durationMs: number },
});

async function runSubsystemTest(): Promise<void> {
  let params: Record<string, unknown> = {};
  try {
    params = sub.paramsRaw.trim() ? JSON.parse(sub.paramsRaw) : {};
  } catch {
    ElMessage.error('参数 JSON 格式不合法'); return;
  }
  sub.loading = true;
  sub.result = null;
  try {
    const r = await adminTestService.subsystem(sub.type, sub.command || undefined, params);
    sub.result = {
      success: r.success,
      total: r.totalDevices,
      ok: r.succeededCount,
      fail: r.failedCount,
      durationMs: r.durationMs,
      devices: r.devices.map((d) => ({ deviceId: d.deviceId, success: d.success, error: d.error, durationMs: d.durationMs })),
    };
    ElMessage[r.success ? 'success' : 'warning'](`完成: ${r.succeededCount}/${r.totalDevices} 成功`);
    void refreshLogs();
  } catch (err) {
    ElMessage.error('请求失败: ' + (err as Error).message);
  } finally {
    sub.loading = false;
  }
}

/* ---------- 场景 ---------- */
const sc = reactive({
  sceneCode: '',
  dryRun: true,
  loading: false,
  result: null as null | { success: boolean; total: number; ok: number; fail: number; durationMs: number; actions: Array<{ deviceType: string; deviceId: string; command: string; success: boolean; error?: string; durationMs: number }> },
});

async function runSceneTest(): Promise<void> {
  if (!sc.sceneCode) { ElMessage.warning('请选择场景'); return; }
  sc.loading = true;
  sc.result = null;
  try {
    const r = await adminTestService.scene(sc.sceneCode, sc.dryRun);
    sc.result = {
      success: r.success,
      total: r.totalActions,
      ok: r.succeededCount,
      fail: r.failedCount,
      durationMs: r.durationMs,
      actions: r.actionResults.map((a) => ({
        deviceType: a.deviceType,
        deviceId: a.deviceId,
        command: a.command,
        success: a.success,
        error: a.error,
        durationMs: a.durationMs,
      })),
    };
    ElMessage[r.success ? 'success' : 'warning'](`${sc.dryRun ? '空跑' : '实际'}测试: ${r.succeededCount}/${r.totalActions} 成功`);
    void refreshLogs();
  } catch (err) {
    ElMessage.error('请求失败: ' + (err as Error).message);
  } finally {
    sc.loading = false;
  }
}

/* ---------- 网络 ---------- */
const net = reactive({
  ip: '192.168.50.20',
  port: 80,
  pingResult: null as null | { reachable: boolean; latencyMs: number | null; error?: string },
  portResult: null as null | { open: boolean; latencyMs: number | null; error?: string },
  pingLoading: false,
  portLoading: false,
});

async function runPing(): Promise<void> {
  net.pingLoading = true;
  net.pingResult = null;
  try {
    const r = await adminTestService.ping(net.ip);
    net.pingResult = { reachable: r.reachable, latencyMs: r.latencyMs, error: r.error };
    ElMessage[r.reachable ? 'success' : 'error'](r.reachable ? `可达 ${r.latencyMs}ms` : `不可达: ${r.error ?? ''}`);
    void refreshLogs();
  } catch (err) {
    ElMessage.error('请求失败: ' + (err as Error).message);
  } finally {
    net.pingLoading = false;
  }
}

async function runPort(): Promise<void> {
  net.portLoading = true;
  net.portResult = null;
  try {
    const r = await adminTestService.port(net.ip, net.port);
    net.portResult = { open: r.open, latencyMs: r.latencyMs, error: r.error };
    ElMessage[r.open ? 'success' : 'error'](r.open ? `端口开放 ${r.latencyMs}ms` : `不通: ${r.error ?? ''}`);
    void refreshLogs();
  } catch (err) {
    ElMessage.error('请求失败: ' + (err as Error).message);
  } finally {
    net.portLoading = false;
  }
}

/* ---------- 日志 ---------- */
const logs = ref<TestLog[]>([]);
const logFilter = reactive({ testType: '', success: undefined as undefined | boolean });
async function refreshLogs(): Promise<void> {
  try {
    const r = await adminTestService.logs({
      testType: logFilter.testType || undefined,
      success: logFilter.success,
      pageSize: 80,
    });
    logs.value = r.list;
  } catch {
    // ignore
  }
}

/* ---------- 报告 ---------- */
const report = ref<null | { total: number; ok: number; fail: number; avg: number; byType: Record<string, { total: number; succeeded: number; failed: number }>; failures: Array<{ targetId: string; testType: string; error: string }> }>(null);
const reportLoading = ref(false);
async function genReport(): Promise<void> {
  reportLoading.value = true;
  try {
    const r = await adminTestService.report({});
    report.value = {
      total: r.totalTests,
      ok: r.succeededCount,
      fail: r.failedCount,
      avg: r.avgDurationMs,
      byType: r.byTestType,
      failures: r.failures,
    };
    ElMessage.success('报告已生成');
  } catch (err) {
    ElMessage.error('生成失败: ' + (err as Error).message);
  } finally {
    reportLoading.value = false;
  }
}

function fmtTime(s: string): string {
  return new Date(s).toLocaleString();
}
</script>

<template>
  <section class="page">
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><TestTube2 :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">测试中心</h2>
          <div class="sc-subtle">单设备 / 子系统 / 场景 dryRun / 网络 ping / TCP 端口 / 测试日志</div>
        </div>
      </div>
    </header>

    <el-tabs v-model="activeTab" class="tabs">
      <!-- ============= 单设备 ============= -->
      <el-tab-pane label="单设备测试" name="device">
        <div class="form-grid">
          <div class="col">
            <label>设备</label>
            <el-select v-model="dev.deviceId" filterable placeholder="选择设备" style="width: 100%;">
              <el-option v-for="d in devices" :key="d.id" :label="`${d.name} (${d.category})`" :value="d.name" />
            </el-select>
          </div>
          <div class="col">
            <label>命令</label>
            <el-select v-model="dev.command" filterable allow-create placeholder="getStatus / turnOn / ..." style="width: 100%;">
              <el-option v-for="c in cmdSuggestions[selectedDeviceCategory] ?? []" :key="c" :label="c" :value="c" />
            </el-select>
          </div>
          <div class="col span-2">
            <label>参数 (JSON)</label>
            <el-input v-model="dev.paramsRaw" type="textarea" :rows="2" placeholder='{"value":80}' />
          </div>
          <div class="col span-2">
            <el-button type="primary" :loading="dev.loading" @click="runDeviceTest">▶ 测试</el-button>
          </div>
        </div>
        <div v-if="dev.result" class="result-card" :class="dev.result.success ? 'ok' : 'fail'">
          <div class="result-head">
            <span class="result-icon">{{ dev.result.success ? '✓' : '✖' }}</span>
            <span class="result-text">{{ dev.result.success ? '测试成功' : `测试失败: ${dev.result.error}` }}</span>
            <span class="result-time">{{ dev.result.durationMs }}ms</span>
          </div>
          <pre v-if="dev.result.data" class="result-data">{{ JSON.stringify(dev.result.data, null, 2) }}</pre>
        </div>
      </el-tab-pane>

      <!-- ============= 子系统 ============= -->
      <el-tab-pane label="子系统测试" name="subsystem">
        <div class="form-grid">
          <div class="col">
            <label>子系统</label>
            <el-select v-model="sub.type" style="width: 100%;">
              <el-option label="灯光 (lighting)" value="lighting" />
              <el-option label="LED (led)" value="led" />
              <el-option label="音响 (audio)" value="audio" />
              <el-option label="空调 (hvac)" value="hvac" />
              <el-option label="电源 (power)" value="power" />
            </el-select>
          </div>
          <div class="col">
            <label>命令 (留空用默认 getStatus)</label>
            <el-input v-model="sub.command" placeholder="可选" />
          </div>
          <div class="col span-2">
            <label>参数 (JSON)</label>
            <el-input v-model="sub.paramsRaw" type="textarea" :rows="2" placeholder='{}' />
          </div>
          <div class="col span-2">
            <el-button type="primary" :loading="sub.loading" @click="runSubsystemTest">▶ 批量测试</el-button>
          </div>
        </div>
        <div v-if="sub.result" class="result-card" :class="sub.result.success ? 'ok' : 'fail'">
          <div class="result-head">
            <span class="result-icon">{{ sub.result.success ? '✓' : '⚠' }}</span>
            <span class="result-text">成功 {{ sub.result.ok }} / 失败 {{ sub.result.fail }} / 总 {{ sub.result.total }}</span>
            <span class="result-time">{{ sub.result.durationMs }}ms</span>
          </div>
          <el-table :data="sub.result.devices" size="small" stripe>
            <el-table-column prop="deviceId" label="设备" />
            <el-table-column label="状态" width="100">
              <template #default="{ row }">
                <span class="sc-status" :class="row.success ? 'is-on' : 'is-error'">
                  <component :is="row.success ? CheckCircle2 : XCircle" :size="12" :stroke-width="2" />
                  {{ row.success ? '成功' : '失败' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="durationMs" label="耗时(ms)" width="100" />
            <el-table-column label="错误" min-width="200">
              <template #default="{ row }">
                <span v-if="row.error" class="err">{{ row.error }}</span>
                <span v-else class="sc-subtle">—</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ============= 场景 ============= -->
      <el-tab-pane label="场景测试" name="scene">
        <div class="form-grid">
          <div class="col">
            <label>场景</label>
            <el-select v-model="sc.sceneCode" filterable style="width: 100%;">
              <el-option v-for="s in scenes" :key="s.code" :label="`${s.name} (${s.code})`" :value="s.code" />
            </el-select>
          </div>
          <div class="col">
            <label>模式</label>
            <el-switch v-model="sc.dryRun" active-text="dryRun (空跑, 不下发指令)" />
          </div>
          <div class="col span-2">
            <el-button type="primary" :loading="sc.loading" @click="runSceneTest">▶ 测试场景</el-button>
            <span class="sc-subtle" style="margin-left: 12px;">注: 测试结果写入 test_logs, 不影响正式 OperationLog</span>
          </div>
        </div>
        <div v-if="sc.result" class="result-card" :class="sc.result.success ? 'ok' : 'fail'">
          <div class="result-head">
            <span class="result-icon">{{ sc.result.success ? '✓' : '⚠' }}</span>
            <span class="result-text">成功 {{ sc.result.ok }} / 失败 {{ sc.result.fail }} / 总 {{ sc.result.total }}</span>
            <span class="result-time">{{ sc.result.durationMs }}ms</span>
          </div>
          <el-table :data="sc.result.actions" size="small" stripe>
            <el-table-column label="动作" min-width="280">
              <template #default="{ row }">
                <code>{{ row.deviceType }}.{{ row.command }}</code> on
                <code>{{ row.deviceId }}</code>
              </template>
            </el-table-column>
            <el-table-column label="结果" width="80">
              <template #default="{ row }">
                <span class="sc-status" :class="row.success ? 'is-on' : 'is-error'">
                  <component :is="row.success ? CheckCircle2 : XCircle" :size="12" :stroke-width="2" />
                  {{ row.success ? '成功' : '失败' }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="durationMs" label="耗时" width="100" />
            <el-table-column label="错误" min-width="180">
              <template #default="{ row }">
                <span v-if="row.error" class="err">{{ row.error }}</span>
                <span v-else class="sc-subtle">—</span>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>

      <!-- ============= 网络 ============= -->
      <el-tab-pane label="网络连通" name="network">
        <div class="form-grid">
          <div class="col">
            <label>IP</label>
            <el-input v-model="net.ip" placeholder="192.168.50.20" />
          </div>
          <div class="col">
            <label>端口</label>
            <el-input-number v-model="net.port" :min="1" :max="65535" />
          </div>
          <div class="col span-2 row-btn">
            <el-button type="primary" :loading="net.pingLoading" @click="runPing">▶ Ping</el-button>
            <el-button type="primary" :loading="net.portLoading" @click="runPort">▶ TCP 端口</el-button>
          </div>
        </div>
        <div class="net-grid">
          <div v-if="net.pingResult" class="result-card" :class="net.pingResult.reachable ? 'ok' : 'fail'">
            <div class="result-head">
              <span class="result-icon">{{ net.pingResult.reachable ? '✓' : '✖' }}</span>
              <span class="result-text">Ping {{ net.ip }}: {{ net.pingResult.reachable ? `${net.pingResult.latencyMs}ms` : '不可达' }}</span>
            </div>
            <div v-if="net.pingResult.error" class="err">{{ net.pingResult.error }}</div>
          </div>
          <div v-if="net.portResult" class="result-card" :class="net.portResult.open ? 'ok' : 'fail'">
            <div class="result-head">
              <span class="result-icon">{{ net.portResult.open ? '✓' : '✖' }}</span>
              <span class="result-text">{{ net.ip }}:{{ net.port }} {{ net.portResult.open ? `开放 ${net.portResult.latencyMs}ms` : '不通' }}</span>
            </div>
            <div v-if="net.portResult.error" class="err">{{ net.portResult.error }}</div>
          </div>
        </div>
      </el-tab-pane>

      <!-- ============= 日志 ============= -->
      <el-tab-pane :label="`测试日志 (${logs.length})`" name="logs">
        <div class="filters">
          <el-select v-model="logFilter.testType" placeholder="类型" clearable style="width: 160px;">
            <el-option label="device" value="device" />
            <el-option label="subsystem" value="subsystem" />
            <el-option label="scene" value="scene" />
            <el-option label="network_ping" value="network_ping" />
            <el-option label="network_port" value="network_port" />
          </el-select>
          <el-select v-model="logFilter.success" placeholder="成功/失败" clearable style="width: 140px;">
            <el-option label="成功" :value="true" />
            <el-option label="失败" :value="false" />
          </el-select>
          <el-button @click="refreshLogs">查询</el-button>
        </div>
        <el-table :data="logs" size="small" stripe>
          <el-table-column label="时间" width="170">
            <template #default="{ row }">{{ fmtTime(row.createdAt) }}</template>
          </el-table-column>
          <el-table-column prop="testType" label="类型" width="120" />
          <el-table-column prop="targetType" label="目标类型" width="120" />
          <el-table-column prop="targetId" label="目标" min-width="160" />
          <el-table-column prop="command" label="命令" width="140" />
          <el-table-column label="结果" width="80">
            <template #default="{ row }">
              <el-tag :type="row.success ? 'success' : 'danger'" size="small">{{ row.success ? '✓' : '✖' }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="durationMs" label="耗时(ms)" width="100" />
        </el-table>
      </el-tab-pane>

      <!-- ============= 报告 ============= -->
      <el-tab-pane label="测试报告" name="report">
        <div class="form-grid">
          <div class="col span-2">
            <el-button type="primary" :loading="reportLoading" @click="genReport">▶ 生成最近 24 小时报告</el-button>
          </div>
        </div>
        <div v-if="report" class="report-card">
          <div class="report-stats">
            <div class="stat"><div class="num">{{ report.total }}</div><div class="lbl">总测试</div></div>
            <div class="stat ok"><div class="num">{{ report.ok }}</div><div class="lbl">成功</div></div>
            <div class="stat fail"><div class="num">{{ report.fail }}</div><div class="lbl">失败</div></div>
            <div class="stat"><div class="num">{{ report.avg }}<span>ms</span></div><div class="lbl">平均耗时</div></div>
          </div>
          <div class="card-title">按测试类型</div>
          <el-table :data="Object.entries(report.byType).map(([k,v]) => ({ type: k, ...v }))" size="small">
            <el-table-column prop="type" label="类型" />
            <el-table-column prop="total" label="总数" width="100" />
            <el-table-column prop="succeeded" label="成功" width="100" />
            <el-table-column prop="failed" label="失败" width="100" />
          </el-table>
          <div v-if="report.failures.length > 0">
            <div class="card-title" style="margin-top: 12px;">失败明细</div>
            <el-table :data="report.failures" size="small">
              <el-table-column prop="testType" label="类型" width="120" />
              <el-table-column prop="targetId" label="目标" min-width="180" />
              <el-table-column prop="error" label="错误" min-width="280" />
            </el-table>
          </div>
        </div>
      </el-tab-pane>
    </el-tabs>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.hero { display: flex; align-items: center; gap: 14px; }
.hero-left { display: flex; align-items: center; gap: 14px; }
.tabs { background: var(--bg-panel); border-radius: 14px; padding: 12px 18px; border: 1px solid var(--border-soft); }
.form-grid {
  display: grid; grid-template-columns: 1fr 1fr; gap: 12px;
  background: var(--bg-elevated); border-radius: 10px; padding: 16px; margin-bottom: 14px;
}
.col { display: flex; flex-direction: column; gap: 4px; }
.col label { font-size: 12px; color: var(--text-secondary); letter-spacing: 0.5px; }
.col.span-2 { grid-column: 1 / span 2; }
.row-btn { display: flex; gap: 10px; }

.result-card {
  margin-top: 8px; padding: 12px 16px; border-radius: 10px;
  background: var(--bg-elevated); border: 1px solid var(--border-soft);
}
.result-card.ok { border-color: var(--color-success); background: rgba(63, 191, 135, 0.06); }
.result-card.fail { border-color: var(--color-error); background: rgba(229, 100, 93, 0.06); }
.result-head { display: flex; align-items: center; gap: 10px; }
.result-icon { font-size: 20px; font-weight: 700; }
.result-card.ok .result-icon { color: var(--color-success); }
.result-card.fail .result-icon { color: var(--color-error); }
.result-text { flex: 1; font-size: 15px; }
.result-time { color: var(--text-secondary); font-size: 12px; font-variant-numeric: tabular-nums; }
.result-data {
  font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px;
  background: var(--bg-base); border-radius: 6px; padding: 8px 12px; margin-top: 8px;
  max-height: 200px; overflow: auto; color: var(--text-secondary);
}

.net-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.err {
  color: var(--color-error); font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px;
}

.filters { display: flex; gap: 10px; margin-bottom: 12px; align-items: center; }
.params {
  font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; color: var(--text-secondary);
}

.report-card { padding: 12px; }
.report-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
.stat {
  background: var(--bg-elevated); border-radius: 10px; padding: 14px 18px;
  border: 1px solid var(--border-soft);
}
.stat.ok { border-color: var(--color-success); }
.stat.fail { border-color: var(--color-error); }
.stat .num { font-size: 28px; font-weight: 700; font-variant-numeric: tabular-nums; }
.stat .num span { font-size: 16px; color: var(--text-secondary); margin-left: 2px; }
.stat .lbl { font-size: 12px; color: var(--text-secondary); }
.stat.ok .num { color: var(--color-success); }
.stat.fail .num { color: var(--color-error); }
.card-title { font-size: 13px; color: var(--text-secondary); letter-spacing: 1px; margin: 8px 0; }
</style>
