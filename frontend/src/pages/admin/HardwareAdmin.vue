<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import AppSkeleton from '@/components/AppSkeleton.vue';
import {
  Cable, Cpu, Lightbulb, MonitorPlay, Network, Plus, RefreshCw, Server,
  Speaker, Snowflake, Tablet, Trash2, Zap, Pencil,
} from 'lucide-vue-next';
import {
  adminHardwareService,
  type HardwareCreatePayload,
} from '@/services/admin.service';
import { driverService, type DriverTemplate } from '@/services/driver.service';
import { usePermissionStore } from '@/stores/permission';
import {
  HARDWARE_CATEGORIES,
  type HardwareCategory,
  type HardwareStatus,
  type HardwareSummary,
  type HardwareUnit,
} from '@/types/api';

const perm = usePermissionStore();
const loading = ref(false);
const rows = ref<HardwareUnit[]>([]);
const summary = ref<HardwareSummary | null>(null);

const categoryMeta: Record<HardwareCategory, { label: string; icon: unknown; color: string }> = {
  'dali-gateway':       { label: 'DALI 网关/调光控制器', icon: Cable,       color: '#4C9AFF' },
  'led-driver':         { label: 'LED 灯具驱动器', icon: Lightbulb,   color: '#E0A030' },
  'dali-converter':     { label: 'DALI→0-10V 转换器', icon: Cable,    color: '#facc15' },
  'dali-dimmer':        { label: '[废弃] DALI 调光器模块', icon: Lightbulb, color: '#94a3b8' },
  'rtu-tcp-converter':  { label: 'RTU↔TCP 转换器', icon: Network,     color: '#3FBF87' },
  'led-controller':     { label: 'LED 控制器',    icon: MonitorPlay, color: '#9BA1A9' },
  'led-player':         { label: 'LED 播控主机',  icon: Cpu,         color: '#9BA1A9' },
  'audio-dsp':          { label: '音响 DSP',      icon: Speaker,     color: '#9BA1A9' },
  'audio-guide':        { label: '分区跟随导览',  icon: Speaker,     color: '#9BA1A9' },
  'audio-power':        { label: '音响时序器',    icon: Zap,         color: '#fb923c' },
  'hvac-outdoor':       { label: '空调外机',      icon: Snowflake,   color: '#0891b2' },
  'hvac-gateway':       { label: '空调网关',      icon: Snowflake,   color: '#06b6d4' },
  'power-relay':        { label: '强电继电器',    icon: Zap,         color: '#eab308' },
  'tablet':             { label: '控制平板',      icon: Tablet,      color: '#64748b' },
  'switch':             { label: '交换机',        icon: Network,     color: '#475569' },
  'router':             { label: '路由器',        icon: Network,     color: '#475569' },
  'ups':                { label: '不间断电源',    icon: Zap,         color: '#f97316' },
  'other':              { label: '其它',          icon: Server,      color: '#94a3b8' },
};

const statusMeta: Record<HardwareStatus, { label: string; cls: string }> = {
  normal:      { label: '正常',   cls: 'is-on' },
  fault:       { label: '故障',   cls: 'is-error' },
  offline:     { label: '离线',   cls: 'is-off' },
  maintenance: { label: '维护中', cls: 'is-warning' },
  retired:     { label: '已退役', cls: 'is-off' },
};

const activeCategory = ref<HardwareCategory | 'all'>('all');
const filtered = computed(() =>
  activeCategory.value === 'all'
    ? rows.value
    : rows.value.filter((r) => r.category === activeCategory.value),
);

const countByCategory = computed(() => {
  const m: Record<string, number> = {};
  for (const r of rows.value) m[r.category] = (m[r.category] ?? 0) + 1;
  return m;
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [list, s] = await Promise.all([
      adminHardwareService.list(),
      adminHardwareService.summary(),
    ]);
    rows.value = list.list;
    summary.value = s;
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const formRef = ref<FormInstance>();
const form = reactive<HardwareCreatePayload & { id?: number }>({
  code: '',
  name: '',
  category: 'other',
  vendor: '',
  model: '',
  driverKind: '',
  serialNo: '',
  firmwareVersion: '',
  location: '',
  floor: '',
  ip: '',
  macAddress: '',
  addressing: '',
  channels: '',
  status: 'normal',
  enabled: true,
  remark: '',
  installedAt: '',
});

// P3: 驱动模板下拉数据 (从 /api/drivers 拉)
const drivers = ref<DriverTemplate[]>([]);
const driversLoaded = ref(false);
async function ensureDriversLoaded(): Promise<void> {
  if (driversLoaded.value) return;
  try {
    drivers.value = await driverService.list();
  } catch (err) {
    // 后台没起或表还没建, 不阻塞表单
    // eslint-disable-next-line no-console
    console.warn('加载驱动模板列表失败:', (err as Error).message);
  } finally {
    driversLoaded.value = true;
  }
}

/** 当前选中的驱动模板对象 (用于显示能力 / 备注 / 自动填默认 addressing) */
const selectedDriver = computed<DriverTemplate | null>(() => {
  if (!form.driverKind) return null;
  return drivers.value.find((d) => d.kind === form.driverKind) ?? null;
});

/** 用户选了一个驱动模板 → 把默认 addressing 字段填进去 (只覆盖空白字段, 不覆盖用户已填的) */
function onDriverPick(kind: string): void {
  form.driverKind = kind;
  const drv = drivers.value.find((d) => d.kind === kind);
  if (!drv) return;
  // 自动填 vendor / category, 用户也可以改
  if (!form.vendor && drv.vendor) form.vendor = drv.vendor;
  if (drv.category && form.category === 'other') {
    form.category = drv.category as typeof form.category;
  }
  // 默认 addressing 字段填空白处
  const def = drv.defaultAddressing ?? {};
  if (typeof def.slaveId === 'number' && addressingFields.slaveId == null) {
    addressingFields.slaveId = def.slaveId;
  }
  if (typeof def.port === 'number' && addressingFields.port == null) {
    addressingFields.port = def.port;
  }
  if (typeof def.tcpPort === 'number' && addressingFields.port == null) {
    addressingFields.port = def.tcpPort as number;
  }
  if (typeof def.baud === 'number' && addressingFields.baud == null) {
    addressingFields.baud = def.baud;
  }
  if (typeof def.frameIntervalMs === 'number' && addressingFields.frameIntervalMs == null) {
    addressingFields.frameIntervalMs = def.frameIntervalMs;
  }
  if (typeof def.daliStart === 'number' && addressingFields.daliStart == null) {
    addressingFields.daliStart = def.daliStart;
  }
  if (typeof def.daliCount === 'number' && addressingFields.daliCount == null) {
    addressingFields.daliCount = def.daliCount;
  }
}

// 结构化的"寻址"字段, 替代裸 JSON. 提交前序列化回 form.addressing.
interface AddressingFields {
  slaveId?: number;        // Modbus 从机地址 1-247
  baud?: number;           // 波特率
  frameIntervalMs?: number;
  port?: number;           // TCP 端口
  daliStart?: number;      // 多通道驱动器起始短地址
  daliCount?: number;      // 占用短地址数
}
const addressingFields = reactive<AddressingFields>({});
const BAUD_OPTIONS = [4800, 9600, 19200, 38400, 57600, 115200];

// 结构化的"通道"字段, 数组形式
interface ChannelRow {
  ch?: number;
  daliShort?: number;
  daliGroup?: number;
  label?: string;
  powerW?: number;
}
const channelsArr = reactive<ChannelRow[]>([]);

function parseAddressing(json: string | null | undefined): AddressingFields {
  if (!json) return {};
  try {
    const o = JSON.parse(json);
    return {
      slaveId: typeof o.slaveId === 'number' ? o.slaveId : undefined,
      baud: typeof o.baud === 'number' ? o.baud : undefined,
      frameIntervalMs: typeof o.frameIntervalMs === 'number' ? o.frameIntervalMs : undefined,
      port: typeof o.port === 'number' ? o.port : undefined,
      daliStart: typeof o.daliStart === 'number' ? o.daliStart : undefined,
      daliCount: typeof o.daliCount === 'number' ? o.daliCount : undefined,
    };
  } catch { return {}; }
}
function serializeAddressing(f: AddressingFields): string | undefined {
  const o: Record<string, number> = {};
  if (f.slaveId != null) o.slaveId = f.slaveId;
  if (f.baud != null) o.baud = f.baud;
  if (f.frameIntervalMs != null) o.frameIntervalMs = f.frameIntervalMs;
  if (f.port != null) o.port = f.port;
  if (f.daliStart != null) o.daliStart = f.daliStart;
  if (f.daliCount != null) o.daliCount = f.daliCount;
  return Object.keys(o).length === 0 ? undefined : JSON.stringify(o);
}

function parseChannels(json: string | null | undefined): ChannelRow[] {
  if (!json) return [];
  try {
    const arr = JSON.parse(json);
    if (!Array.isArray(arr)) return [];
    return arr.map((r: Record<string, unknown>) => ({
      ch: typeof r.ch === 'number' ? r.ch : undefined,
      daliShort: typeof r.daliShort === 'number' ? r.daliShort : undefined,
      daliGroup: typeof r.daliGroup === 'number' ? r.daliGroup : undefined,
      label: typeof r.label === 'string' ? r.label : undefined,
      powerW: typeof r.powerW === 'number' ? r.powerW : undefined,
    }));
  } catch { return []; }
}
function serializeChannels(rows: ChannelRow[]): string | undefined {
  const clean = rows
    .filter((r) => r.ch != null || r.daliShort != null || r.daliGroup != null || r.label || r.powerW != null)
    .map((r) => {
      const o: Record<string, unknown> = {};
      if (r.ch != null) o.ch = r.ch;
      if (r.daliShort != null) o.daliShort = r.daliShort;
      if (r.daliGroup != null) o.daliGroup = r.daliGroup;
      if (r.label) o.label = r.label;
      if (r.powerW != null) o.powerW = r.powerW;
      return o;
    });
  return clean.length === 0 ? undefined : JSON.stringify(clean);
}

function addChannelRow(): void {
  const nextCh = channelsArr.length === 0 ? 1 : Math.max(...channelsArr.map((r) => r.ch ?? 0)) + 1;
  channelsArr.push({ ch: nextCh });
}
function removeChannelRow(idx: number): void {
  channelsArr.splice(idx, 1);
}

const rules: FormRules = {
  code: [{ required: true, message: '编号不能为空', trigger: 'blur' }],
  name: [{ required: true, message: '名称不能为空', trigger: 'blur' }],
  category: [{ required: true, message: '必选类别', trigger: 'change' }],
  vendor: [{ required: true, message: '厂商必填', trigger: 'blur' }],
  model: [{ required: true, message: '型号必填', trigger: 'blur' }],
};

function syncStructuredFromForm(): void {
  // 把 form.addressing / form.channels (JSON) 同步到结构化 state
  const a = parseAddressing(form.addressing);
  addressingFields.slaveId = a.slaveId;
  addressingFields.baud = a.baud;
  addressingFields.frameIntervalMs = a.frameIntervalMs;
  addressingFields.port = a.port;
  addressingFields.daliStart = a.daliStart;
  addressingFields.daliCount = a.daliCount;
  channelsArr.splice(0, channelsArr.length, ...parseChannels(form.channels));
}

function openCreate(): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  void ensureDriversLoaded();
  dialogMode.value = 'create';
  Object.assign(form, {
    id: undefined, code: '', name: '', category: 'other', vendor: '', model: '', driverKind: '',
    serialNo: '', firmwareVersion: '', location: '', floor: '', ip: '', macAddress: '',
    addressing: '', channels: '', status: 'normal', enabled: true, remark: '', installedAt: '',
  });
  syncStructuredFromForm();
  dialogVisible.value = true;
}

function openEdit(row: HardwareUnit): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  void ensureDriversLoaded();
  dialogMode.value = 'edit';
  Object.assign(form, {
    id: row.id,
    code: row.code, name: row.name, category: row.category,
    vendor: row.vendor, model: row.model,
    driverKind: row.driverKind ?? '',
    serialNo: row.serialNo ?? '', firmwareVersion: row.firmwareVersion ?? '',
    location: row.location ?? '', floor: row.floor ?? '',
    ip: row.ip ?? '', macAddress: row.macAddress ?? '',
    addressing: row.addressing ?? '', channels: row.channels ?? '',
    status: row.status, enabled: row.enabled,
    remark: row.remark ?? '', installedAt: row.installedAt ?? '',
  });
  syncStructuredFromForm();
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    try {
      // 提交前把结构化 state 序列化回 JSON
      const addressingJson = serializeAddressing(addressingFields);
      const channelsJson = serializeChannels(channelsArr);
      const payload: HardwareCreatePayload = {
        code: form.code, name: form.name, category: form.category,
        vendor: form.vendor, model: form.model,
        driverKind: form.driverKind || undefined,
        serialNo: form.serialNo || undefined,
        firmwareVersion: form.firmwareVersion || undefined,
        location: form.location || undefined,
        floor: form.floor || undefined,
        ip: form.ip || undefined,
        macAddress: form.macAddress || undefined,
        addressing: addressingJson,
        channels: channelsJson,
        status: form.status, enabled: form.enabled,
        remark: form.remark || undefined,
        installedAt: form.installedAt || undefined,
      };
      if (dialogMode.value === 'create') {
        await adminHardwareService.create(payload);
        ElMessage.success('已添加');
      } else if (form.id) {
        await adminHardwareService.update(form.id, payload);
        ElMessage.success('已更新');
      }
      dialogVisible.value = false;
      await refresh();
    } catch (err) {
      ElMessage.error('保存失败: ' + (err as Error).message);
    }
  });
}

async function remove(row: HardwareUnit): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await ElMessageBox.confirm(`删除硬件 ${row.code} (${row.name})?`, '确认', { type: 'warning' });
    await adminHardwareService.remove(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (err) {
    if ((err as Error).message !== 'cancel') {
      ElMessage.error('删除失败: ' + (err as Error).message);
    }
  }
}


onMounted(refresh);
</script>

<template>
  <section class="page">
    <header class="page-head">
      <div class="sc-head-ico"><Server :size="22" :stroke-width="1.75" /></div>
      <div style="flex:1;">
        <h2 class="sc-title">硬件清单</h2>
        <div class="sc-subtle">现场物理设备登记 · 故障定位 · 接线追踪</div>
      </div>
      <button class="sc-touch sc-act sc-act-neutral" style="min-height:42px; padding:0 16px;" @click="refresh">
        <RefreshCw :size="16" :stroke-width="2" /> 刷新
      </button>
      <button class="sc-touch sc-act sc-act-primary" style="min-height:42px; padding:0 16px;" @click="openCreate">
        <Plus :size="16" :stroke-width="2" /> 新增
      </button>
    </header>

    <!-- 类别统计卡片 -->
    <div v-if="summary" class="stat-grid">
      <div class="stat-card stat-total">
        <div class="stat-label">总数</div>
        <div class="stat-value">{{ summary.total }}</div>
        <div class="stat-sub">已启用 {{ summary.enabled }}</div>
      </div>
      <div class="stat-card" :class="{ alert: summary.fault > 0 }">
        <div class="stat-label">故障</div>
        <div class="stat-value">{{ summary.fault }}</div>
      </div>
      <div class="stat-card" :class="{ alert: summary.offline > 0 }">
        <div class="stat-label">离线</div>
        <div class="stat-value">{{ summary.offline }}</div>
      </div>
      <div class="stat-card stat-categories">
        <div class="stat-label">分类</div>
        <div class="cat-chips">
          <span
            v-for="cat in HARDWARE_CATEGORIES"
            :key="cat"
            v-show="(summary.byCategory[cat] ?? 0) > 0"
            class="cat-chip"
          >
            <component :is="categoryMeta[cat].icon" :size="13" :stroke-width="2" />
            {{ categoryMeta[cat].label }} <b>{{ summary.byCategory[cat] }}</b>
          </span>
        </div>
      </div>
    </div>

    <!-- 类别筛选 tab -->
    <div class="tabs">
      <button
        class="tab"
        :class="{ active: activeCategory === 'all' }"
        @click="activeCategory = 'all'"
      >
        全部 ({{ rows.length }})
      </button>
      <button
        v-for="cat in HARDWARE_CATEGORIES"
        :key="cat"
        v-show="(countByCategory[cat] ?? 0) > 0"
        class="tab"
        :class="{ active: activeCategory === cat }"
        @click="activeCategory = cat"
      >
        <component :is="categoryMeta[cat].icon" :size="14" :stroke-width="2" />
        {{ categoryMeta[cat].label }} ({{ countByCategory[cat] }})
      </button>
    </div>

    <!-- 列表 -->
    <AppSkeleton v-if="loading && filtered.length === 0" variant="table" :rows="8" />
    <el-table v-else :data="filtered" v-loading="loading" stripe size="default" style="width:100%;">
      <el-table-column label="编号" prop="code" width="170">
        <template #default="{ row }">
          <code class="code-cell">{{ row.code }}</code>
        </template>
      </el-table-column>
      <el-table-column label="名称" min-width="220">
        <template #default="{ row }">
          <div class="name-cell">
            <component
              :is="categoryMeta[row.category as HardwareCategory].icon"
              :size="16"
              :stroke-width="1.75"
              :style="{ color: categoryMeta[row.category as HardwareCategory].color }"
            />
            <div>
              <div class="name">{{ row.name }}</div>
              <div class="sub">{{ row.vendor }} · {{ row.model }}</div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="楼层 / 位置" min-width="180">
        <template #default="{ row }">
          <div class="sub-text">{{ row.floor || '—' }}</div>
          <div class="sub">{{ row.location || '—' }}</div>
        </template>
      </el-table-column>
      <el-table-column label="IP" prop="ip" width="140">
        <template #default="{ row }">
          <code v-if="row.ip" class="code-cell">{{ row.ip }}</code>
          <span v-else class="sub">—</span>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="100">
        <template #default="{ row }">
          <span class="sc-status" :class="statusMeta[row.status as HardwareStatus].cls">
            <span class="sc-status-dot" />
            {{ statusMeta[row.status as HardwareStatus].label }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="160" align="right">
        <template #default="{ row }">
          <button class="row-btn" @click="openEdit(row)">
            <Pencil :size="14" :stroke-width="2" /> 编辑
          </button>
          <button class="row-btn row-btn-danger" @click="remove(row)">
            <Trash2 :size="14" :stroke-width="2" /> 删除
          </button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 编辑对话框 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增硬件' : '编辑硬件'"
      width="720px"
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" label-position="right">
        <el-form-item label="编号" prop="code">
          <el-input v-model="form.code" placeholder="DA4D-001 / GW-DALI-1 ..." />
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="1F 前厅调光器" />
        </el-form-item>
        <el-form-item label="类别" prop="category">
          <el-select v-model="form.category" style="width:100%;">
            <el-option
              v-for="cat in HARDWARE_CATEGORIES"
              :key="cat"
              :value="cat"
              :label="categoryMeta[cat].label"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="驱动模板">
          <el-select
            :model-value="form.driverKind"
            placeholder="选择 → 自动填默认寻址 / 厂商"
            clearable
            filterable
            style="width:100%;"
            @update:model-value="(v: string | null) => (v ? onDriverPick(v) : (form.driverKind = ''))"
          >
            <el-option
              v-for="d in drivers"
              :key="d.kind"
              :value="d.kind"
              :label="d.displayName"
            >
              <span>{{ d.displayName }}</span>
              <span class="opt-hint">{{ d.protocol }} · {{ d.category }}</span>
            </el-option>
          </el-select>
          <div v-if="selectedDriver" class="driver-hint">
            <el-tag size="small" type="info">能力</el-tag>
            <el-tag
              v-for="cap in selectedDriver.capabilities.slice(0, 6)"
              :key="cap"
              size="small"
              class="cap-tag-inline"
            >{{ cap }}</el-tag>
            <span v-if="selectedDriver.capabilities.length > 6" class="muted">
              +{{ selectedDriver.capabilities.length - 6 }}
            </span>
          </div>
        </el-form-item>
        <div class="form-row">
          <el-form-item label="厂商" prop="vendor" style="flex:1;">
            <el-input v-model="form.vendor" placeholder="CTLEDTECH / 元创智控 ..." />
          </el-form-item>
          <el-form-item label="型号" prop="model" style="flex:1;">
            <el-input v-model="form.model" placeholder="DA4-D / CY-DALI64A" />
          </el-form-item>
        </div>
        <div class="form-row">
          <el-form-item label="序列号" style="flex:1;">
            <el-input v-model="form.serialNo" />
          </el-form-item>
          <el-form-item label="固件版本" style="flex:1;">
            <el-input v-model="form.firmwareVersion" placeholder="v1.04" />
          </el-form-item>
        </div>
        <div class="form-row">
          <el-form-item label="楼层" style="flex:1;">
            <el-input v-model="form.floor" placeholder="1F / 2F" />
          </el-form-item>
          <el-form-item label="安装位置" style="flex:2;">
            <el-input v-model="form.location" placeholder="1F 弱电机柜 / 公共电箱 F101 内" />
          </el-form-item>
        </div>
        <div class="form-row">
          <el-form-item label="IP" style="flex:1;">
            <el-input v-model="form.ip" placeholder="192.168.50.20" />
          </el-form-item>
          <el-form-item label="MAC" style="flex:1;">
            <el-input v-model="form.macAddress" />
          </el-form-item>
        </div>
        <el-divider content-position="left">寻址参数 <span class="muted">(只填用得到的, 其它留空)</span></el-divider>
        <div class="form-row">
          <el-form-item label="Modbus 从机地址" style="flex:1;">
            <el-input-number v-model="addressingFields.slaveId" :min="1" :max="247" placeholder="1" controls-position="right" style="width:100%" />
          </el-form-item>
          <el-form-item label="TCP 端口" style="flex:1;">
            <el-input-number v-model="addressingFields.port" :min="1" :max="65535" placeholder="502" controls-position="right" style="width:100%" />
          </el-form-item>
        </div>
        <div class="form-row">
          <el-form-item label="串口波特率" style="flex:1;">
            <el-select v-model="addressingFields.baud" placeholder="选择" clearable style="width:100%">
              <el-option v-for="b in BAUD_OPTIONS" :key="b" :value="b" :label="String(b)" />
            </el-select>
          </el-form-item>
          <el-form-item label="帧间隔 (ms)" style="flex:1;">
            <el-input-number v-model="addressingFields.frameIntervalMs" :min="50" :max="2000" placeholder="200" controls-position="right" style="width:100%" />
          </el-form-item>
        </div>
        <div class="form-row">
          <el-form-item label="DALI 起始短地址" style="flex:1;">
            <el-input-number v-model="addressingFields.daliStart" :min="1" :max="64" placeholder="多通道驱动器用" controls-position="right" style="width:100%" />
          </el-form-item>
          <el-form-item label="占用短地址数" style="flex:1;">
            <el-input-number v-model="addressingFields.daliCount" :min="1" :max="64" placeholder="多通道驱动器用" controls-position="right" style="width:100%" />
          </el-form-item>
        </div>

        <el-divider content-position="left">通道清单 <span class="muted">(多通道驱动器 / 多回路控制器用, 没有就留空)</span></el-divider>
        <div class="channels-editor">
          <el-table :data="channelsArr" size="small" style="width:100%;">
            <el-table-column label="通道 #" width="80">
              <template #default="{ row }">
                <el-input-number v-model="row.ch" :min="1" :max="64" controls-position="right" size="small" style="width:100%" />
              </template>
            </el-table-column>
            <el-table-column label="DALI 短地址" width="120">
              <template #default="{ row }">
                <el-input-number v-model="row.daliShort" :min="1" :max="64" controls-position="right" size="small" style="width:100%" />
              </template>
            </el-table-column>
            <el-table-column label="DALI 组" width="100">
              <template #default="{ row }">
                <el-input-number v-model="row.daliGroup" :min="1" :max="16" controls-position="right" size="small" style="width:100%" />
              </template>
            </el-table-column>
            <el-table-column label="名称">
              <template #default="{ row }">
                <el-input v-model="row.label" size="small" placeholder="前厅灯带 / 重点照明 ..." />
              </template>
            </el-table-column>
            <el-table-column label="功率 (W)" width="100">
              <template #default="{ row }">
                <el-input-number v-model="row.powerW" :min="0" :max="10000" controls-position="right" size="small" style="width:100%" />
              </template>
            </el-table-column>
            <el-table-column label="" width="70">
              <template #default="{ $index }">
                <el-button size="small" type="danger" text @click="removeChannelRow($index)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
          <el-button class="add-ch-btn" size="small" plain @click="addChannelRow">+ 新增通道</el-button>
        </div>
        <div class="form-row">
          <el-form-item label="状态" style="flex:1;">
            <el-select v-model="form.status" style="width:100%;">
              <el-option value="normal" label="正常" />
              <el-option value="fault" label="故障" />
              <el-option value="offline" label="离线" />
              <el-option value="maintenance" label="维护中" />
              <el-option value="retired" label="已退役" />
            </el-select>
          </el-form-item>
          <el-form-item label="启用" style="flex:1;">
            <el-switch v-model="form.enabled" />
          </el-form-item>
          <el-form-item label="安装日期" style="flex:1;">
            <el-input v-model="form.installedAt" placeholder="2026-05-20" />
          </el-form-item>
        </div>
        <el-form-item label="备注">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" @click="submit">保存</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 18px; }
.page-head { display: flex; align-items: center; gap: 14px; }

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
}
.stat-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 14px 18px;
  position: relative;
  overflow: hidden;
}
.stat-card::before {
  content: '';
  position: absolute;
  top: 0; left: 0; right: 0;
  height: 3px;
  background: linear-gradient(90deg, #4C9AFF 0%, #9BA1A9 80%, transparent 100%);
}
.stat-card.alert::before {
  background: linear-gradient(90deg, #E5645D 0%, #dc2626 100%);
}
.stat-card.stat-categories { grid-column: span 2; }
.stat-label { font-size: 12px; color: var(--text-secondary); letter-spacing: 1.5px; text-transform: uppercase; }
.stat-value {
  font-size: 32px; font-weight: 700; margin-top: 4px;
  background: linear-gradient(135deg, #4C9AFF, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
}
.stat-card.alert .stat-value {
  background: linear-gradient(135deg, #E5645D, #E5645D);
  -webkit-background-clip: text;
}
.stat-sub { font-size: 12px; color: var(--text-secondary); margin-top: 2px; }
.cat-chips {
  display: flex; flex-wrap: wrap; gap: 6px;
  margin-top: 8px;
}
.cat-chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px;
  padding: 4px 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-secondary);
}
.cat-chip b { color: var(--text-primary); font-weight: 600; margin-left: 2px; }

.tabs {
  display: flex; gap: 6px; flex-wrap: wrap;
  border-bottom: 1px solid var(--border-soft);
  padding-bottom: 8px;
}
.tab {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-soft);
  border-radius: 10px;
  padding: 6px 12px;
  font-size: 13px;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  font-weight: 500;
  transition: all 0.15s ease;
}
.tab:hover { color: var(--text-primary); border-color: rgba(255, 255, 255, 0.08); }
.tab.active {
  background: linear-gradient(135deg, #4C9AFF 0%, #9BA1A9 100%);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 6px 14px -6px rgba(255, 255, 255, 0.08);
}

.code-cell {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  color: #6BADFF;
  background: rgba(76, 154, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}
.name-cell { display: flex; align-items: center; gap: 10px; }
.name { font-weight: 600; }
.sub { font-size: 12px; color: var(--text-secondary); }
.sub-text { font-size: 13px; }
.addr-cell {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 220px;
}

.row-btn {
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 4px 10px;
  margin-left: 6px;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex; align-items: center; gap: 4px;
  transition: all 0.15s;
}
.row-btn:hover { color: var(--color-primary); border-color: var(--color-primary); }
.row-btn-danger:hover { color: #E5645D; border-color: rgba(229, 100, 93, 0.5); }

.form-row { display: flex; gap: 12px; }

.muted { color: var(--text-secondary); font-weight: 400; font-size: 12px; margin-left: 6px; }
.channels-editor { margin-bottom: 16px; }
.add-ch-btn { margin-top: 8px; width: 100%; }

.opt-hint { color: var(--el-text-color-secondary); font-size: 12px; margin-left: 8px; }
.driver-hint { margin-top: 6px; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.cap-tag-inline { margin: 0; }

@media (max-width: 1280px) {
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .stat-card.stat-categories { grid-column: span 2; }
}
</style>
