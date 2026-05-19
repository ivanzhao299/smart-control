<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  adminSceneActionService,
  adminSceneService,
  type SceneActionPayload,
} from '@/services/admin.service';
import { usePermissionStore } from '@/stores/permission';
import type { Scene, SceneAction } from '@/types/api';

const props = defineProps<{ id: string | number }>();
const router = useRouter();
const perm = usePermissionStore();

const sceneId = computed(() => Number(props.id));
const scene = ref<Scene | null>(null);
const rows = ref<SceneAction[]>([]);
const loading = ref(false);

const deviceTypeOptions = ['lighting', 'led', 'audio', 'hvac', 'power'];
const commandsByType: Record<string, string[]> = {
  lighting: ['turnOn', 'turnOff', 'setBrightness', 'recallScene'],
  led: ['powerOn', 'powerOff', 'switchInput', 'playMedia', 'showWelcome'],
  audio: ['setVolume', 'mute', 'unmute', 'playBgm', 'stopBgm', 'enableMic'],
  hvac: ['turnOn', 'turnOff', 'setTemperature', 'setMode', 'setFanSpeed'],
  power: ['turnOn', 'turnOff'],
};

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const formRef = ref<FormInstance>();
const form = reactive<{
  id?: number;
  deviceType: string;
  deviceId: string;
  command: string;
  paramsRaw: string;
  delayMs: number;
  sortOrder: number;
  enabled: boolean;
}>({
  deviceType: 'lighting',
  deviceId: '',
  command: 'turnOn',
  paramsRaw: '{}',
  delayMs: 0,
  sortOrder: 0,
  enabled: true,
});

const rules: FormRules = {
  deviceType: [{ required: true, message: '设备类型必选', trigger: 'change' }],
  deviceId: [{ required: true, message: '设备ID不能为空', trigger: 'blur' }],
  command: [{ required: true, message: '命令不能为空', trigger: 'blur' }],
  paramsRaw: [
    {
      validator: (_r, v, cb) => {
        if (!v || !v.trim()) return cb();
        try {
          const parsed = JSON.parse(v);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return cb();
          cb(new Error('参数必须是 JSON 对象'));
        } catch {
          cb(new Error('JSON 格式不合法'));
        }
      },
      trigger: 'blur',
    },
  ],
};

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const [s, list] = await Promise.all([
      adminSceneService.detail(sceneId.value),
      adminSceneActionService.listForScene(sceneId.value),
    ]);
    scene.value = s;
    rows.value = list;
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

function openCreate(): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  dialogMode.value = 'create';
  const maxSort = rows.value.reduce((m, a) => Math.max(m, a.sortOrder), 0);
  Object.assign(form, {
    id: undefined,
    deviceType: 'lighting',
    deviceId: '',
    command: 'turnOn',
    paramsRaw: '{}',
    delayMs: 0,
    sortOrder: maxSort + 1,
    enabled: true,
  });
  dialogVisible.value = true;
}

function openEdit(row: SceneAction): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  dialogMode.value = 'edit';
  let prettyParams = row.params;
  try { prettyParams = JSON.stringify(JSON.parse(row.params), null, 2); } catch { /* keep as-is */ }
  Object.assign(form, {
    id: row.id,
    deviceType: row.deviceType,
    deviceId: row.deviceId,
    command: row.command,
    paramsRaw: prettyParams,
    delayMs: row.delayMs,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
  });
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;
    const params = (() => {
      if (!form.paramsRaw.trim()) return {};
      return JSON.parse(form.paramsRaw);
    })();
    const payload: SceneActionPayload = {
      deviceType: form.deviceType,
      deviceId: form.deviceId,
      command: form.command,
      params,
      delayMs: form.delayMs,
      sortOrder: form.sortOrder,
      enabled: form.enabled,
    };
    try {
      if (dialogMode.value === 'create') {
        await adminSceneActionService.create(sceneId.value, payload);
        ElMessage.success('已添加');
      } else if (form.id) {
        await adminSceneActionService.update(form.id, payload);
        ElMessage.success('已更新');
      }
      dialogVisible.value = false;
      await refresh();
    } catch (err) {
      ElMessage.error('保存失败: ' + (err as Error).message);
    }
  });
}

async function remove(row: SceneAction): Promise<void> {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  try {
    await ElMessageBox.confirm(`确认删除动作 #${row.id}?`, '删除确认', { type: 'warning' });
  } catch { return; }
  try {
    await adminSceneActionService.remove(row.id);
    ElMessage.success('已删除');
    await refresh();
  } catch (err) {
    ElMessage.error('删除失败: ' + (err as Error).message);
  }
}

async function move(row: SceneAction, delta: number): Promise<void> {
  if (!perm.canEdit) return;
  await adminSceneActionService.update(row.id, { sortOrder: row.sortOrder + delta });
  await refresh();
}

async function toggleEnabled(row: SceneAction): Promise<void> {
  if (!perm.canEdit) return;
  await adminSceneActionService.update(row.id, { enabled: !row.enabled });
  await refresh();
}

async function testExecute(): Promise<void> {
  if (!perm.canExecute || !scene.value) return;
  try {
    await adminSceneService.execute(scene.value.code);
    ElMessage.success(`已请求执行 ${scene.value.code}`);
  } catch (err) {
    ElMessage.error('执行失败: ' + (err as Error).message);
  }
}

function goBack(): void {
  router.push({ name: 'admin-scenes' });
}

function sortBySort(a: SceneAction, b: SceneAction): number {
  return a.sortOrder - b.sortOrder;
}

onMounted(refresh);
</script>

<template>
  <section class="page">
    <header class="bar">
      <div class="left">
        <el-button link @click="goBack">← 返回场景列表</el-button>
        <div v-if="scene" class="title">
          <strong>{{ scene.name }}</strong>
          <span class="sc-subtle">code: {{ scene.code }} · 共 {{ rows.length }} 个动作</span>
        </div>
      </div>
      <div class="right">
        <el-button @click="refresh">刷新</el-button>
        <el-button type="success" :disabled="!perm.canExecute || !scene" @click="testExecute">▶ 测试执行整个场景</el-button>
        <el-button type="primary" :disabled="!perm.canEdit" @click="openCreate">+ 新增动作</el-button>
      </div>
    </header>

    <el-table v-loading="loading" :data="rows" stripe row-key="id">
      <el-table-column prop="sortOrder" label="顺序" width="80" sortable :sort-method="sortBySort" />
      <el-table-column prop="deviceType" label="设备类型" width="100" />
      <el-table-column prop="deviceId" label="设备ID" min-width="160" />
      <el-table-column prop="command" label="命令" width="140" />
      <el-table-column prop="params" label="参数" min-width="200">
        <template #default="{ row }">
          <code class="params">{{ row.params }}</code>
        </template>
      </el-table-column>
      <el-table-column prop="delayMs" label="延时(ms)" width="100" />
      <el-table-column label="启用" width="80">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="!perm.canEdit" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="240" fixed="right">
        <template #default="{ row }">
          <el-button size="small" link @click="move(row, -1)" :disabled="!perm.canEdit">↑</el-button>
          <el-button size="small" link @click="move(row, 1)" :disabled="!perm.canEdit">↓</el-button>
          <el-button size="small" link @click="openEdit(row)" :disabled="!perm.canEdit">编辑</el-button>
          <el-button size="small" link type="danger" @click="remove(row)" :disabled="!perm.canEdit">删除</el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增动作' : '编辑动作'"
      width="640"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100" status-icon>
        <el-form-item label="设备类型" prop="deviceType">
          <el-select v-model="form.deviceType" style="width: 100%;">
            <el-option v-for="t in deviceTypeOptions" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="设备ID" prop="deviceId">
          <el-input v-model="form.deviceId" placeholder="如 light_1f_main" />
        </el-form-item>
        <el-form-item label="命令" prop="command">
          <el-select v-model="form.command" filterable allow-create style="width: 100%;">
            <el-option
              v-for="c in commandsByType[form.deviceType] ?? []"
              :key="c" :label="c" :value="c"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="参数 JSON" prop="paramsRaw">
          <el-input v-model="form.paramsRaw" type="textarea" :rows="4" placeholder='例: {"value":80}' />
        </el-form-item>
        <el-form-item label="延时 (ms)">
          <el-input-number v-model="form.delayMs" :min="0" :step="100" />
        </el-form-item>
        <el-form-item label="顺序 (sortOrder)">
          <el-input-number v-model="form.sortOrder" :min="0" />
          <div class="sc-subtle hint">相同 sortOrder 的动作并行执行；不同的按升序顺序执行</div>
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
.bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.bar .left { display: flex; gap: 12px; align-items: center; }
.bar .right { display: flex; gap: 10px; }
.title { display: flex; flex-direction: column; }
.title .sc-subtle { font-size: 12px; }
.params { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; color: var(--text-secondary); }
.hint { font-size: 12px; margin-top: 4px; }
</style>
