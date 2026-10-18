<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import AppSkeleton from '@/components/AppSkeleton.vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  powerCircuitsService,
  powerDomainsService,
  powerDomainGrantService,
  type PowerCircuitView,
  type PowerCircuitUpsertDto,
  type PowerDomainView,
  type PowerDomainGrantMatrix,
} from '@/services/power-circuits.service';
import { adminHardwareService } from '@/services/admin.service';
import type { HardwareUnit } from '@/types/api';
import PowerScheduleDrawer from '@/components/admin/PowerScheduleDrawer.vue';
import { LayoutGrid } from 'lucide-vue-next';

const CATEGORIES = [
  { value: 'lighting', label: '照明' },
  { value: 'socket',   label: '插座' },
  { value: 'hvac',     label: '空调' },
  { value: 'led',      label: 'LED 大屏' },
  { value: 'audio',    label: '音响' },
  { value: 'misc',     label: '其它' },
];

const list = ref<PowerCircuitView[]>([]);
const controllerHardware = ref<HardwareUnit[]>([]);
const domains = ref<PowerDomainView[]>([]);
const loading = ref(false);
const search = ref('');
const domainFilter = ref<string>('');
const floorFilter = ref<string>('');

// 第五轮：电源域（展厅/园区/新楼栋）。内置 hall/park 不可删；回路下拉只列启用域。
const BUILTIN_DOMAIN = ['hall', 'park'];
const BUILTIN_DOMAIN_NAME: Record<string, string> = { hall: '展厅', park: '园区' };
function domainName(code: string): string {
  return domains.value.find((d) => d.code === code)?.name
    ?? list.value.find((c) => c.domainCode === code)?.domainName
    ?? BUILTIN_DOMAIN_NAME[code] ?? code;
}
/** 表单/筛选用：启用域（按 sortOrder）。 */
const enabledDomains = computed<PowerDomainView[]>(() =>
  [...domains.value].filter((d) => d.enabled).sort((a, b) => a.sortOrder - b.sortOrder));

const floorOptions = computed<string[]>(() => {
  const set = new Set<string>();
  for (const c of list.value) {
    if (domainFilter.value && c.domainCode !== domainFilter.value) continue;
    set.add(c.floor);
  }
  return Array.from(set).sort();
});

const filtered = computed<PowerCircuitView[]>(() => {
  let rows = list.value;
  if (domainFilter.value) rows = rows.filter((c) => c.domainCode === domainFilter.value);
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
    const [circuits, hardware, domainRows] = await Promise.all([
      powerCircuitsService.list(true),
      adminHardwareService.list({ enabled: true }),
      powerDomainsService.list(true).catch(() => [] as PowerDomainView[]),
    ]);
    list.value = circuits;
    domains.value = domainRows;
    controllerHardware.value = hardware.list.filter((item) =>
      ['power-breaker', 'power-breaker-4g', 'power-breaker-web', 'power-relay', 'audio-power', 'power-seq55']
        .includes(item.category),
    );
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
  code: '', name: '', floor: '1F', domainCode: 'hall', category: 'misc',
  gatewayCode: '', relayChannel: 1, meterAddress: null,
  ratedVoltage: 220, ratedCurrent: 16, ratedPower: 0,
  sortOrder: 100, icon: 'Zap', description: '', enabled: true,
});

const rules: FormRules = {
  code: [{ required: true, message: 'code 必填', trigger: 'blur' }],
  name: [{ required: true, message: '显示名必填', trigger: 'blur' }],
  domainCode: [{ required: true, message: '所属区域必填', trigger: 'change' }],
  floor: [{ required: true, message: '楼层必填', trigger: 'blur' }],
  category: [{ required: true, message: '类型必填', trigger: 'change' }],
};

const selectedController = computed(() =>
  controllerHardware.value.find((item) => item.code === form.gatewayCode) ?? null,
);
const breakerSelected = computed(() =>
  selectedController.value?.category === 'power-breaker' ||
  selectedController.value?.category === 'power-breaker-4g' ||
  selectedController.value?.category === 'power-breaker-web',
);

function onControllerChange(): void {
  if (breakerSelected.value) form.relayChannel = null;
  else if (form.relayChannel == null) form.relayChannel = 1;
}

function openCreate(): void {
  editMode.value = 'create';
  Object.assign(form, {
    id: undefined,
    code: '', name: '', floor: '1F',
    domainCode: domainFilter.value || enabledDomains.value[0]?.code || 'hall',
    category: 'misc',
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
    code: row.code, name: row.name, floor: row.floor,
    domainCode: row.domainCode || 'hall', category: row.category,
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
      domainCode: form.domainCode || 'hall',
      category: form.category,
      gatewayCode: (form.gatewayCode || '').trim() || null,
      relayChannel: breakerSelected.value ? null : Number(form.relayChannel ?? 1) || null,
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
// 规则抽屉/弹窗已抽到共享组件 PowerScheduleDrawer，本页（hardware）与
// 「日常运行 → 自动开关」（config 运营）共用同一套时间规则，写接口走 power-schedules。
const schedRef = ref<InstanceType<typeof PowerScheduleDrawer> | null>(null);

function openSchedules(row: PowerCircuitView): void {
  schedRef.value?.open(row);
}

// ============ 域管理（第五轮，仅 admin：新增/改名/启停/删除）============
const domainVisible = ref(false);
const dEditing = ref<PowerDomainView | null>(null);
const dForm = reactive({ code: '', name: '', sortOrder: 100, description: '', enabled: true });

function resetDForm(): void {
  Object.assign(dForm, {
    code: '', name: '',
    sortOrder: (domains.value.length + 1) * 10,
    description: '', enabled: true,
  });
  dEditing.value = null;
}
function openDomainMgr(): void {
  domainVisible.value = true;
  resetDForm();
  void loadGrants();
}

// ===== 角色 × 区域授权（三态：隐藏 / 可见 / 操作；admin/hardware 全域锁定）=====
const grantMatrix = ref<PowerDomainGrantMatrix | null>(null);
const grantEdit = reactive<Record<string, Record<string, number>>>({});
const grantSaving = ref(false);
const grantDomains = computed(() => (grantMatrix.value?.domains ?? []).filter((d) => d.enabled));

async function loadGrants(): Promise<void> {
  try {
    const m = await powerDomainGrantService.get();
    grantMatrix.value = m;
    for (const k of Object.keys(grantEdit)) delete grantEdit[k];
    for (const r of m.roles) {
      grantEdit[r.role] = {};
      for (const d of m.domains) {
        const cell = m.grants.find((g) => g.role === r.role && g.domainCode === d.code);
        grantEdit[r.role][d.code] = cell?.canWrite ? 2 : cell?.canRead ? 1 : 0;
      }
    }
  } catch (err) {
    ElMessage.error(`加载角色权限失败: ${(err as Error).message}`);
  }
}

async function saveGrants(): Promise<void> {
  if (!grantMatrix.value) return;
  grantSaving.value = true;
  try {
    const grants = grantMatrix.value.roles.flatMap((r) =>
      grantDomains.value
        .map((d) => {
          const lv = grantEdit[r.role]?.[d.code] ?? 0;
          return { role: r.role, domainCode: d.code, canRead: lv >= 1, canWrite: lv === 2 };
        })
        .filter((g) => g.canRead),
    );
    await powerDomainGrantService.save(grants);
    ElMessage.success('角色区域权限已保存');
    await loadGrants();
    await refresh();
  } catch (err) {
    ElMessage.error(`保存角色权限失败: ${(err as Error).message}`);
  } finally {
    grantSaving.value = false;
  }
}
function editDomain(d: PowerDomainView): void {
  dEditing.value = d;
  Object.assign(dForm, {
    code: d.code, name: d.name, sortOrder: d.sortOrder,
    description: d.description ?? '', enabled: d.enabled,
  });
}
async function submitDomain(): Promise<void> {
  const name = dForm.name.trim();
  if (!name) { ElMessage.warning('请填写区域名称'); return; }
  try {
    if (dEditing.value) {
      // code 是唯一标识不可改；只改名称/排序/描述/启停。
      await powerDomainsService.update(dEditing.value.id, {
        name,
        sortOrder: Number(dForm.sortOrder) || 100,
        description: dForm.description.trim() || null,
        enabled: dForm.enabled,
      });
      ElMessage.success('已更新区域');
    } else {
      const code = dForm.code.trim();
      if (!code) { ElMessage.warning('请填写区域 code'); return; }
      await powerDomainsService.create({
        code, name,
        sortOrder: Number(dForm.sortOrder) || 100,
        description: dForm.description.trim() || null,
        enabled: dForm.enabled,
      });
      ElMessage.success('已新增区域');
    }
    resetDForm();
    await refresh();
  } catch (err) {
    ElMessage.error(`保存区域失败: ${(err as Error).message}`);
  }
}
async function toggleDomainEnabled(d: PowerDomainView): Promise<void> {
  try {
    await powerDomainsService.update(d.id, { enabled: !d.enabled });
    await refresh();
  } catch (err) {
    ElMessage.error(`切换失败: ${(err as Error).message}`);
  }
}
async function removeDomain(d: PowerDomainView): Promise<void> {
  if (BUILTIN_DOMAIN.includes(d.code)) {
    ElMessage.warning('内置区域（展厅 / 园区）不可删除');
    return;
  }
  if ((d.circuitCount ?? 0) > 0) {
    ElMessage.warning(`该区域下还有 ${d.circuitCount} 条回路，请先迁移到其它区域后再删除`);
    return;
  }
  try {
    await ElMessageBox.confirm(
      `删除区域 "${d.name}" (${d.code})？删除后该区域不再出现在授权与回路归属中。`,
      '确认删除区域',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
    );
  } catch { return; }
  try {
    await powerDomainsService.remove(d.id);
    ElMessage.success('已删除区域');
    await refresh();
  } catch (err) {
    ElMessage.error(`删除区域失败: ${(err as Error).message}`);
  }
}

onMounted(refresh);
</script>

<template>
  <section class="circuits-admin">
    <header class="page-head">
      <h2>电源回路</h2>
      <el-select v-model="domainFilter" placeholder="全部区域" clearable class="domain-sel" @change="floorFilter = ''">
        <el-option v-for="d in enabledDomains" :key="d.code" :label="d.name" :value="d.code" />
      </el-select>
      <el-select v-model="floorFilter" placeholder="全部楼层" clearable class="floor-sel">
        <el-option v-for="f in floorOptions" :key="f" :label="f" :value="f" />
      </el-select>
      <el-input v-model="search" placeholder="搜索名称 / code / 继电器" clearable class="search-inp" />
      <el-button type="primary" class="head-add" @click="openCreate">新增回路</el-button>
      <el-button type="primary" class="domain-entry" @click="openDomainMgr">
        <LayoutGrid :size="15" :stroke-width="2.4" />
        <span>区域管理</span>
      </el-button>
      <el-button @click="refresh" :loading="loading">刷新</el-button>
    </header>
    <p class="sub">
      每条回路绑定一台控制设备。多路继电器/时序器还需选择通道；485 或 4G 智能断路器本身就是独立回路，无需通道号。
    </p>

    <AppSkeleton v-if="loading && filtered.length === 0" variant="table" :rows="8" />
    <el-table v-else :data="filtered" v-loading="loading" stripe class="circuits-table">
      <el-table-column label="名称" min-width="150">
        <template #default="{ row }">
          <div class="name-cell">
            <div class="name-row">
              <span class="circuit-name">{{ row.name }}</span>
              <span class="domain-tag" :data-domain="row.domainCode">{{ domainName(row.domainCode) }}</span>
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
      <el-table-column label="控制设备" min-width="150">
        <template #default="{ row }">
          <code v-if="row.gatewayCode" class="gw-code">
            {{ row.gatewayCode }}<template v-if="!row.isBreaker"> · CH{{ row.relayChannel ?? '?' }}</template>
          </code>
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
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" @click="openEdit(row)">编辑</el-button>
          <el-button v-if="row.isBreaker" link type="success" @click="openSchedules(row)">自动开关</el-button>
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
        <el-form-item label="所属区域" prop="domainCode">
          <el-select v-model="form.domainCode" style="width: 200px;" placeholder="选择区域">
            <el-option v-for="d in enabledDomains" :key="d.code" :label="d.name" :value="d.code" />
          </el-select>
          <div class="hint inline">展厅 / 园区 / 新楼栋；不同角色只可操作被授权区域的开关。</div>
        </el-form-item>
        <el-form-item label="楼层" prop="floor">
          <el-input v-model="form.floor" placeholder="1F / 2F / 音响 / 园区" style="width: 160px;" />
        </el-form-item>
        <el-form-item label="类型" prop="category">
          <el-select v-model="form.category" style="width: 200px;">
            <el-option v-for="c in CATEGORIES" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="控制设备">
          <el-select
            v-model="form.gatewayCode"
            filterable
            clearable
            allow-create
            default-first-option
            placeholder="从硬件清单选择"
            style="width:100%;"
            @change="onControllerChange"
          >
            <el-option
              v-for="item in controllerHardware"
              :key="item.code"
              :value="item.code"
              :label="`${item.name} (${item.code})`"
            >
              <span>{{ item.name }}</span>
              <span class="option-hint">{{ item.code }} · {{ item.category }}</span>
            </el-option>
          </el-select>
          <div class="hint">设备先在“硬件清单”登记；留空时不会向真实设备下发。</div>
        </el-form-item>
        <el-form-item v-if="!breakerSelected" label="通道号">
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

    <!-- ============ 电源区域（域）管理：新增/改名/启停/删除，仅 admin ============ -->
    <el-dialog v-model="domainVisible" title="电源区域管理" width="660px">
      <el-form :model="dForm" label-width="84px" class="dm-form">
        <el-form-item label="区域 code">
          <el-input
            v-model="dForm.code"
            :disabled="!!dEditing"
            placeholder="小写字母 / 数字 / 连字符，如 building-b"
          />
          <span v-if="!dEditing" class="hint inline">保存后不可改；仅允许小写字母、数字与连字符。</span>
        </el-form-item>
        <el-form-item label="区域名称">
          <el-input v-model="dForm.name" placeholder="如：B 栋 / 西展厅 / 室外景观区" />
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="dForm.sortOrder" :min="0" :max="9999" controls-position="right" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="dForm.description" placeholder="可选" />
        </el-form-item>
        <el-form-item label="启用">
          <el-switch v-model="dForm.enabled" />
          <span class="hint inline">停用后不出现在回路归属与角色可见区域中。</span>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="submitDomain">{{ dEditing ? '保存修改' : '新增区域' }}</el-button>
          <el-button v-if="dEditing" @click="resetDForm">取消编辑</el-button>
        </el-form-item>
      </el-form>

      <el-divider content-position="left">现有区域</el-divider>
      <el-table :data="domains" size="small" stripe class="dm-table">
        <el-table-column label="名称" prop="name" min-width="110" />
        <el-table-column label="code" width="130">
          <template #default="{ row }"><code class="gw-code">{{ row.code }}</code></template>
        </el-table-column>
        <el-table-column label="回路数" width="70" align="center">
          <template #default="{ row }">{{ row.circuitCount ?? 0 }}</template>
        </el-table-column>
        <el-table-column label="排序" prop="sortOrder" width="64" align="center" />
        <el-table-column label="启用" width="66" align="center">
          <template #default="{ row }">
            <el-switch
              :model-value="row.enabled"
              :disabled="BUILTIN_DOMAIN.includes(row.code)"
              @change="toggleDomainEnabled(row)"
            />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="120" align="center">
          <template #default="{ row }">
            <el-button link type="primary" @click="editDomain(row)">编辑</el-button>
            <el-button
              link
              type="danger"
              :disabled="BUILTIN_DOMAIN.includes(row.code)"
              @click="removeDomain(row)"
            >删除</el-button>
          </template>
        </el-table-column>
      </el-table>
      <p class="hint dm-note">
        内置「展厅 / 园区」不可删除；新增区域默认对运营配置员、展厅操作员、观察者不开放（最小权限），
        硬件工程师与管理员可全域排障。区域下仍有回路时不可删除。
      </p>
      <el-divider content-position="left">角色区域权限</el-divider>
      <p class="hint dm-note">
        <b>隐藏</b>＝看不到该区域；<b>可见</b>＝能看状态但不能操作；<b>操作</b>＝可开关。
        管理员、硬件工程师固定全域排障，不可修改；以后新增角色会自动出现在下方。
      </p>
      <div v-loading="!grantMatrix" class="grant-scroll">
        <table class="grant-table">
          <thead>
            <tr>
              <th class="gt-role">角色</th>
              <th v-for="d in grantDomains" :key="d.code" class="gt-domain">{{ d.name }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="lk in grantMatrix?.lockedRoles ?? []" :key="'lk-' + lk.role" class="gt-locked-row">
              <td class="gt-role">{{ lk.label }}</td>
              <td :colspan="grantDomains.length" class="gt-locked-cell">
                <el-tag size="small" type="info" effect="plain">全域（锁定，不可修改）</el-tag>
              </td>
            </tr>
            <tr v-for="r in grantMatrix?.roles ?? []" :key="r.role">
              <td class="gt-role">{{ r.label }}<span v-if="!r.builtin" class="gt-custom">自定义</span></td>
              <td v-for="d in grantDomains" :key="d.code" class="gt-cell">
                <el-radio-group v-model="grantEdit[r.role][d.code]" size="small">
                  <el-radio-button :value="0">隐藏</el-radio-button>
                  <el-radio-button :value="1">可见</el-radio-button>
                  <el-radio-button :value="2">操作</el-radio-button>
                </el-radio-group>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="grant-actions">
        <el-button type="primary" :loading="grantSaving" @click="saveGrants">保存角色权限</el-button>
      </div>
    </el-dialog>

    <!-- 自动开关规则（定时/日落/日出）抽屉 + 编辑弹窗：共享组件，hardware 与 config 共用 -->
    <PowerScheduleDrawer ref="schedRef" />
  </section>
</template>

<style scoped>
.circuits-admin { padding: 16px 24px; color: var(--v2-text-1); }
.page-head {
  display: flex; align-items: center; gap: 10px;
  flex-wrap: wrap; margin-bottom: 10px;
}
.page-head h2 { margin: 0 6px 0 0; font-size: 20px; color: var(--v2-text-1); white-space: nowrap; }
.domain-sel { width: 124px; }
.floor-sel { width: 120px; }
.search-inp { width: 220px; }
.head-add { margin-left: auto; }
/* 区域管理是"分区划分 + 角色授权"的核心入口, 比普通操作按钮更醒目:
   渐变实底 + 图标 + 辉光, 与"新增回路"的普通蓝实心区分开 */
.domain-entry {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-weight: 700;
  letter-spacing: 1px;
  color: #fff;
  border: none;
  background: linear-gradient(135deg, #4d8dff 0%, #7c5cff 100%);
  box-shadow: 0 4px 14px -4px rgba(99, 110, 255, 0.65), inset 0 1px 0 rgba(255, 255, 255, 0.18);
  transition: all 0.18s ease;
}
.domain-entry:hover,
.domain-entry:focus {
  color: #fff;
  border: none;
  background: linear-gradient(135deg, #5a96ff 0%, #8b6dff 100%);
  box-shadow: 0 6px 18px -4px rgba(99, 110, 255, 0.8), inset 0 1px 0 rgba(255, 255, 255, 0.22);
  transform: translateY(-1px);
}
.sub { color: var(--v2-text-2); margin: 0 0 14px; font-size: 13px; max-width: 720px; line-height: 1.6; }

.name-cell { display: flex; flex-direction: column; gap: 3px; }
.name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.floor-tag {
  font-size: 11px; font-weight: 500;
  padding: 0 7px; line-height: 18px; border-radius: 9px;
  background: rgba(76, 154, 255, 0.12); color: #67E8F9;
  white-space: nowrap; flex-shrink: 0;
}
/* 域标签（第五轮）：展厅=青蓝、园区=琥珀，与楼层标签区分 */
.domain-tag {
  font-size: 11px; font-weight: 700;
  padding: 0 7px; line-height: 18px; border-radius: 9px;
  white-space: nowrap; flex-shrink: 0; letter-spacing: 0.5px;
  background: rgba(244, 180, 80, 0.16); color: #F0B35C;
  border: 1px solid rgba(244, 180, 80, 0.4);
}
.domain-tag[data-domain="hall"] {
  background: rgba(76, 154, 255, 0.14); color: #7CC4FF;
  border-color: rgba(76, 154, 255, 0.4);
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
.option-hint { float: right; color: var(--v2-text-3); font-size: 12px; margin-left: 16px; }

/* 区域管理弹窗 */
.dm-form { margin-top: 6px; }
.dm-table { margin-top: 4px; }
.dm-note { margin: 12px 2px 0; line-height: 1.6; }
/* 角色×域授权矩阵 */
.grant-scroll { overflow-x: auto; margin-top: 8px; }
.grant-table { border-collapse: collapse; width: 100%; font-size: 13px; }
.grant-table th, .grant-table td {
  border: 1px solid var(--el-border-color-lighter);
  padding: 8px 10px;
  text-align: center;
  vertical-align: middle;
}
.grant-table thead th {
  background: var(--el-fill-color-light);
  font-weight: 600;
  color: var(--el-text-color-regular);
}
.gt-role { text-align: left; white-space: nowrap; font-weight: 600; min-width: 104px; }
.gt-custom {
  margin-left: 6px; font-size: 11px; font-weight: 500;
  color: var(--el-color-warning);
  border: 1px solid var(--el-color-warning-light-5);
  border-radius: 4px; padding: 0 4px;
}
.gt-cell { white-space: nowrap; }
.gt-locked-row td { background: var(--el-fill-color-lighter); }
.gt-locked-cell { text-align: left !important; }
.grant-actions { margin-top: 14px; text-align: right; }
@media (max-width: 600px) {
  .grant-table { font-size: 12px; }
  .grant-table th, .grant-table td { padding: 6px 6px; }
  .gt-role { min-width: 84px; }
  .gt-cell :deep(.el-radio-group) {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
  }
  .gt-cell :deep(.el-radio-button) { display: block; }
  .gt-cell :deep(.el-radio-button__inner) {
    display: block;
    width: 100%;
    margin-left: 0 !important;
    padding: 5px 8px;
    border-radius: 6px !important;
    box-shadow: none !important;
  }
}
</style>
