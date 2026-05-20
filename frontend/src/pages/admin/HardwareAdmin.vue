<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  Cable, Cpu, Lightbulb, MonitorPlay, Network, Plus, RefreshCw, Server,
  Speaker, Snowflake, Tablet, Trash2, Zap, Pencil,
} from 'lucide-vue-next';
import {
  adminHardwareService,
  type HardwareCreatePayload,
} from '@/services/admin.service';
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
  'dali-gateway':       { label: 'DALI 网关',     icon: Cable,       color: '#3b82f6' },
  'dali-dimmer':        { label: 'DALI 调光器',   icon: Lightbulb,   color: '#f59e0b' },
  'rtu-tcp-converter':  { label: 'RTU↔TCP 转换器', icon: Network,     color: '#10b981' },
  'led-controller':     { label: 'LED 控制器',    icon: MonitorPlay, color: '#8b5cf6' },
  'led-player':         { label: 'LED 播控主机',  icon: Cpu,         color: '#a855f7' },
  'audio-dsp':          { label: '音响 DSP',      icon: Speaker,     color: '#ec4899' },
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

const rules: FormRules = {
  code: [{ required: true, message: '编号不能为空', trigger: 'blur' }],
  name: [{ required: true, message: '名称不能为空', trigger: 'blur' }],
  category: [{ required: true, message: '必选类别', trigger: 'change' }],
  vendor: [{ required: true, message: '厂商必填', trigger: 'blur' }],
  model: [{ required: true, message: '型号必填', trigger: 'blur' }],
  addressing: [
    {
      validator: (_r, v, cb) => {
        if (!v) return cb();
        try { JSON.parse(v); cb(); } catch { cb(new Error('addressing 必须是合法 JSON')); }
      },
      trigger: 'blur',
    },
  ],
  channels: [
    {
      validator: (_r, v, cb) => {
        if (!v) return cb();
        try { JSON.parse(v); cb(); } catch { cb(new Error('channels 必须是合法 JSON')); }
      },
      trigger: 'blur',
    },
  ],
};

function openCreate(): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  dialogMode.value = 'create';
  Object.assign(form, {
    id: undefined, code: '', name: '', category: 'other', vendor: '', model: '',
    serialNo: '', firmwareVersion: '', location: '', floor: '', ip: '', macAddress: '',
    addressing: '', channels: '', status: 'normal', enabled: true, remark: '', installedAt: '',
  });
  dialogVisible.value = true;
}

function openEdit(row: HardwareUnit): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  dialogMode.value = 'edit';
  Object.assign(form, {
    id: row.id,
    code: row.code, name: row.name, category: row.category,
    vendor: row.vendor, model: row.model,
    serialNo: row.serialNo ?? '', firmwareVersion: row.firmwareVersion ?? '',
    location: row.location ?? '', floor: row.floor ?? '',
    ip: row.ip ?? '', macAddress: row.macAddress ?? '',
    addressing: row.addressing ?? '', channels: row.channels ?? '',
    status: row.status, enabled: row.enabled,
    remark: row.remark ?? '', installedAt: row.installedAt ?? '',
  });
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    try {
      const payload: HardwareCreatePayload = {
        code: form.code, name: form.name, category: form.category,
        vendor: form.vendor, model: form.model,
        serialNo: form.serialNo || undefined,
        firmwareVersion: form.firmwareVersion || undefined,
        location: form.location || undefined,
        floor: form.floor || undefined,
        ip: form.ip || undefined,
        macAddress: form.macAddress || undefined,
        addressing: form.addressing || undefined,
        channels: form.channels || undefined,
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

function prettyJson(s: string | null): string {
  if (!s) return '—';
  try { return JSON.stringify(JSON.parse(s), null, 2); } catch { return s; }
}

function channelCount(s: string | null): number {
  if (!s) return 0;
  try {
    const arr = JSON.parse(s);
    return Array.isArray(arr) ? arr.length : 0;
  } catch { return 0; }
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
    <el-table :data="filtered" v-loading="loading" stripe size="default" style="width:100%;">
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
      <el-table-column label="寻址 / 通道" min-width="220">
        <template #default="{ row }">
          <div v-if="row.addressing" class="addr-cell" :title="prettyJson(row.addressing)">
            {{ row.addressing }}
          </div>
          <div v-if="row.channels" class="sub">{{ channelCount(row.channels) }} 通道</div>
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
        <el-form-item label="寻址 (JSON)" prop="addressing">
          <el-input
            v-model="form.addressing"
            type="textarea" :rows="2"
            placeholder='{"slaveId":1,"baud":9600} 或 {"daliStart":1,"daliCount":4}'
          />
        </el-form-item>
        <el-form-item label="通道 (JSON)" prop="channels">
          <el-input
            v-model="form.channels"
            type="textarea" :rows="4"
            placeholder='[{"ch":1,"daliShort":1,"label":"前厅灯带","powerW":300,"daliGroup":1}]'
          />
        </el-form-item>
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
  background: linear-gradient(90deg, #3b82f6 0%, #7c3aed 80%, transparent 100%);
}
.stat-card.alert::before {
  background: linear-gradient(90deg, #ef4444 0%, #dc2626 100%);
}
.stat-card.stat-categories { grid-column: span 2; }
.stat-label { font-size: 12px; color: var(--text-secondary); letter-spacing: 1.5px; text-transform: uppercase; }
.stat-value {
  font-size: 32px; font-weight: 700; margin-top: 4px;
  background: linear-gradient(135deg, #60a5fa, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
}
.stat-card.alert .stat-value {
  background: linear-gradient(135deg, #f87171, #ef4444);
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
.tab:hover { color: var(--text-primary); border-color: rgba(99, 102, 241, 0.4); }
.tab.active {
  background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
  color: #fff;
  border-color: transparent;
  box-shadow: 0 6px 14px -6px rgba(99, 102, 241, 0.55);
}

.code-cell {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12.5px;
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.1);
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
.row-btn-danger:hover { color: #f87171; border-color: rgba(239, 68, 68, 0.5); }

.form-row { display: flex; gap: 12px; }

@media (max-width: 1280px) {
  .stat-grid { grid-template-columns: repeat(2, 1fr); }
  .stat-card.stat-categories { grid-column: span 2; }
}
</style>
