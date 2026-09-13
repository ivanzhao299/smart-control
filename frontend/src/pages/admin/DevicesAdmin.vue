<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  Wrench, RefreshCw, Plus, Pencil, Trash2, Lightbulb, MonitorPlay, Volume2,
  Snowflake, Zap, Server, Filter, Loader,
} from 'lucide-vue-next';
import { adminDeviceService, type DeviceCreatePayload } from '@/services/admin.service';
import { useDeviceStore } from '@/stores/device';
import { usePermissionStore } from '@/stores/permission';
import type { Device, DeviceCategory } from '@/types/api';

const perm = usePermissionStore();
const deviceStore = useDeviceStore();

const loading = ref(false);
const rows = ref<Device[]>([]);
const filter = reactive({
  keyword: '',
  category: '' as '' | DeviceCategory,
});

const categoryMeta: Record<DeviceCategory, { label: string; icon: unknown; color: string }> = {
  lighting: { label: '灯光',  icon: Lightbulb,   color: '#E0A030' },
  led:      { label: 'LED',  icon: MonitorPlay, color: '#9BA1A9' },
  audio:    { label: '音响',  icon: Volume2,     color: '#9BA1A9' },
  hvac:     { label: '空调',  icon: Snowflake,   color: '#06b6d4' },
  power:    { label: '电源',  icon: Zap,         color: '#eab308' },
  system:   { label: '系统',  icon: Server,      color: '#94a3b8' },
};

const categoryOptions = (Object.keys(categoryMeta) as DeviceCategory[]).map((k) => ({
  value: k, label: categoryMeta[k].label,
}));

const statusMeta: Record<Device['status'], { label: string; cls: string }> = {
  online:       { label: '在线',   cls: 'is-on' },
  running:      { label: '运行中', cls: 'is-on' },
  offline:      { label: '离线',   cls: 'is-off' },
  reconnecting: { label: '重连中', cls: 'is-warning' },
  error:        { label: '故障',   cls: 'is-error' },
  disabled:     { label: '已禁用', cls: 'is-off' },
};

const activeCategory = ref<DeviceCategory | 'all'>('all');
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

const onlineCount = computed(() =>
  rows.value.filter((r) => ['online', 'running'].includes(runtimeStatus(r.name))).length,
);

const errorCount = computed(() =>
  rows.value.filter((r) => runtimeStatus(r.name) === 'error').length,
);

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const result = await adminDeviceService.list({
      keyword: filter.keyword || undefined,
      category: filter.category || undefined,
    });
    rows.value = result.list;
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

/* ----- 编辑/新增 ----- */
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const formRef = ref<FormInstance>();
const form = reactive<DeviceCreatePayload & { id?: number }>({
  name: '',
  category: 'lighting',
  protocol: 'tcp',
  adapter: 'mock',
  ip: '',
  address: '',
  floor: '',
  zone: '',
  enabled: true,
  status: 'offline',
});

const rules: FormRules = {
  name: [
    { required: true, message: '设备名称不能为空', trigger: 'blur' },
    { min: 1, max: 128, message: '长度 1-128', trigger: 'blur' },
  ],
  category: [{ required: true, message: '类型必选', trigger: 'change' }],
  ip: [
    {
      validator: (_r, v, cb) => {
        if (!v) return cb();
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) return cb();
        cb(new Error('IP 格式不合法'));
      },
      trigger: 'blur',
    },
  ],
};

function openCreate(): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无编辑权限'); return; }
  dialogMode.value = 'create';
  Object.assign(form, {
    id: undefined, name: '', category: 'lighting', protocol: 'tcp', adapter: 'mock',
    ip: '', address: '', floor: '', zone: '', enabled: true, status: 'offline',
  });
  dialogVisible.value = true;
}

function openEdit(row: Device): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无编辑权限'); return; }
  dialogMode.value = 'edit';
  Object.assign(form, {
    id: row.id, name: row.name, category: row.category,
    protocol: row.protocol, adapter: row.adapter,
    ip: row.ip ?? '', address: row.address ?? '',
    floor: row.floor ?? '', zone: row.zone ?? '',
    enabled: row.enabled, status: row.status,
  });
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    const payload: DeviceCreatePayload = {
      name: form.name, category: form.category,
      protocol: form.protocol || undefined,
      adapter: form.adapter || undefined,
      ip: form.ip || undefined,
      address: form.address || undefined,
      floor: form.floor || undefined,
      zone: form.zone || undefined,
      enabled: form.enabled, status: form.status,
    };
    try {
      if (dialogMode.value === 'create') {
        await adminDeviceService.create(payload);
        ElMessage.success('设备已创建');
      } else if (form.id) {
        await adminDeviceService.update(form.id, payload);
        ElMessage.success('设备已更新');
      }
      dialogVisible.value = false;
      await refresh();
    } catch (err) {
      ElMessage.error('保存失败: ' + (err as Error).message);
    }
  });
}

async function toggleEnabled(row: Device): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await adminDeviceService.update(row.id, { enabled: !row.enabled });
    ElMessage.success(`已${row.enabled ? '停用' : '启用'} ${row.name}`);
    await refresh();
  } catch (err) {
    ElMessage.error('操作失败: ' + (err as Error).message);
  }
}

async function remove(row: Device): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await ElMessageBox.confirm(`确认删除设备「${row.name}」?`, '删除确认', { type: 'warning' });
  } catch { return; }
  try {
    await adminDeviceService.remove(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (err) {
    ElMessage.error('删除失败: ' + (err as Error).message);
  }
}

function runtimeStatus(name: string): Device['status'] {
  return deviceStore.statusOf(name);
}

onMounted(refresh);
</script>

<template>
  <section class="page">
    <!-- Hero -->
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><Wrench :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">设备管理</h2>
          <div class="sc-subtle">逻辑设备台账 · 实时状态 · 启用 / 编辑 / 删除</div>
        </div>
      </div>
      <div class="hero-right">
        <button class="sc-touch sc-act sc-act-neutral hero-btn" :disabled="loading" @click="refresh">
          <Loader v-if="loading" :size="16" class="spin" :stroke-width="2" />
          <RefreshCw v-else :size="16" :stroke-width="2" />
          刷新
        </button>
        <button class="sc-touch sc-act sc-act-primary hero-btn" :disabled="!perm.canEdit" @click="openCreate">
          <Plus :size="16" :stroke-width="2" /> 新增设备
        </button>
      </div>
    </header>

    <!-- 4 张统计卡 -->
    <div class="info-grid">
      <div class="info-card">
        <div class="info-label">设备总数</div>
        <div class="info-value"><span class="ver-num">{{ rows.length }}</span></div>
        <div class="info-foot">
          <span class="info-mono">已启用 {{ rows.filter((r) => r.enabled).length }}</span>
        </div>
      </div>
      <div class="info-card ok-card">
        <div class="info-label">在线 / 运行</div>
        <div class="info-value"><span class="ver-num is-good">{{ onlineCount }}</span></div>
        <div class="info-foot">
          <span class="info-mono">在线率 {{ rows.length ? Math.round(onlineCount / rows.length * 100) : 0 }}%</span>
        </div>
      </div>
      <div class="info-card" :class="errorCount > 0 ? 'alert-card' : ''">
        <div class="info-label">故障</div>
        <div class="info-value"><span class="ver-num" :class="errorCount > 0 ? 'is-bad' : ''">{{ errorCount }}</span></div>
        <div class="info-foot">
          <span class="info-mono">{{ errorCount > 0 ? '需要排查' : '运行正常' }}</span>
        </div>
      </div>
      <div class="info-card">
        <div class="info-label">分类</div>
        <div class="cat-chips">
          <span
            v-for="(cat, key) in categoryMeta"
            :key="key"
            v-show="(countByCategory[key] ?? 0) > 0"
            class="cat-chip"
          >
            <component :is="cat.icon" :size="13" :stroke-width="2" />
            {{ cat.label }} <b>{{ countByCategory[key] }}</b>
          </span>
        </div>
      </div>
    </div>

    <!-- 类别筛选 tab -->
    <div class="tabs">
      <button class="tab" :class="{ active: activeCategory === 'all' }" @click="activeCategory = 'all'">
        全部 ({{ rows.length }})
      </button>
      <button
        v-for="(cat, key) in categoryMeta"
        :key="key"
        v-show="(countByCategory[key] ?? 0) > 0"
        class="tab"
        :class="{ active: activeCategory === key }"
        @click="activeCategory = key as DeviceCategory"
      >
        <component :is="cat.icon" :size="14" :stroke-width="2" />
        {{ cat.label }} ({{ countByCategory[key] }})
      </button>
    </div>

    <!-- 搜索条 -->
    <div class="sc-panel filter-panel">
      <div class="section-title"><Filter :size="16" :stroke-width="1.75" /> 搜索</div>
      <div class="filters">
        <el-input v-model="filter.keyword" placeholder="搜索设备名称" clearable style="width: 240px;" @change="refresh" />
        <el-select v-model="filter.category" placeholder="后端筛选: 全部类型" clearable style="width: 180px;" @change="refresh">
          <el-option v-for="c in categoryOptions" :key="c.value" :label="c.label" :value="c.value" />
        </el-select>
      </div>
    </div>

    <!-- 表格 -->
    <el-table v-loading="loading" :data="filtered" stripe size="default" style="width:100%;" row-key="id">
      <el-table-column label="名称" min-width="150">
        <template #default="{ row }">
          <div class="name-cell">
            <component
              :is="categoryMeta[row.category as DeviceCategory].icon"
              :size="16" :stroke-width="1.75"
              :style="{ color: categoryMeta[row.category as DeviceCategory].color }"
            />
            <div>
              <div class="name">{{ row.name }}</div>
              <div class="sub-mono">{{ row.protocol }} · {{ row.adapter }}</div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="楼层 / 区域" width="120">
        <template #default="{ row }">
          <span>{{ [row.floor, row.zone].filter(Boolean).join(' / ') || '—' }}</span>
        </template>
      </el-table-column>
      <el-table-column label="IP" width="120">
        <template #default="{ row }">
          <code v-if="row.ip" class="code-cell">{{ row.ip }}</code>
          <span v-else class="sub-mono">—</span>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="!perm.canEdit" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="实时状态" width="100">
        <template #default="{ row }">
          <span class="sc-status" :class="statusMeta[runtimeStatus(row.name)].cls">
            <span class="sc-status-dot" /> {{ statusMeta[runtimeStatus(row.name)].label }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="170" fixed="right" align="right">
        <template #default="{ row }">
          <button class="row-btn" @click="openEdit(row)" :disabled="!perm.canEdit">
            <Pencil :size="13" :stroke-width="2" /> 编辑
          </button>
          <button class="row-btn row-btn-danger" @click="remove(row)" :disabled="!perm.canEdit">
            <Trash2 :size="13" :stroke-width="2" /> 删除
          </button>
        </template>
      </el-table-column>
    </el-table>

    <!-- 编辑对话框 -->
    <el-dialog v-model="dialogVisible" :title="dialogMode === 'create' ? '新增设备' : '编辑设备'" width="640px" destroy-on-close>
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px" status-icon>
        <el-form-item label="设备名称" prop="name">
          <el-input v-model="form.name" placeholder="如 light_3f_main" />
        </el-form-item>
        <el-form-item label="类型" prop="category">
          <el-select v-model="form.category" style="width: 100%;">
            <el-option v-for="c in categoryOptions" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <div class="form-row">
          <el-form-item label="协议" style="flex:1;">
            <el-input v-model="form.protocol" placeholder="tcp / dali / modbus" />
          </el-form-item>
          <el-form-item label="Adapter" style="flex:1;">
            <el-input v-model="form.adapter" placeholder="mock / cy-dali64a / nova ..." />
          </el-form-item>
        </div>
        <el-form-item label="IP" prop="ip">
          <el-input v-model="form.ip" placeholder="192.168.50.x (可空)" />
        </el-form-item>
        <el-form-item label="地址 JSON">
          <el-input v-model="form.address" placeholder='{"slaveId":1,"group":1}' />
        </el-form-item>
        <div class="form-row">
          <el-form-item label="楼层" style="flex:1;">
            <el-input v-model="form.floor" placeholder="1F / 2F" />
          </el-form-item>
          <el-form-item label="区域" style="flex:1;">
            <el-input v-model="form.zone" placeholder="lobby / meeting ..." />
          </el-form-item>
        </div>
        <el-form-item label="启用">
          <el-switch v-model="form.enabled" />
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
.page { display: flex; flex-direction: column; gap: 16px; }
.hero { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.hero-left { display: flex; align-items: center; gap: 14px; }
.hero-right { display: flex; gap: 10px; }
.hero-btn { min-height: 42px; padding: 0 16px; }

.info-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; }
.info-card {
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: 14px;
  padding: 16px 18px 14px;
  position: relative; overflow: hidden;
}
.info-card::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px;
  background: linear-gradient(90deg, #4C9AFF 0%, #9BA1A9 80%, transparent 100%);
}
.info-card.ok-card::before { background: linear-gradient(90deg, #3FBF87 0%, #059669 100%); }
.info-card.alert-card::before { background: linear-gradient(90deg, #E5645D 0%, #dc2626 100%); }
.info-card.alert-card { border-color: rgba(229, 100, 93, 0.32); }
.info-label { font-size: 11px; color: var(--text-secondary); letter-spacing: 1.5px; text-transform: uppercase; }
.info-value { margin: 6px 0 4px; font-size: 22px; font-weight: 700; }
.ver-num {
  font-size: 32px;
  background: linear-gradient(135deg, #4C9AFF, #a78bfa);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  font-variant-numeric: tabular-nums;
}
.ver-num.is-good { background: linear-gradient(135deg, #3FBF87, #3FBF87); -webkit-background-clip: text; background-clip: text; }
.ver-num.is-bad  { background: linear-gradient(135deg, #E5645D, #E5645D); -webkit-background-clip: text; background-clip: text; }
.info-foot { display: flex; align-items: center; gap: 6px; margin-top: 6px; }
.info-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11px;
  color: var(--text-secondary);
}
.cat-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.cat-chip {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 12px; padding: 4px 10px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-secondary);
}
.cat-chip b { color: var(--text-primary); margin-left: 2px; font-weight: 600; }

/* tabs */
.tabs { display: flex; gap: 6px; flex-wrap: wrap; border-bottom: 1px solid var(--border-soft); padding-bottom: 8px; }
.tab {
  background: transparent; color: var(--text-secondary);
  border: 1px solid var(--border-soft); border-radius: 10px;
  padding: 6px 12px; font-size: 13px;
  cursor: pointer;
  display: inline-flex; align-items: center; gap: 5px;
  font-weight: 500;
  transition: all 0.15s;
}
.tab:hover { color: var(--text-primary); border-color: var(--v2-border-soft); }
.tab.active {
  background: linear-gradient(135deg, #4C9AFF 0%, #9BA1A9 100%);
  color: #fff; border-color: transparent;
  box-shadow: 0 6px 14px -6px rgba(255, 255, 255, 0.08);
}

.filter-panel { display: flex; flex-direction: column; gap: 10px; }
.section-title { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
.filters { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }

.name-cell { display: flex; align-items: center; gap: 10px; }
.name { font-weight: 600; }
.code-cell {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #6BADFF;
  background: rgba(76, 154, 255, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}
.sub-mono {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 11.5px;
  color: var(--text-secondary);
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
  font-family: inherit;
  touch-action: manipulation;
  transition: all 0.15s;
}
.row-btn:hover:not(:disabled) { color: #c7d2fe; border-color: var(--v2-border-soft); }
.row-btn-danger:hover:not(:disabled) { color: #E5645D; border-color: rgba(229, 100, 93, 0.5); }
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.form-row { display: flex; gap: 12px; }
.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

@media (max-width: 1280px) {
  .info-grid { grid-template-columns: repeat(2, 1fr); }
}
</style>
