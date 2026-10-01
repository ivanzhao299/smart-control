<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AppSkeleton from '@/components/AppSkeleton.vue';
import { Plus } from 'lucide-vue-next';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  powerCircuitsService,
  powerSchedulesService,
  type PowerCircuitView,
  type PowerCircuitUpsertDto,
  type PowerScheduleRule,
  type PowerScheduleInput,
} from '@/services/power-circuits.service';

const CATEGORIES = [
  { value: 'lighting', label: '照明' },
  { value: 'socket',   label: '插座' },
  { value: 'hvac',     label: '空调' },
  { value: 'led',      label: 'LED 大屏' },
  { value: 'audio',    label: '音响' },
  { value: 'misc',     label: '其它' },
];

const list = ref<PowerCircuitView[]>([]);
const loading = ref(false);
const search = ref('');
const floorFilter = ref<string>('');

const floorOptions = computed<string[]>(() => {
  const set = new Set<string>();
  for (const c of list.value) set.add(c.floor);
  return Array.from(set).sort();
});

const filtered = computed<PowerCircuitView[]>(() => {
  let rows = list.value;
  if (floorFilter.value) rows = rows.filter((c) => c.floor === floorFilter.value);
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    rows = rows.filter((c) =>
      c.name.toLowerCase().includes(q) ||
      c.code.toLowerCase().includes(q) ||
      (c.gatewayCode ?? '').toLowerCase().includes(q)
    );
  }
  return rows;
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    list.value = await powerCircuitsService.list(true);
  } catch (err) {
    ElMessage.error(`加载失败: ${(err as Error).message}`);
  } finally {
    loading.value = false;
  }
}

const editVisible = ref(false);
const editMode = ref<'create' | 'edit'>('create');
const formRef = ref<FormInstance>();

interface FormState extends PowerCircuitUpsertDto { id?: number }
const form = reactive<FormState>({
  code: '', name: '', floor: '1F', category: 'misc',
  gatewayCode: '', relayChannel: 1, meterAddress: null,
  ratedVoltage: 220, ratedCurrent: 16, ratedPower: 0,
  sortOrder: 100, icon: 'Zap', description: '', enabled: true,
});

const rules: FormRules = {
  code: [{ required: true, message: 'code 必填', trigger: 'blur' }],
  name: [{ required: true, message: '显示名必填', trigger: 'blur' }],
  floor: [{ required: true, message: '楼层必填', trigger: 'blur' }],
  category: [{ required: true, message: '类型必填', trigger: 'change' }],
};

function openCreate(): void {
  editMode.value = 'create';
  Object.assign(form, {
    id: undefined,
    code: '', name: '', floor: floorFilter.value || '1F', category: 'misc',
    gatewayCode: '', relayChannel: 1, meterAddress: null,
    ratedVoltage: 220, ratedCurrent: 16, ratedPower: 0,
    sortOrder: 100, icon: 'Zap', description: '', enabled: true,
  });
  editVisible.value = true;
}

function openEdit(row: PowerCircuitView): void {
  editMode.value = 'edit';
  Object.assign(form, {
    id: row.id,
    code: row.code, name: row.name, floor: row.floor, category: row.category,
    gatewayCode: row.gatewayCode ?? '', relayChannel: row.relayChannel ?? 1,
    meterAddress: row.meterAddress, ratedVoltage: row.ratedVoltage,
    ratedCurrent: row.ratedCurrent, ratedPower: row.ratedPower,
    sortOrder: row.sortOrder, icon: row.icon ?? 'Zap',
    description: row.description ?? '', enabled: row.enabled,
  });
  editVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    const payload: PowerCircuitUpsertDto = {
      code: form.code.trim(),
      name: form.name.trim(),
      floor: form.floor.trim(),
      category: form.category,
      gatewayCode: (form.gatewayCode || '').trim() || null,
      relayChannel: Number(form.relayChannel ?? 1) || null,
      meterAddress: form.meterAddress != null ? Number(form.meterAddress) : null,
      ratedVoltage: Number(form.ratedVoltage ?? 220),
      ratedCurrent: Number(form.ratedCurrent ?? 16),
      ratedPower: Number(form.ratedPower ?? 0),
      sortOrder: Number(form.sortOrder ?? 100),
      icon: (form.icon || 'Zap').trim() || null,
      description: (form.description || '').trim() || null,
      enabled: form.enabled ?? true,
    };
    try {
      if (editMode.value === 'create') {
        await powerCircuitsService.create(payload);
        ElMessage.success('已新增电源回路');
      } else if (form.id) {
        await powerCircuitsService.update(form.id, payload);
        ElMessage.success('已更新电源回路');
      }
      editVisible.value = false;
      await refresh();
    } catch (err) {
      ElMessage.error(`保存失败: ${(err as Error).message}`);
    }
  });
}

async function remove(row: PowerCircuitView): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `删除电源回路 "${row.name}" (${row.code})?`,
      '确认删除',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch { return; }
  try {
    await powerCircuitsService.remove(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (err) {
    ElMessage.error(`删除失败: ${(err as Error).message}`);
  }
}

async function toggleEnabled(row: PowerCircuitView): Promise<void> {
  try {
    await powerCircuitsService.update(row.id, { enabled: !row.enabled });
    await refresh();
  } catch (err) {
    ElMessage.error(`切换状态失败: ${(err as Error).message}`);
  }
}

// ============ 自动开关规则 (定时 + 日落/日出) 2026-10-01 ============
// 4G 断路器回路支持; 每条回路多规则 (开一条/关一条最常见)。写操作走 admin API。
const schedVisible = ref(false);
const schedCircuit = ref<PowerCircuitView | null>(null);
const schedRules = ref<PowerScheduleRule[]>([]);
const schedLoading = ref(false);

const ruleVisible = ref(false);
const ruleFormRef = ref<FormInstance>();
const ruleForm = reactive<{ id?: number; action: 'on' | 'off'; mode: 'fixed' | 'sunset' | 'sunrise'; time: string; offsetMin: number; weekdays: string; enabled: boolean }>({
  id: undefined, action: 'on', mode: 'sunset', time: '18:30',
  offsetMin: 0, weekdays: '', enabled: true,
});
const WEEKDAY_OPTIONS = [
  { value: '1', label: '一' }, { value: '2', label: '二' }, { value: '3', label: '三' },
  { value: '4', label: '四' }, { value: '5', label: '五' }, { value: '6', label: '六' },
  { value: '7', label: '日' },
];
const MODE_LABEL: Record<string, string> = { fixed: '固定时刻', sunset: '日落', sunrise: '日出' };

/** 星期多选 ↔ ruleForm.weekdays 逗号串 */
const weekdaySelection = computed<string[]>({
  get: () => (ruleForm.weekdays ? ruleForm.weekdays.split(',') : []),
  set: (vals: string[]) => { ruleForm.weekdays = vals.join(','); },
});

async function openSchedules(row: PowerCircuitView): Promise<void> {
  schedCircuit.value = row;
  schedVisible.value = true;
  await loadSchedules(row.id);
}

async function loadSchedules(circuitId: number): Promise<void> {
  schedLoading.value = true;
  try {
    schedRules.value = await powerSchedulesService.listForCircuit(circuitId);
  } catch (err) {
    ElMessage.error(`加载自动开关规则失败: ${(err as Error).message}`);
  } finally {
    schedLoading.value = false;
  }
}

function openRuleCreate(): void {
  Object.assign(ruleForm, { id: undefined, action: 'on', mode: 'sunset', time: '18:30', offsetMin: 0, weekdays: '', enabled: true });
  ruleVisible.value = true;
}

function openRuleEdit(r: PowerScheduleRule): void {
  Object.assign(ruleForm, {
    id: r.id, action: r.action, mode: r.mode, time: r.time ?? '18:30',
    offsetMin: r.offsetMin, weekdays: r.weekdays ?? '', enabled: r.enabled,
  });
  ruleVisible.value = true;
}

async function saveRule(): Promise<void> {
  if (!ruleFormRef.value) return;
  await ruleFormRef.value.validate(async (valid) => {
    if (!valid) return;
    if (!schedCircuit.value) return;
    const payload: PowerScheduleInput = {
      circuitId: schedCircuit.value.id,
      action: ruleForm.action,
      mode: ruleForm.mode,
      time: ruleForm.mode === 'fixed' ? ruleForm.time : null,
      offsetMin: Number(ruleForm.offsetMin ?? 0),
      weekdays: ruleForm.weekdays ? ruleForm.weekdays.split(',').map((x) => x.trim()).filter(Boolean).join(',') : null,
      enabled: ruleForm.enabled,
    };
    try {
      if (ruleForm.id != null) await powerSchedulesService.update(ruleForm.id, payload);
      else await powerSchedulesService.create(payload);
      ElMessage.success(ruleForm.id != null ? '已更新规则' : '已新增规则');
      ruleVisible.value = false;
      await loadSchedules(schedCircuit.value.id);
    } catch (err) {
      ElMessage.error(`保存规则失败: ${(err as Error).message}`);
    }
  });
}

async function removeRule(r: PowerScheduleRule): Promise<void> {
  try {
    await ElMessageBox.confirm(`删除这条自动开关规则?`, '确认删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' });
  } catch { return; }
  try {
    await powerSchedulesService.remove(r.id);
    ElMessage.success('已删除');
    await loadSchedules(r.circuitId);
  } catch (err) {
    ElMessage.error(`删除失败: ${(err as Error).message}`);
  }
}

function toggleRule(r: PowerScheduleRule): void {
  powerSchedulesService.update(r.id, { enabled: !r.enabled })
    .then(() => loadSchedules(r.circuitId))
    .catch((err) => ElMessage.error(`切换失败: ${(err as Error).message}`));
}

function fmtRuleDesc(r: PowerScheduleRule): string {
  const mode = MODE_LABEL[r.mode] ?? r.mode;
  const t = r.mode === 'fixed'
    ? (r.time ?? '')
    : `${r.offsetMin !== 0 ? (r.offsetMin > 0 ? `后${r.offsetMin}分` : `前${-r.offsetMin}分`) : '时刻'}`;
  const wd = r.weekdays
    ? ` · ${r.weekdays.split(',').map((x) => `周${WEEKDAY_OPTIONS.find((o) => o.value === x)?.label ?? x}`).join('/')}`
    : '';
  return `${mode} ${t}${wd} → ${r.action === 'on' ? '通电' : '断电'}`;
}

onMounted(refresh);
</script>

<template>
  <section class="circuits-admin">
    <header class="page-head">
      <h2>电源回路</h2>
      <el-select v-model="floorFilter" placeholder="全部楼层" clearable class="floor-sel">
        <el-option v-for="f in floorOptions" :key="f" :label="f" :value="f" />
      </el-select>
      <el-input v-model="search" placeholder="搜索名称 / code / 继电器" clearable class="search-inp" />
      <el-button type="primary" class="head-add" @click="openCreate">新增回路</el-button>
      <el-button @click="refresh" :loading="loading">刷新</el-button>
    </header>
    <p class="sub">
      每条回路 = 一路强电继电器通道 + 可选电能表. 通断走 gatewayCode/relayChannel, 实时数据走 meterAddress (留空则 mock 模拟).
    </p>

    <AppSkeleton v-if="loading && filtered.length === 0" variant="table" :rows="8" />
    <el-table v-else :data="filtered" v-loading="loading" stripe class="circuits-table">
      <el-table-column label="名称" min-width="150">
        <template #default="{ row }">
          <div class="name-cell">
            <div class="name-row">
              <span class="circuit-name">{{ row.name }}</span>
              <span v-if="row.floor" class="floor-tag">{{ row.floor }}</span>
            </div>
            <code class="circuit-code">{{ row.code }}</code>
            <div v-if="row.description" class="circuit-desc">{{ row.description }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="类型" width="76" align="center">
        <template #default="{ row }">
          <el-tag size="default" :type="row.category === 'misc' ? 'info' : 'primary'">
            {{ CATEGORIES.find(c => c.value === row.category)?.label ?? row.category }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="继电器" min-width="120">
        <template #default="{ row }">
          <code v-if="row.gatewayCode" class="gw-code">{{ row.gatewayCode }} · CH{{ row.relayChannel ?? '?' }}</code>
          <span v-else class="muted">未配置</span>
        </template>
      </el-table-column>
      <el-table-column label="额定" width="108">
        <template #default="{ row }">
          <code class="gw-code">{{ row.ratedVoltage }}V · {{ row.ratedCurrent }}A · {{ row.ratedPower }}W</code>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="80" align="center">
        <template #default="{ row }">
          <el-tag size="default" :type="row.reading.on ? 'success' : 'info'">
            {{ row.reading.on ? '通电' : '断电' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="84" align="center">
        <template #default="{ row }">
          <el-switch
            :model-value="row.enabled"
            @change="toggleEnabled(row)"
            inline-prompt
            active-text="启用"
            inactive-text="停用"
          />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="150" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openSchedules(row)">自动开关</el-button>
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button link type="danger" @click="remove(row)">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer
      v-model="editVisible"
      :title="editMode === 'create' ? '新增电源回路' : `编辑 — ${form.name}`"
      size="40%" direction="rtl"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="110px" label-position="right" class="form">
        <el-form-item label="业务 code" prop="code">
          <el-input v-model="form.code" :disabled="editMode === 'edit'" placeholder="e.g. 1f-main, 2f-hvac" />
        </el-form-item>
        <el-form-item label="显示名" prop="name">
          <el-input v-model="form.name" placeholder="e.g. 一层总闸" />
        </el-form-item>
        <el-form-item label="楼层" prop="floor">
          <el-input v-model="form.floor" placeholder="1F / 2F" style="width: 160px;" />
        </el-form-item>
        <el-form-item label="类型" prop="category">
          <el-select v-model="form.category" style="width: 200px;">
            <el-option v-for="c in CATEGORIES" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="继电器 code">
          <el-input v-model="form.gatewayCode" placeholder="对应 硬件清单 power-relay 设备 code, e.g. RELAY-1F-1" />
          <div class="hint">没装继电器留空, 操作不会真打硬件</div>
        </el-form-item>
        <el-form-item label="通道号">
          <el-input-number v-model="form.relayChannel" :min="1" :max="32" controls-position="right" />
          <span class="hint inline">继电器的第几路 (1-32)</span>
        </el-form-item>
        <el-form-item label="电表地址">
          <el-input-number v-model="form.meterAddress" :min="1" :max="247" controls-position="right" />
          <span class="hint inline">Modbus 电能表从机号, 留空走 mock</span>
        </el-form-item>
        <el-form-item label="额定电压">
          <el-input-number v-model="form.ratedVoltage" :min="0" :max="600" controls-position="right" />
          <span class="hint inline">V (220 / 380)</span>
        </el-form-item>
        <el-form-item label="额定电流">
          <el-input-number v-model="form.ratedCurrent" :min="0" :max="200" controls-position="right" />
          <span class="hint inline">A (开关额定)</span>
        </el-form-item>
        <el-form-item label="额定功率">
          <el-input-number v-model="form.ratedPower" :min="0" :max="100000" controls-position="right" />
          <span class="hint inline">W, 0 = 按电压×电流估算</span>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="form.sortOrder" :min="0" :max="9999" controls-position="right" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.description" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="editVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-drawer>

    <!-- 自动开关规则列表 (定时/日落/日出) — 2026-10-01 -->
    <el-drawer v-model="schedVisible" :title="`自动开关 — ${schedCircuit?.name ?? ''}`" size="46%" direction="rtl">
      <div class="sched-head">
        <p class="sched-sub">
          以日落/日出为参考点: 开、关都可设在参考点前后 (如日落前30分通电 + 日落后90分断电, 形成一段亮灯时间)。
          日落/日出按设备上报的园区经纬度每日自动重算 (NOAA 算法, ±5 分钟内)。动作经 4G 平台下发, 失败会记日志并在下一分钟周期重试。
        </p>
        <el-button type="primary" size="small" @click="openRuleCreate" class="sched-add">
          <el-icon><Plus /></el-icon> 新增规则
        </el-button>
      </div>
      <div v-loading="schedLoading" class="sched-list">
        <div v-if="!schedLoading && schedRules.length === 0" class="sched-empty">还没有自动开关规则 — 点"新增规则"添加</div>
        <div v-for="r in schedRules" :key="r.id" class="sched-item">
          <div class="sched-item-main">
            <div class="sched-item-title">
              <el-tag size="small" :type="r.action === 'on' ? 'success' : 'warning'">{{ r.action === 'on' ? '通电' : '断电' }}</el-tag>
              <span class="sched-desc">{{ fmtRuleDesc(r) }}</span>
            </div>
            <div class="sched-item-sub">
              下次: {{ r.nextRunAt ? new Date(r.nextRunAt).toLocaleString('zh-CN', { hour12: false }) : '—' }}
            </div>
          </div>
          <div class="sched-item-ops">
            <el-switch :model-value="r.enabled" size="small" @change="toggleRule(r)" />
            <el-button link type="primary" size="small" @click="openRuleEdit(r)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeRule(r)">删除</el-button>
          </div>
        </div>
      </div>
    </el-drawer>

    <!-- 规则编辑 -->
    <el-dialog v-model="ruleVisible" :title="ruleForm.id != null ? '编辑规则' : '新增规则'" width="440px">
      <el-form ref="ruleFormRef" :model="ruleForm" label-width="90px" label-position="right">
        <el-form-item label="动作" prop="action">
          <el-radio-group v-model="ruleForm.action">
            <el-radio-button value="on">通电</el-radio-button>
            <el-radio-button value="off">断电</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="模式" prop="mode">
          <el-radio-group v-model="ruleForm.mode">
            <el-radio-button value="sunset">日落</el-radio-button>
            <el-radio-button value="sunrise">日出</el-radio-button>
            <el-radio-button value="fixed">固定时刻</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="ruleForm.mode === 'fixed'" label="时刻" prop="time">
          <el-time-picker
            v-model="ruleForm.time"
            format="HH:mm"
            value-format="HH:mm"
            placeholder="选择时间"
          />
        </el-form-item>
        <el-form-item v-else label="前后偏移">
          <el-input-number v-model="ruleForm.offsetMin" :min="-120" :max="120" controls-position="right" />
          <span class="hint inline">以{{ ruleForm.mode === 'sunset' ? '日落' : '日出' }}为参考: 负数=之前, 正数=之后 (日落前30分=-30)</span>
        </el-form-item>
        <el-form-item label="星期">
          <el-checkbox-group v-model="weekdaySelection" :max="7">
            <el-checkbox-button v-for="o in WEEKDAY_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</el-checkbox-button>
          </el-checkbox-group>
          <span class="hint">不选 = 每天</span>
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="ruleForm.enabled" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="ruleVisible = false">取消</el-button>
        <el-button type="primary" @click="saveRule">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.circuits-admin { padding: 16px 24px; color: var(--v2-text-1); }
.page-head {
  display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap; margin-bottom: 10px;
}
.page-head h2 { margin: 0 6px 0 0; font-size: 20px; color: var(--v2-text-1); white-space: nowrap; }
.floor-sel { width: 120px; }
.search-inp { width: 220px; }
.head-add { margin-left: auto; }
.sub { color: var(--v2-text-2); margin: 0 0 14px; font-size: 13px; max-width: 720px; line-height: 1.6; }

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
  font-size: 11.5px;
  color: var(--v2-text-2);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.4px;
}
.circuit-desc { font-size: 11.5px; color: var(--v2-text-2); font-style: italic; }
.gw-code {
  font-size: 11.5px;
  color: var(--v2-text-2);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.muted { color: var(--v2-text-3); font-size: 12px; }

.form { padding: 16px 0; }
.hint { font-size: 12px; color: var(--v2-text-2); margin-top: 4px; line-height: 1.5; }
.hint.inline { margin-left: 8px; }

/* ============ 自动开关规则 (定时/日落/日出) ============ */
.sched-head { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 14px; }
.sched-sub { color: var(--v2-text-2); font-size: 12.5px; line-height: 1.7; margin: 0; flex: 1; }
.sched-add { flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; }
.sched-list { display: flex; flex-direction: column; gap: 10px; min-height: 120px; }
.sched-empty { color: var(--v2-text-3); font-size: 13px; text-align: center; padding: 32px 0; }
.sched-item {
  display: flex; align-items: center; gap: 10px;
  padding: 10px 12px; border-radius: 10px;
  background: var(--v2-ov-1); border: 1px solid var(--v2-border-soft);
}
.sched-item-main { flex: 1; display: flex; flex-direction: column; gap: 4px; }
.sched-item-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sched-desc { font-size: 13px; color: var(--v2-text-1); letter-spacing: 0.2px; }
.sched-item-sub { font-size: 11.5px; color: var(--v2-text-2); }
.sched-item-ops { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
</style>
