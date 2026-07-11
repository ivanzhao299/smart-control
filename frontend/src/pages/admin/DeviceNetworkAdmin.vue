<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { RefreshCw, Radar } from 'lucide-vue-next';
import { adminHardwareService, adminTestService } from '@/services/admin.service';
import { deviceService } from '@/services/device.service';
import { usePermissionStore } from '@/stores/permission';
import type { GatewayInfo, HardwareCategory, HardwareUnit } from '@/types/api';

/**
 * 设备网络 — IoT 设备 IP 一览 + 直接改.
 *
 * 业主需求 (2026-07-11): 设备换了网段以前要改代码重新部署, 太傻.
 * 这页把所有联网硬件列成一张表, IP/端口 直接改, 点保存立即生效:
 *   PUT /api/hardware/:id → 后端 controller 清对应 adapter 的 DB 缓存
 *   → adapter 下一次 IO 前重读 DB → 自动断开旧连接, 连新 IP (免重启).
 *
 * "探测" 按钮 = PING + TCP 端口双探, 改完 IP 立刻验证物理设备到位没有.
 */

const perm = usePermissionStore();
const loading = ref(false);
const rows = ref<NetworkRow[]>([]);
const gateways = ref<GatewayInfo[]>([]);

/** 有 IP 概念的类别 — 没 IP 的纯被动硬件 (灯具驱动器/继电器) 不在这页出现 */
const NETWORK_CATEGORIES: HardwareCategory[] = [
  'rtu-tcp-converter', 'dali-gateway', 'led-controller', 'led-player',
  'audio-dsp', 'audio-guide', 'audio-power', 'hvac-gateway',
  'tablet', 'switch', 'router', 'other',
];

const CATEGORY_LABELS: Partial<Record<HardwareCategory, string>> = {
  'dali-gateway': 'DALI 网关',
  'rtu-tcp-converter': 'RTU↔TCP 转换器',
  'led-controller': 'LED 控制器',
  'led-player': 'LED 播控主机',
  'audio-dsp': '音响 DSP',
  'audio-guide': '分区导览',
  'audio-power': '音响时序器',
  'hvac-gateway': '空调网关',
  'tablet': '控制平板',
  'switch': '交换机',
  'router': '路由器',
  'other': '其它',
};

interface ProbeResult {
  state: 'idle' | 'testing' | 'done';
  pingOk?: boolean;
  tcpOk?: boolean;
  message?: string;
}

interface NetworkRow {
  unit: HardwareUnit;
  ip: string;        // 编辑中的值
  port: string;      // 编辑中的值 (字符串好清空)
  origIp: string;
  origPort: string;
  saving: boolean;
  probe: ProbeResult;
}

/** addressing JSON 里端口字段兼容两种历史命名: tcpPort (EKX seed) / port (其余) */
function parsePort(addressing: string | null): string {
  if (!addressing) return '';
  try {
    const a = JSON.parse(addressing) as { tcpPort?: number; port?: number };
    const p = a.tcpPort ?? a.port;
    return typeof p === 'number' ? String(p) : '';
  } catch {
    return '';
  }
}

/** 端口写回 addressing, 保留其它字段 (slaveId/box/zones...), 沿用原字段名 */
function mergePort(addressing: string | null, portStr: string): string | null {
  const port = portStr.trim() === '' ? undefined : Number.parseInt(portStr, 10);
  let obj: Record<string, unknown> = {};
  if (addressing) {
    try { obj = JSON.parse(addressing) as Record<string, unknown>; } catch { obj = {}; }
  }
  if (port === undefined || Number.isNaN(port)) return addressing; // 端口留空 = 不动
  if ('tcpPort' in obj) obj.tcpPort = port;
  else obj.port = port;
  return JSON.stringify(obj);
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [hw, gw] = await Promise.all([
      adminHardwareService.list(),
      deviceService.runtimeGateways().catch(() => [] as GatewayInfo[]),
    ]);
    gateways.value = gw;
    rows.value = hw.list
      .filter((u) => u.ip || NETWORK_CATEGORIES.includes(u.category))
      .map((u) => {
        const ip = u.ip ?? '';
        const port = parsePort(u.addressing);
        return { unit: u, ip, port, origIp: ip, origPort: port, saving: false, probe: { state: 'idle' } };
      });
  } catch (e) {
    ElMessage.error((e as Error).message || '加载失败');
  } finally {
    loading.value = false;
  }
}

async function refreshGateways(): Promise<void> {
  try { gateways.value = await deviceService.runtimeGateways(); } catch { /* 静默 */ }
}

/** 行 → 后端连接状态: 按 IP 匹配 gateway endpoint (tcp://IP:port) */
function gatewayFor(row: NetworkRow): GatewayInfo | undefined {
  const ip = row.origIp;
  if (!ip) return undefined;
  return gateways.value.find((g) => g.endpoint.includes(`//${ip}:`) || g.endpoint.includes(`@${ip}:`));
}

const stateMeta: Record<GatewayInfo['state'], { label: string; cls: string }> = {
  online: { label: '在线', cls: 'is-online' },
  offline: { label: '离线', cls: 'is-offline' },
  reconnecting: { label: '重连中', cls: 'is-warn' },
  error: { label: '错误', cls: 'is-offline' },
};

function isDirty(row: NetworkRow): boolean {
  return row.ip.trim() !== row.origIp || row.port.trim() !== row.origPort;
}

const IP_RE = /^(\d{1,3}\.){3}\d{1,3}$/;

async function save(row: NetworkRow): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  const ip = row.ip.trim();
  if (!ip) { ElMessage.warning('IP 不能为空'); return; }
  if (!IP_RE.test(ip)) { ElMessage.warning('IP 格式不对, 应为 192.168.x.x'); return; }
  const portTrim = row.port.trim();
  if (portTrim && !/^\d{1,5}$/.test(portTrim)) { ElMessage.warning('端口应为 1-65535 的数字'); return; }

  row.saving = true;
  try {
    const updated = await adminHardwareService.update(row.unit.id, {
      ip,
      addressing: mergePort(row.unit.addressing, portTrim) ?? undefined,
    });
    row.unit = updated;
    row.origIp = ip;
    row.origPort = portTrim || parsePort(updated.addressing);
    ElMessage.success(`${row.unit.name} 已保存, 新地址立即生效`);
    // 立即触发一轮健康探测, 让状态列尽快反映新 IP 的真实连接情况
    void deviceService.triggerHealthProbe().catch(() => {});
    setTimeout(() => { void refreshGateways(); }, 3000);
  } catch (e) {
    ElMessage.error((e as Error).message || '保存失败');
  } finally {
    row.saving = false;
  }
}

/** PING + TCP 双探 — 用编辑框里的值 (改完还没保存也能先试) */
async function probeRow(row: NetworkRow): Promise<void> {
  const ip = row.ip.trim();
  if (!ip) { ElMessage.warning('请先填 IP'); return; }
  const port = Number.parseInt(row.port.trim(), 10);
  row.probe = { state: 'testing' };
  try {
    const ping = await adminTestService.ping(ip, 2000).catch(() => null);
    const pingOk = ping?.reachable ?? false;
    let tcpOk: boolean | undefined;
    if (!Number.isNaN(port)) {
      const tcp = await adminTestService.port(ip, port, 2000).catch(() => null);
      tcpOk = tcp?.open ?? false;
    }
    row.probe = {
      state: 'done',
      pingOk,
      tcpOk,
      message: `PING ${pingOk ? '通' : '不通'}${tcpOk !== undefined ? ` · 端口 ${port} ${tcpOk ? '开' : '关'}` : ''}`,
    };
  } catch (e) {
    row.probe = { state: 'done', pingOk: false, message: (e as Error).message };
  }
}

// 每 10s 刷一次网关状态 (改完 IP 后 adapter 重连需要几秒)
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void load();
  timer = setInterval(() => { void refreshGateways(); }, 10_000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });

const dirtyCount = computed(() => rows.value.filter(isDirty).length);
</script>

<template>
  <div class="devnet">
    <div class="devnet-head">
      <div>
        <div class="devnet-title">设备网络</div>
        <div class="devnet-sub">
          改 IP / 端口后点保存 — 服务端立即切到新地址, 不用重启不用改代码
          <span v-if="dirtyCount" class="devnet-dirty">{{ dirtyCount }} 项未保存</span>
        </div>
      </div>
      <el-button :icon="RefreshCw" circle :loading="loading" title="刷新" @click="load" />
    </div>

    <el-table :data="rows" v-loading="loading" stripe style="width:100%;">
      <el-table-column label="设备" min-width="200">
        <template #default="{ row }">
          <div class="cell-name">{{ (row as NetworkRow).unit.name }}</div>
          <div class="cell-code">{{ (row as NetworkRow).unit.code }} · {{ CATEGORY_LABELS[(row as NetworkRow).unit.category] ?? (row as NetworkRow).unit.category }}</div>
        </template>
      </el-table-column>

      <el-table-column label="IP 地址" width="180">
        <template #default="{ row }">
          <el-input
            v-model="(row as NetworkRow).ip"
            placeholder="192.168.77.x"
            class="mono-input"
            :disabled="!perm.canEdit"
          />
        </template>
      </el-table-column>

      <el-table-column label="端口" width="110">
        <template #default="{ row }">
          <el-input
            v-model="(row as NetworkRow).port"
            placeholder="—"
            class="mono-input"
            :disabled="!perm.canEdit"
          />
        </template>
      </el-table-column>

      <el-table-column label="连接状态" width="110">
        <template #default="{ row }">
          <template v-if="gatewayFor(row as NetworkRow)">
            <span class="state-badge" :class="stateMeta[gatewayFor(row as NetworkRow)!.state].cls">
              {{ stateMeta[gatewayFor(row as NetworkRow)!.state].label }}
            </span>
          </template>
          <span v-else class="state-badge is-na">—</span>
        </template>
      </el-table-column>

      <el-table-column label="探测" min-width="170">
        <template #default="{ row }">
          <div class="probe-cell">
            <el-button
              size="small"
              :icon="Radar"
              :loading="(row as NetworkRow).probe.state === 'testing'"
              @click="probeRow(row as NetworkRow)"
            >探测</el-button>
            <span
              v-if="(row as NetworkRow).probe.state === 'done'"
              class="probe-msg"
              :class="{
                'is-ok': (row as NetworkRow).probe.pingOk && (row as NetworkRow).probe.tcpOk !== false,
                'is-fail': !(row as NetworkRow).probe.pingOk || (row as NetworkRow).probe.tcpOk === false,
              }"
            >{{ (row as NetworkRow).probe.message }}</span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="110" align="right">
        <template #default="{ row }">
          <el-button
            type="primary"
            size="small"
            :disabled="!isDirty(row as NetworkRow) || !perm.canEdit"
            :loading="(row as NetworkRow).saving"
            @click="save(row as NetworkRow)"
          >保存</el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="devnet-hint">
      提示: 改完 IP 保存后, 状态列几秒内自动刷新; 也可以点 "探测" 立刻验证设备通不通.
      物理设备本身的 IP 要先在设备/路由器上改好, 这里填的是服务器去连它的地址.
    </div>
  </div>
</template>

<style scoped>
.devnet { padding: 4px 0; }
.devnet-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}
.devnet-title { font-size: 16px; font-weight: 600; color: var(--v2-text-1); }
.devnet-sub { font-size: 12px; color: var(--v2-text-3); margin-top: 3px; }
.devnet-dirty {
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 99px;
  background: rgba(251, 191, 36, 0.15);
  color: #fbbf24;
  font-size: 11px;
}

.cell-name { font-size: 13px; color: var(--v2-text-1); }
.cell-code { font-size: 11px; color: var(--v2-text-3); margin-top: 1px; font-family: 'JetBrains Mono', ui-monospace, monospace; }

.mono-input :deep(input) {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
}

.state-badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 99px;
  font-size: 11.5px;
}
.state-badge.is-online { background: rgba(0, 231, 138, 0.13); color: #6ee7b7; }
.state-badge.is-offline { background: rgba(255, 71, 87, 0.13); color: #fca5a5; }
.state-badge.is-warn { background: rgba(251, 191, 36, 0.13); color: #fbbf24; }
.state-badge.is-na { color: var(--v2-text-3); }

.probe-cell { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.probe-msg { font-size: 11.5px; }
.probe-msg.is-ok { color: #6ee7b7; }
.probe-msg.is-fail { color: #fca5a5; }

.devnet-hint {
  margin-top: 10px;
  font-size: 11.5px;
  color: var(--v2-text-3);
  line-height: 1.6;
}
</style>
