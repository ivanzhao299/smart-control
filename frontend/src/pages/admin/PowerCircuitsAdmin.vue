<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import {
  powerCircuitsService,
  type PowerCircuitView,
  type PowerCircuitUpsertDto,
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

onMounted(refresh);
</script>

<template>
  <section class="circuits-admin">
    <header class="page-head">
      <div>
        <h2>电源回路</h2>
        <p class="sub">
          每条回路 = 一路强电继电器通道 + 可选电能表. 通断走 gatewayCode/relayChannel, 实时数据走 meterAddress (留空则 mock 模拟).
        </p>
      </div>
      <div class="actions">
        <el-select v-model="floorFilter" placeholder="全部楼层" clearable style="width: 140px;">
          <el-option v-for="f in floorOptions" :key="f" :label="f" :value="f" />
        </el-select>
        <el-input v-model="search" placeholder="搜索名称 / code / 继电器" clearable style="width: 240px;" />
        <el-button type="primary" @click="openCreate">新增回路</el-button>
        <el-button @click="refresh" :loading="loading">刷新</el-button>
      </div>
    </header>

    <el-table :data="filtered" v-loading="loading" stripe class="circuits-table">
      <el-table-column prop="sortOrder" label="排序" width="70" align="center" />
      <el-table-column label="名称" min-width="220">
        <template #default="{ row }">
          <div class="name-cell">
            <span class="circuit-name">{{ row.name }}</span>
            <code class="circuit-code">{{ row.code }}</code>
            <div v-if="row.description" class="circuit-desc">{{ row.description }}</div>
          </div>
        </template>
      </el-table-column>
      <el-table-column prop="floor" label="楼层" width="80" align="center" />
      <el-table-column label="类型" width="100" align="center">
        <template #default="{ row }">
          <el-tag size="default" :type="row.category === 'misc' ? 'info' : 'primary'">
            {{ CATEGORIES.find(c => c.value === row.category)?.label ?? row.category }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="继电器" min-width="160">
        <template #default="{ row }">
          <code v-if="row.gatewayCode" class="gw-code">{{ row.gatewayCode }} · CH{{ row.relayChannel ?? '?' }}</code>
          <span v-else class="muted">未配置</span>
        </template>
      </el-table-column>
      <el-table-column label="额定" width="160">
        <template #default="{ row }">
          <code class="gw-code">{{ row.ratedVoltage }}V · {{ row.ratedCurrent }}A · {{ row.ratedPower }}W</code>
        </template>
      </el-table-column>
      <el-table-column label="状态" width="120" align="center">
        <template #default="{ row }">
          <el-tag size="default" :type="row.reading.on ? 'success' : 'info'">
            {{ row.reading.on ? '通电' : '断电' }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="启用" width="100" align="center">
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
      <el-table-column label="操作" width="140" fixed="right">
        <template #default="{ row }">
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
  </section>
</template>

<style scoped>
.circuits-admin { padding: 16px 24px; color: var(--v2-text-1); }
.page-head {
  display: flex; justify-content: space-between; align-items: flex-end;
  margin-bottom: 16px; gap: 16px;
}
.page-head h2 { margin: 0; font-size: 20px; color: var(--v2-text-1); }
.sub { color: var(--v2-text-2); margin: 4px 0 0; font-size: 13px; max-width: 720px; line-height: 1.6; }
.actions { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }

.name-cell { display: flex; flex-direction: column; gap: 3px; }
.circuit-name { font-weight: 600; color: var(--v2-text-1); font-size: 14px; letter-spacing: 0.3px; }
.circuit-code {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.62);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.4px;
}
.circuit-desc { font-size: 11.5px; color: var(--v2-text-2); font-style: italic; }
.gw-code {
  font-size: 11.5px;
  color: rgba(255, 255, 255, 0.72);
  font-family: 'JetBrains Mono', ui-monospace, monospace;
}
.muted { color: var(--v2-text-3); font-size: 12px; }

.form { padding: 16px 0; }
.hint { font-size: 12px; color: var(--v2-text-2); margin-top: 4px; line-height: 1.5; }
.hint.inline { margin-left: 8px; }
</style>
