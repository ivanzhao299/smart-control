<script setup lang="ts">
/**
 * 日常运行 → 自动开关（运营配置员 config 可改）。
 * 仅配置智能断路器回路的自动通断时间（固定时刻 / 日落 / 日出 / 星期）；
 * 不涉及回路增删、接线、通道、命名等硬件配置（那些在「设备与分区 → 电源回路」，归 hardware）。
 */
import { computed, onMounted, ref } from 'vue';
import AppSkeleton from '@/components/AppSkeleton.vue';
import { ElMessage } from 'element-plus';
import {
  powerCircuitsService,
  powerSchedulesService,
  type PowerCircuitView,
  type PowerScheduleRule,
} from '@/services/power-circuits.service';
import PowerScheduleDrawer from '@/components/admin/PowerScheduleDrawer.vue';

const CATEGORIES: Record<string, string> = {
  lighting: '照明', socket: '插座', hvac: '空调', led: 'LED 大屏', audio: '音响', misc: '其它',
};

const list = ref<PowerCircuitView[]>([]);
const allRules = ref<PowerScheduleRule[]>([]);
const loading = ref(false);
const search = ref('');
const floorFilter = ref<string>('');

const schedRef = ref<InstanceType<typeof PowerScheduleDrawer> | null>(null);

const floorOptions = computed<string[]>(() => {
  const set = new Set<string>();
  for (const c of list.value) set.add(c.floor);
  return Array.from(set).sort();
});

/** 自动开关只对智能断路器回路有意义 */
const breakerCircuits = computed<PowerCircuitView[]>(() =>
  list.value.filter((c) => c.isBreaker));

const filtered = computed<PowerCircuitView[]>(() => {
  let rows = breakerCircuits.value;
  if (floorFilter.value) rows = rows.filter((c) => c.floor === floorFilter.value);
  const q = search.value.trim().toLowerCase();
  if (q) {
    rows = rows.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.gatewayCode ?? '').toLowerCase().includes(q));
  }
  return rows;
});

/** circuitId -> 该回路的规则（启用在前） */
const rulesByCircuit = computed<Map<number, PowerScheduleRule[]>>(() => {
  const map = new Map<number, PowerScheduleRule[]>();
  for (const r of allRules.value) {
    const arr = map.get(r.circuitId) ?? [];
    arr.push(r);
    map.set(r.circuitId, arr);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => Number(a.enabled) - Number(b.enabled));
  }
  return map;
});

function ruleStats(c: { id: number }): { enabled: number; total: number; next: PowerScheduleRule | null } {
  const rules = rulesByCircuit.value.get(c.id) ?? [];
  const enabled = rules.filter((r) => r.enabled);
  const next = enabled
    .filter((r) => r.nextRunAt)
    .sort((a, b) => new Date(a.nextRunAt as string).getTime() - new Date(b.nextRunAt as string).getTime())[0]
    ?? null;
  return { enabled: enabled.length, total: rules.length, next };
}

function fmtAt(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [circuits, rules] = await Promise.all([
      powerCircuitsService.list(true),
      powerSchedulesService.list(),
    ]);
    list.value = circuits;
    allRules.value = rules;
  } catch (err) {
    ElMessage.error(`加载失败: ${(err as Error).message}`);
  } finally {
    loading.value = false;
  }
}

function manage(row: PowerCircuitView): void {
  schedRef.value?.open(row);
}

onMounted(refresh);
</script>

<template>
  <section class="auto-switch-admin">
    <header class="page-head">
      <h2>自动开关</h2>
      <el-select v-model="floorFilter" placeholder="全部楼层" clearable class="floor-sel">
        <el-option v-for="f in floorOptions" :key="f" :label="f" :value="f" />
      </el-select>
      <el-input v-model="search" placeholder="搜索名称 / code / 设备" clearable class="search-inp" />
      <el-button class="head-refresh" @click="refresh" :loading="loading">刷新</el-button>
    </header>
    <p class="sub">
      设置智能断路器回路的自动通断时间：固定时刻，或按园区经纬度每天自动重算的日落 / 日出（可前后偏移、按星期）。
      动作经 4G 平台下发。这里只管时间；新增回路、接线通道、命名等硬件配置在「设备与分区 → 电源回路」。
    </p>

    <AppSkeleton v-if="loading && filtered.length === 0" variant="table" :rows="6" />
    <el-table v-else :data="filtered" v-loading="loading" stripe class="switch-table">
      <el-table-column label="回路" min-width="180">
        <template #default="{ row }">
          <div class="name-cell">
            <div class="name-row">
              <span class="circuit-name">{{ row.name }}</span>
              <span v-if="row.floor" class="floor-tag">{{ row.floor }}</span>
            </div>
            <code class="circuit-code">{{ row.code }}</code>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="88" align="center">
        <template #default="{ row }">
          <el-tag size="small" type="primary">{{ CATEGORIES[row.category] ?? row.category }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="当前状态" width="92" align="center">
        <template #default="{ row }">
          <el-tag size="small" :type="row.reading.on ? 'success' : 'info'">
            {{ row.reading.on ? '通电' : '断电' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="自动开关规则" min-width="230">
        <template #default="{ row }">
          <template v-if="ruleStats(row).total > 0">
            <div class="rule-count">
              已启用 <b>{{ ruleStats(row).enabled }}</b> / 共 {{ ruleStats(row).total }} 条
            </div>
            <div v-if="ruleStats(row).next" class="rule-next">
              下次：{{ ruleStats(row).next!.action === 'on' ? '通电' : '断电' }}
              {{ fmtAt(ruleStats(row).next!.nextRunAt) }}
            </div>
            <div v-else class="rule-next muted">暂无已启用规则</div>
          </template>
          <span v-else class="muted">未设置</span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="130" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="manage(row)">
            {{ ruleStats(row).total > 0 ? '管理规则' : '设置自动开关' }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div v-if="!loading && filtered.length === 0" class="empty">
      <template v-if="breakerCircuits.length === 0">
        暂无智能断路器回路。自动开关仅对智能断路器（如 LED 大屏总闸）生效，请先在「设备与分区 → 电源回路」登记。
      </template>
      <template v-else>没有符合筛选条件的回路。</template>
    </div>

    <PowerScheduleDrawer ref="schedRef" @changed="refresh" />
  </section>
</template>

<style scoped>
.auto-switch-admin { padding: 16px 24px; color: var(--v2-text-1); }
.page-head {
  display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap; margin-bottom: 10px;
}
.page-head h2 { margin: 0 6px 0 0; font-size: 20px; color: var(--v2-text-1); white-space: nowrap; }
.floor-sel { width: 120px; }
.search-inp { width: 220px; }
.head-refresh { margin-left: auto; }
.sub { color: var(--v2-text-2); margin: 0 0 14px; font-size: 13px; max-width: 820px; line-height: 1.6; }

.name-cell { display: flex; flex-direction: column; gap: 3px; }
.name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.floor-tag {
  font-size: 11px; font-weight: 500;
  padding: 0 7px; line-height: 18px; border-radius: 9px;
  background: rgba(76, 154, 255, 0.12); color: #67E8F9;
  white-space: nowrap; flex-shrink: 0;
}
.circuit-name { font-weight: 600; color: var(--v2-text-1); font-size: 14px; letter-spacing: 0.3px; }
.circuit-code {
  font-size: 11.5px; color: var(--v2-text-2);
  font-family: 'JetBrains Mono', ui-monospace, monospace; letter-spacing: 0.4px;
}
.muted { color: var(--v2-text-3); font-size: 12px; }
.rule-count { font-size: 13px; color: var(--v2-text-1); }
.rule-next { font-size: 11.5px; color: var(--v2-text-2); margin-top: 2px; }
.empty {
  color: var(--v2-text-3); font-size: 13px; text-align: center;
  padding: 40px 16px; line-height: 1.7; max-width: 680px; margin: 0 auto;
}
</style>
