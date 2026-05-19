<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { adminDeviceService, type DeviceCreatePayload } from '@/services/admin.service';
import { useDeviceStore } from '@/stores/device';
import { usePermissionStore } from '@/stores/permission';
import type { Device } from '@/types/api';

const perm = usePermissionStore();
const deviceStore = useDeviceStore();

const loading = ref(false);
const rows = ref<Device[]>([]);
const filter = reactive({
  keyword: '',
  category: '' as '' | DeviceCreatePayload['category'],
});

const categoryOptions: Array<{ value: DeviceCreatePayload['category']; label: string }> = [
  { value: 'lighting', label: '灯光' },
  { value: 'led', label: 'LED' },
  { value: 'audio', label: '音响' },
  { value: 'hvac', label: '空调' },
  { value: 'power', label: '电源' },
  { value: 'system', label: '系统' },
];

const statusOptions: Array<{ value: Device['status']; label: string; type: string }> = [
  { value: 'online', label: '在线', type: 'success' },
  { value: 'offline', label: '离线', type: 'info' },
  { value: 'reconnecting', label: '重连中', type: 'warning' },
  { value: 'running', label: '运行中', type: 'success' },
  { value: 'error', label: '故障', type: 'danger' },
  { value: 'disabled', label: '已禁用', type: 'info' },
];
function statusType(s: Device['status']): string {
  return statusOptions.find((o) => o.value === s)?.type ?? 'info';
}
function statusLabel(s: Device['status']): string {
  return statusOptions.find((o) => o.value === s)?.label ?? s;
}

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
    id: undefined,
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
  dialogVisible.value = true;
}

function openEdit(row: Device): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无编辑权限'); return; }
  dialogMode.value = 'edit';
  Object.assign(form, {
    id: row.id,
    name: row.name,
    category: row.category,
    protocol: row.protocol,
    adapter: row.adapter,
    ip: row.ip ?? '',
    address: row.address ?? '',
    floor: row.floor ?? '',
    zone: row.zone ?? '',
    enabled: row.enabled,
    status: row.status,
  });
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    const payload: DeviceCreatePayload = {
      name: form.name,
      category: form.category,
      protocol: form.protocol || undefined,
      adapter: form.adapter || undefined,
      ip: form.ip || undefined,
      address: form.address || undefined,
      floor: form.floor || undefined,
      zone: form.zone || undefined,
      enabled: form.enabled,
      status: form.status,
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
  } catch {
    return;
  }
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
    <header class="bar">
      <div class="left">
        <el-input v-model="filter.keyword" placeholder="搜索设备名称" clearable style="width: 220px;" @change="refresh" />
        <el-select v-model="filter.category" placeholder="全部类型" clearable style="width: 140px;" @change="refresh">
          <el-option v-for="c in categoryOptions" :key="c.value" :label="c.label" :value="c.value" />
        </el-select>
      </div>
      <div class="right">
        <el-button @click="refresh">刷新</el-button>
        <el-button type="primary" :disabled="!perm.canEdit" @click="openCreate">+ 新增设备</el-button>
      </div>
    </header>

    <el-table v-loading="loading" :data="rows" stripe style="width: 100%;" row-key="id">
      <el-table-column prop="id" label="ID" width="60" />
      <el-table-column prop="name" label="设备名" min-width="160" />
      <el-table-column prop="category" label="类型" width="100" />
      <el-table-column prop="protocol" label="协议" width="100" />
      <el-table-column prop="adapter" label="Adapter" width="100" />
      <el-table-column prop="ip" label="IP" width="140">
        <template #default="{ row }">{{ row.ip || '—' }}</template>
      </el-table-column>
      <el-table-column prop="address" label="地址编号" width="140">
        <template #default="{ row }">{{ row.address || '—' }}</template>
      </el-table-column>
      <el-table-column label="位置" width="120">
        <template #default="{ row }">{{ [row.floor, row.zone].filter(Boolean).join(' / ') || '—' }}</template>
      </el-table-column>
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="!perm.canEdit" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="实时状态" width="120">
        <template #default="{ row }">
          <el-tag :type="statusType(runtimeStatus(row.name))" size="small">
            {{ statusLabel(runtimeStatus(row.name)) }}
          </el-tag>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="180" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link @click="openEdit(row)" :disabled="!perm.canEdit">编辑</el-button>
          <el-button size="small" link type="danger" @click="remove(row)" :disabled="!perm.canEdit">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增设备' : '编辑设备'"
      width="640"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100" status-icon>
        <el-form-item label="设备名称" prop="name">
          <el-input v-model="form.name" placeholder="如 light_3f_main" />
        </el-form-item>
        <el-form-item label="类型" prop="category">
          <el-select v-model="form.category" style="width: 100%;">
            <el-option v-for="c in categoryOptions" :key="c.value" :label="c.label" :value="c.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="协议">
          <el-input v-model="form.protocol" placeholder="tcp / dali / modbus" />
        </el-form-item>
        <el-form-item label="Adapter">
          <el-input v-model="form.adapter" placeholder="mock / real-dali / nova / ..." />
        </el-form-item>
        <el-form-item label="IP" prop="ip">
          <el-input v-model="form.ip" placeholder="192.168.50.x (可空)" />
        </el-form-item>
        <el-form-item label="地址编号">
          <el-input v-model="form.address" placeholder="如 {&quot;zone&quot;:1} 或 5" />
        </el-form-item>
        <el-form-item label="楼层">
          <el-input v-model="form.floor" placeholder="1F / 2F" />
        </el-form-item>
        <el-form-item label="区域">
          <el-input v-model="form.zone" placeholder="main / meeting / ..." />
        </el-form-item>
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
.page { display: flex; flex-direction: column; gap: 14px; }
.bar { display: flex; justify-content: space-between; align-items: center; }
.bar .left, .bar .right { display: flex; gap: 10px; align-items: center; }
</style>
