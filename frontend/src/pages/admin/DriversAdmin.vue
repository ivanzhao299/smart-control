<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { driverService, type DriverTemplate, type DriverCreatePayload } from '@/services/driver.service';

const list = ref<DriverTemplate[]>([]);
const loading = ref(false);
const selected = ref<DriverTemplate | null>(null);
const drawerVisible = ref(false);

const categoryFilter = ref<string>('');
const search = ref<string>('');

// 新建驱动 (P4)
const createVisible = ref(false);
const formRef = ref<FormInstance>();
interface CreateFormState {
  kind: string;
  displayName: string;
  vendor: string;
  category: string;
  protocol: string;
  capabilities: string[];
  defaultAddressingText: string;  // JSON 文本输入, 提交时解析
  paramSchemaText: string;        // 同上
  remark: string;
}
const createForm = reactive<CreateFormState>({
  kind: '',
  displayName: '',
  vendor: '',
  category: '',
  protocol: '',
  capabilities: [],
  defaultAddressingText: '{}',
  paramSchemaText: '{}',
  remark: '',
});
const createRules: FormRules = {
  kind: [
    { required: true, message: 'kind 不能为空 (e.g. lt-84a / dsppa-mag)', trigger: 'blur' },
    { pattern: /^[a-z0-9-]+$/, message: '只能小写字母 / 数字 / 短横线', trigger: 'blur' },
  ],
  displayName: [{ required: true, message: '显示名必填', trigger: 'blur' }],
  vendor: [{ required: true, message: '厂商必填', trigger: 'blur' }],
  category: [{ required: true, message: '品类必填', trigger: 'blur' }],
  protocol: [{ required: true, message: '协议族必填', trigger: 'blur' }],
};

const CATEGORY_PRESETS = [
  'dali-gateway', 'led-controller', 'audio-dsp', 'audio-guide', 'audio-power',
  'hvac-gateway', 'hvac-outdoor', 'power-relay', 'rtu-tcp-converter', 'other',
];
const PROTOCOL_PRESETS = [
  'modbus-rtu', 'modbus-tcp', 'modbus-rtu-over-tcp',
  'nova-vx-tcp', 'takstar-ekx-tcp',
  'http-rest', 'custom-tcp',
];
const CAPABILITY_PRESETS = [
  'turn_on', 'turn_off', 'set_brightness', 'set_color_temp',
  'recall_scene', 'set_zone_brightness',
  'power_on', 'power_off', 'switch_input', 'load_preset',
  'set_volume', 'mute', 'set_matrix', 'aux_switch',
  'set_temperature', 'set_mode', 'set_fan_speed',
  'get_status', 'health_check', 'read_level',
];

function openCreate(): void {
  createForm.kind = '';
  createForm.displayName = '';
  createForm.vendor = '';
  createForm.category = '';
  createForm.protocol = '';
  createForm.capabilities = [];
  createForm.defaultAddressingText = '{}';
  createForm.paramSchemaText = '{}';
  createForm.remark = '';
  createVisible.value = true;
}

async function submitCreate(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    let defaultAddressing: Record<string, unknown> | undefined;
    let paramSchema: Record<string, unknown> | undefined;
    try {
      defaultAddressing = createForm.defaultAddressingText
        ? JSON.parse(createForm.defaultAddressingText)
        : undefined;
    } catch {
      ElMessage.error('默认 addressing 不是合法 JSON');
      return;
    }
    try {
      paramSchema = createForm.paramSchemaText
        ? JSON.parse(createForm.paramSchemaText)
        : undefined;
    } catch {
      ElMessage.error('paramSchema 不是合法 JSON');
      return;
    }

    const payload: DriverCreatePayload = {
      kind: createForm.kind.trim(),
      displayName: createForm.displayName.trim(),
      vendor: createForm.vendor.trim(),
      category: createForm.category,
      protocol: createForm.protocol,
      capabilities: createForm.capabilities,
      defaultAddressing,
      paramSchema: paramSchema as DriverCreatePayload['paramSchema'],
      remark: createForm.remark || undefined,
    };
    try {
      await driverService.create(payload);
      ElMessage.success('已创建');
      createVisible.value = false;
      await refresh();
    } catch (err) {
      ElMessage.error(`创建失败: ${(err as Error).message}`);
    }
  });
}

const filtered = computed<DriverTemplate[]>(() => {
  let rows = list.value;
  if (categoryFilter.value) rows = rows.filter((d) => d.category === categoryFilter.value);
  if (search.value.trim()) {
    const q = search.value.trim().toLowerCase();
    rows = rows.filter(
      (d) =>
        d.kind.toLowerCase().includes(q) ||
        d.displayName.toLowerCase().includes(q) ||
        d.vendor.toLowerCase().includes(q),
    );
  }
  return rows;
});

const categories = computed<string[]>(() => {
  const set = new Set(list.value.map((d) => d.category));
  return Array.from(set).sort();
});

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    list.value = await driverService.list();
  } catch (err) {
    ElMessage.error(`加载失败: ${(err as Error).message}`);
  } finally {
    loading.value = false;
  }
}

function openDetail(row: DriverTemplate): void {
  selected.value = row;
  drawerVisible.value = true;
}

async function remove(row: DriverTemplate): Promise<void> {
  if (row.builtin) {
    ElMessage.warning('代码内置的 driver 不能删除, 只能删 UI 创建的');
    return;
  }
  try {
    await ElMessageBox.confirm(
      `确定删除驱动模板 "${row.displayName}" (kind=${row.kind})?`,
      '确认删除',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await driverService.remove(row.kind);
    ElMessage.success('删除成功');
    await refresh();
  } catch (err) {
    ElMessage.error(`删除失败: ${(err as Error).message}`);
  }
}

onMounted(refresh);
</script>

<template>
  <section class="drivers-admin">
    <header class="page-head">
      <div>
        <h2>驱动模板</h2>
        <p class="sub">代码内置 driver + UI 创建的扩展模板. 实例化硬件时从这里选驱动.</p>
      </div>
      <div class="actions">
        <el-input v-model="search" placeholder="搜索 kind / 名字 / 厂商" clearable style="width: 220px;" />
        <el-select v-model="categoryFilter" placeholder="按品类筛选" clearable style="width: 180px;">
          <el-option v-for="c in categories" :key="c" :value="c" :label="c" />
        </el-select>
        <el-button type="primary" @click="openCreate">新建驱动</el-button>
        <el-button @click="refresh" :loading="loading">刷新</el-button>
      </div>
    </header>

    <el-table :data="filtered" v-loading="loading" stripe @row-click="openDetail" class="drivers-table">
      <el-table-column prop="kind" label="kind" width="160" />
      <el-table-column prop="displayName" label="显示名" min-width="240" />
      <el-table-column prop="vendor" label="厂商" width="160" />
      <el-table-column prop="category" label="品类" width="140" />
      <el-table-column prop="protocol" label="协议" width="180" />
      <el-table-column label="能力" min-width="280">
        <template #default="{ row }">
          <el-tag
            v-for="cap in row.capabilities.slice(0, 4)"
            :key="cap"
            size="small"
            class="cap-tag"
            type="info"
          >
            {{ cap }}
          </el-tag>
          <span v-if="row.capabilities.length > 4" class="more">+{{ row.capabilities.length - 4 }}</span>
        </template>
      </el-table-column>
      <el-table-column label="来源" width="100">
        <template #default="{ row }">
          <el-tag v-if="row.builtin" type="success" size="small">代码</el-tag>
          <el-tag v-else type="warning" size="small">UI</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="100" fixed="right">
        <template #default="{ row }">
          <el-button v-if="!row.builtin" type="danger" link @click.stop="remove(row)">删除</el-button>
          <span v-else class="muted">内置</span>
        </template>
      </el-table-column>
    </el-table>

    <el-drawer
      v-model="drawerVisible"
      :title="selected?.displayName ?? '驱动详情'"
      size="40%"
      direction="rtl"
    >
      <div v-if="selected" class="detail">
        <dl>
          <dt>kind</dt><dd><code>{{ selected.kind }}</code></dd>
          <dt>厂商</dt><dd>{{ selected.vendor }}</dd>
          <dt>品类</dt><dd>{{ selected.category }}</dd>
          <dt>协议族</dt><dd>{{ selected.protocol }}</dd>
          <dt>能力</dt>
          <dd>
            <el-tag v-for="cap in selected.capabilities" :key="cap" size="small" class="cap-tag">
              {{ cap }}
            </el-tag>
          </dd>
          <dt>默认 addressing</dt>
          <dd>
            <pre v-if="selected.defaultAddressing">{{ JSON.stringify(selected.defaultAddressing, null, 2) }}</pre>
            <span v-else class="muted">(无)</span>
          </dd>
          <dt>实例化参数 schema</dt>
          <dd>
            <div v-if="selected.paramSchema" class="schema-grid">
              <div v-for="(field, key) in selected.paramSchema" :key="key" class="schema-row">
                <span class="schema-key">{{ key }}</span>
                <span class="schema-meta">
                  {{ field.label }} · {{ field.type }}
                  <span v-if="field.required" class="req">必填</span>
                  <span v-if="field.default !== undefined">默认: {{ field.default }}</span>
                </span>
              </div>
            </div>
            <span v-else class="muted">(无)</span>
          </dd>
          <dt>备注</dt><dd>{{ selected.remark || '—' }}</dd>
        </dl>
      </div>
    </el-drawer>

    <el-dialog
      v-model="createVisible"
      title="新建驱动模板"
      width="640px"
    >
      <el-alert type="warning" show-icon :closable="false" class="warn-banner">
        <strong>注意:</strong> UI 创建的驱动只能给 <em>已有协议族</em> 下的新品牌挂壳
        (e.g. 接同走 Modbus-RTU 的另一家 DALI 网关). 真正的协议帧编解码必须由代码层
        某个 adapter 提供. 接全新协议要写新 adapter class.
      </el-alert>
      <el-form ref="formRef" :model="createForm" :rules="createRules" label-width="120px" label-position="right">
        <el-form-item label="kind" prop="kind">
          <el-input v-model="createForm.kind" placeholder="lt-84a / dsppa-mag / ..." />
          <div class="field-hint">小写字母数字短横线, 全局唯一, 发布后别改名</div>
        </el-form-item>
        <el-form-item label="显示名" prop="displayName">
          <el-input v-model="createForm.displayName" placeholder="雷特 LT-84A (DALI→0-10V 转换器)" />
        </el-form-item>
        <div class="form-row">
          <el-form-item label="厂商" prop="vendor" style="flex:1;">
            <el-input v-model="createForm.vendor" placeholder="雷特 / DSPPA / ..." />
          </el-form-item>
          <el-form-item label="品类" prop="category" style="flex:1;">
            <el-select v-model="createForm.category" placeholder="选品类" filterable allow-create style="width:100%;">
              <el-option v-for="c in CATEGORY_PRESETS" :key="c" :value="c" :label="c" />
            </el-select>
          </el-form-item>
        </div>
        <el-form-item label="协议族" prop="protocol">
          <el-select v-model="createForm.protocol" placeholder="选协议族" filterable allow-create style="width:100%;">
            <el-option v-for="p in PROTOCOL_PRESETS" :key="p" :value="p" :label="p" />
          </el-select>
        </el-form-item>
        <el-form-item label="能力 (capabilities)">
          <el-select
            v-model="createForm.capabilities"
            multiple
            filterable
            allow-create
            placeholder="选/输入 这个驱动暴露的命令"
            style="width:100%;"
          >
            <el-option v-for="c in CAPABILITY_PRESETS" :key="c" :value="c" :label="c" />
          </el-select>
        </el-form-item>
        <el-form-item label="默认 addressing">
          <el-input
            v-model="createForm.defaultAddressingText"
            type="textarea"
            :autosize="{ minRows: 3, maxRows: 6 }"
            placeholder='{"slaveId":1,"port":502}'
            class="mono"
          />
          <div class="field-hint">JSON. 加新硬件时用这个填默认值.</div>
        </el-form-item>
        <el-form-item label="paramSchema">
          <el-input
            v-model="createForm.paramSchemaText"
            type="textarea"
            :autosize="{ minRows: 4, maxRows: 10 }"
            placeholder='{"ip":{"type":"string","label":"IP","required":true}}'
            class="mono"
          />
          <div class="field-hint">JSON. 给前端动态生成实例化表单. 字段: type/label/required/default/min/max</div>
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="createForm.remark" type="textarea" :autosize="{ minRows: 2, maxRows: 4 }" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" @click="submitCreate">创建</el-button>
      </template>
    </el-dialog>
  </section>
</template>

<style scoped>
.drivers-admin { padding: 16px 24px; }
.page-head { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 16px; gap: 16px; }
.page-head h2 { margin: 0; font-size: 20px; }
.sub { color: var(--el-text-color-secondary); margin: 4px 0 0; font-size: 13px; }
.actions { display: flex; gap: 12px; align-items: center; }
.drivers-table :deep(.el-table__row) { cursor: pointer; }
.cap-tag { margin-right: 4px; margin-bottom: 4px; }
.more { color: var(--el-text-color-secondary); font-size: 12px; }
.muted { color: var(--el-text-color-secondary); font-size: 12px; }
.detail dl { display: grid; grid-template-columns: 100px 1fr; gap: 12px 16px; padding: 16px 24px; }
.detail dt { color: var(--el-text-color-secondary); font-size: 13px; }
.detail dd { margin: 0; }
.detail pre { background: var(--el-fill-color-light); padding: 8px 12px; border-radius: 6px; font-size: 12px; }
.schema-grid { display: flex; flex-direction: column; gap: 8px; }
.schema-row { display: flex; gap: 12px; font-size: 13px; }
.schema-key { font-family: monospace; min-width: 140px; color: var(--el-color-primary); }
.schema-meta { color: var(--el-text-color-secondary); }
.req { color: var(--el-color-danger); margin-left: 6px; font-size: 11px; }

.warn-banner { margin-bottom: 16px; }
.warn-banner em { font-style: normal; text-decoration: underline; }
.form-row { display: flex; gap: 12px; }
.field-hint { color: var(--el-text-color-secondary); font-size: 12px; margin-top: 4px; }
.mono :deep(textarea) { font-family: 'JetBrains Mono', 'Menlo', monospace; font-size: 12px; }
</style>
