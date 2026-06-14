<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { ElMessage, ElMessageBox, type FormInstance, type FormRules } from 'element-plus';
import { useRouter } from 'vue-router';
import {
  adminSceneActionService,
  adminSceneService,
  type SceneActionPayload,
} from '@/services/admin.service';
import { usePermissionStore } from '@/stores/permission';
import {
  Settings2, ChevronLeft, RefreshCw, Plus, Play, Pencil, Trash2,
  ChevronUp, ChevronDown, Loader, Code2, Wand2, Copy, Zap,
} from 'lucide-vue-next';
import type { Scene, SceneAction } from '@/types/api';
import ActionParamForm from '@/components/admin/ActionParamForm.vue';
import ActionDeviceSelector from '@/components/admin/ActionDeviceSelector.vue';
import {
  DEVICE_TYPE_LIST, DEVICE_TYPE_META,
  getCommandSpec, listCommandsForType,
  paramsFromForm, humanizeAction,
  type CommandSpec,
} from '@/services/scene-action-schema';

const props = defineProps<{ id: string | number }>();
const router = useRouter();
const perm = usePermissionStore();

const sceneId = computed(() => Number(props.id));
const scene = ref<Scene | null>(null);
const rows = ref<SceneAction[]>([]);
const loading = ref(false);

/** 是否走"高级 JSON" 模式 — 默认 false (智能 form), 老数据 / 未识别 schema 时强制 true */
const advancedJson = ref(false);

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const formRef = ref<FormInstance>();

interface ActionForm {
  id?: number;
  deviceType: string;
  deviceId: string;
  command: string;
  /** 智能 form 模式: 按 schema 的 key→value */
  paramsForm: Record<string, unknown>;
  /** 高级 JSON 模式 / fallback: 原始 JSON 文本 */
  paramsRaw: string;
  delayMs: number;
  sortOrder: number;
  enabled: boolean;
}

const form = reactive<ActionForm>({
  deviceType: 'lighting',
  deviceId: '',
  command: 'turnOn',
  paramsForm: {},
  paramsRaw: '{}',
  delayMs: 0,
  sortOrder: 0,
  enabled: true,
});

/** 当前 (deviceType, command) 对应的 schema; null = 未注册, 必须走 JSON */
const currentSpec = computed<CommandSpec | null>(() => getCommandSpec(form.deviceType, form.command));

/** 当前 deviceType 下所有已注册命令 */
const availableCommands = computed(() => listCommandsForType(form.deviceType));

const deviceTypeOptionsExt = DEVICE_TYPE_LIST;

/** deviceType 切换时, 命令重置到该类型的第一个 / 清空 */
watch(() => form.deviceType, (newType, oldType) => {
  if (newType === oldType) return;
  const list = listCommandsForType(newType);
  form.command = list[0]?.value ?? '';
  form.deviceId = '';
  form.paramsForm = {};
  form.paramsRaw = '{}';
});

/** command 切换时, paramsForm 重置到 schema 默认值 */
watch(() => form.command, () => {
  const spec = getCommandSpec(form.deviceType, form.command);
  if (spec) {
    form.paramsForm = {};
    for (const p of spec.params) {
      if (p.default !== undefined) form.paramsForm[p.key] = p.default;
    }
  }
});

/** 智能 form 和 JSON 切换时双向同步 */
function toggleAdvanced(): void {
  if (!advancedJson.value) {
    // 切到 JSON 模式: 把 paramsForm 序列化进 paramsRaw
    form.paramsRaw = JSON.stringify(form.paramsForm, null, 2);
  } else {
    // 切回 form 模式: 解析 paramsRaw 回 paramsForm
    try {
      const obj = JSON.parse(form.paramsRaw || '{}');
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        form.paramsForm = obj;
      }
    } catch {
      ElMessage.warning('当前 JSON 不合法, form 模式可能丢字段');
    }
  }
  advancedJson.value = !advancedJson.value;
}

const rules: FormRules = {
  deviceType: [{ required: true, message: '设备类型必选', trigger: 'change' }],
  deviceId: [{ required: true, message: '设备必选', trigger: 'change' }],
  command: [{ required: true, message: '操作必选', trigger: 'change' }],
  paramsRaw: [
    {
      validator: (_r, v, cb) => {
        if (!advancedJson.value) return cb();   // 智能 form 模式不校验 raw
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
    paramsForm: {},
    paramsRaw: '{}',
    delayMs: 0,
    sortOrder: maxSort + 1,
    enabled: true,
  });
  advancedJson.value = false;
  dialogVisible.value = true;
}

function openEdit(row: SceneAction): void {
  if (!perm.canEdit) { ElMessage.warning('当前角色无权限'); return; }
  dialogMode.value = 'edit';
  // 试着把 row.params (JSON 文本) 解析回 paramsForm; 解析失败的留 JSON 模式
  let parsed: Record<string, unknown> = {};
  let parseOk = false;
  try {
    const obj = JSON.parse(row.params || '{}');
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
      parsed = obj as Record<string, unknown>;
      parseOk = true;
    }
  } catch { /* ignore */ }

  Object.assign(form, {
    id: row.id,
    deviceType: row.deviceType,
    deviceId: row.deviceId,
    command: row.command,
    paramsForm: parsed,
    paramsRaw: parseOk ? JSON.stringify(parsed, null, 2) : row.params,
    delayMs: row.delayMs,
    sortOrder: row.sortOrder,
    enabled: row.enabled,
  });

  // 如果 schema 不认识这个命令, 直接走 JSON 高级模式
  const spec = getCommandSpec(row.deviceType, row.command);
  advancedJson.value = !spec || !parseOk;
  dialogVisible.value = true;
}

async function submit(): Promise<void> {
  if (!formRef.value) return;
  await formRef.value.validate(async (valid) => {
    if (!valid) return;

    // 取 params: 智能 form 模式从 paramsForm 经 schema 提取; JSON 模式直接 parse
    let params: Record<string, unknown>;
    if (advancedJson.value) {
      try {
        params = form.paramsRaw.trim() ? JSON.parse(form.paramsRaw) : {};
      } catch (err) {
        ElMessage.error('JSON 解析失败: ' + (err as Error).message);
        return;
      }
    } else {
      const spec = currentSpec.value;
      if (spec) {
        params = paramsFromForm(spec, form.paramsForm);
      } else {
        // 没注册的命令: 退回 paramsForm 直接做对象用
        params = { ...form.paramsForm };
      }
    }

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

/**
 * 试触发单条动作 — 后端 POST /scene-actions/:id/test, 不进 SceneEngine 队列.
 * 业主调试时点这个能立刻验"这条动作真能让灯亮/屏切吗", 不用先存场景再整体跑.
 */
const testingId = ref<number | null>(null);
async function testAction(row: SceneAction): Promise<void> {
  if (testingId.value) return;
  testingId.value = row.id;
  try {
    const res = await adminSceneActionService.test(row.id);
    if (res?.ok) ElMessage.success(`已触发: ${humanizeAction(row.deviceType, row.deviceId, row.command, row.params)}`);
    else ElMessage.error(`执行失败: ${res?.error ?? '未知'}`);
  } catch (err) {
    ElMessage.error('试触发失败: ' + (err as Error).message);
  } finally {
    testingId.value = null;
  }
}

/** 复制动作 — 同 scene 内插一条一样的, sortOrder 紧跟原来 +1 */
async function cloneAction(row: SceneAction): Promise<void> {
  if (!perm.canEdit) return;
  try {
    let params: Record<string, unknown> = {};
    try { params = row.params ? JSON.parse(row.params) : {}; } catch { /* ignore */ }
    await adminSceneActionService.create(sceneId.value, {
      deviceType: row.deviceType,
      deviceId: row.deviceId,
      command: row.command,
      params,
      delayMs: row.delayMs,
      sortOrder: row.sortOrder + 1,
      enabled: row.enabled,
    });
    ElMessage.success('已复制');
    await refresh();
  } catch (err) {
    ElMessage.error('复制失败: ' + (err as Error).message);
  }
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
    <header class="hero">
      <div class="hero-left">
        <button class="row-btn back-btn" @click="goBack">
          <ChevronLeft :size="14" :stroke-width="2" /> 返回
        </button>
        <div class="sc-head-ico"><Settings2 :size="22" :stroke-width="1.75" /></div>
        <div v-if="scene">
          <h2 class="sc-title">{{ scene.name }} <span class="hero-tag">动作配置</span></h2>
          <div class="sc-subtle">code: <code class="code-cell" style="margin-left:4px;">{{ scene.code }}</code> · 共 {{ rows.length }} 个动作</div>
        </div>
      </div>
      <div class="hero-right">
        <button class="sc-touch sc-act sc-act-neutral hero-btn" :disabled="loading" @click="refresh">
          <Loader v-if="loading" :size="16" class="spin" :stroke-width="2" />
          <RefreshCw v-else :size="16" :stroke-width="2" />
          刷新
        </button>
        <button class="sc-touch sc-act sc-act-success hero-btn" :disabled="!perm.canExecute || !scene" @click="testExecute">
          <Play :size="16" :stroke-width="2" /> 测试执行
        </button>
        <button class="sc-touch sc-act sc-act-primary hero-btn" :disabled="!perm.canEdit" @click="openCreate">
          <Plus :size="16" :stroke-width="2" /> 新增动作
        </button>
      </div>
    </header>

    <el-table v-loading="loading" :data="rows" stripe size="default" row-key="id">
      <el-table-column prop="sortOrder" label="序" width="44" align="center" sortable :sort-method="sortBySort" />
      <el-table-column label="类型" width="68">
        <template #default="{ row }">
          <span class="type-cell">
            {{ DEVICE_TYPE_META[row.deviceType]?.icon ?? '⚙' }} {{ DEVICE_TYPE_META[row.deviceType]?.label ?? row.deviceType }}
          </span>
        </template>
      </el-table-column>
      <el-table-column prop="deviceId" label="设备 / 区域" min-width="80">
        <template #default="{ row }">
          <code class="code-cell">{{ row.deviceId }}</code>
        </template>
      </el-table-column>
      <el-table-column label="操作" width="84">
        <template #default="{ row }">
          <span class="cmd-cell">
            {{ getCommandSpec(row.deviceType, row.command)?.label ?? row.command }}
          </span>
          <div class="cmd-raw">{{ row.command }}</div>
        </template>
      </el-table-column>
      <el-table-column label="预览 (人话)" min-width="88">
        <template #default="{ row }">
          <div class="preview-text">{{ humanizeAction(row.deviceType, row.deviceId, row.command, row.params) }}</div>
          <code class="params" v-if="row.params && row.params !== '{}'">{{ row.params }}</code>
        </template>
      </el-table-column>
      <el-table-column prop="delayMs" label="延时" width="52">
        <template #default="{ row }"><span class="sub-mono">{{ row.delayMs }}ms</span></template>
      </el-table-column>
      <el-table-column label="启用" width="48">
        <template #default="{ row }">
          <el-switch :model-value="row.enabled" :disabled="!perm.canEdit" @change="toggleEnabled(row)" />
        </template>
      </el-table-column>
      <el-table-column label="操作" width="276" fixed="right" align="right">
        <template #default="{ row }">
          <button class="row-btn" @click="move(row, -1)" :disabled="!perm.canEdit" title="上移">
            <ChevronUp :size="13" :stroke-width="2" />
          </button>
          <button class="row-btn" @click="move(row, 1)" :disabled="!perm.canEdit" title="下移">
            <ChevronDown :size="13" :stroke-width="2" />
          </button>
          <button class="row-btn row-btn-test" @click="testAction(row)" :disabled="!perm.canExecute || testingId !== null" title="试触发: 单独触发这条 (不进队列)">
            <Loader v-if="testingId === row.id" :size="13" :stroke-width="2" class="spin" />
            <Zap v-else :size="13" :stroke-width="2" />
          </button>
          <button class="row-btn" @click="cloneAction(row)" :disabled="!perm.canEdit" title="复制一条">
            <Copy :size="13" :stroke-width="2" />
          </button>
          <button class="row-btn" @click="openEdit(row)" :disabled="!perm.canEdit" title="编辑">
            <Pencil :size="13" :stroke-width="2" />
          </button>
          <button class="row-btn row-btn-danger" @click="remove(row)" :disabled="!perm.canEdit" title="删除">
            <Trash2 :size="13" :stroke-width="2" />
          </button>
        </template>
      </el-table-column>
    </el-table>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新增动作' : '编辑动作'"
      width="720"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-position="top" status-icon class="action-form">
        <!-- 第 1 步: 设备类型 -->
        <el-form-item label="① 选设备类型" prop="deviceType">
          <el-select v-model="form.deviceType" style="width: 100%;">
            <el-option v-for="t in deviceTypeOptionsExt" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>

        <!-- 第 2 步: 设备 (按类型下拉) -->
        <el-form-item label="② 选具体设备" prop="deviceId">
          <ActionDeviceSelector v-model="form.deviceId" :device-type="form.deviceType" />
        </el-form-item>

        <!-- 第 3 步: 操作 -->
        <el-form-item label="③ 选操作" prop="command">
          <el-select v-model="form.command" filterable allow-create placeholder="选一个操作" style="width: 100%;">
            <el-option
              v-for="c in availableCommands"
              :key="c.value"
              :label="c.label"
              :value="c.value"
            >
              <span style="float: left;">{{ c.label }}</span>
              <span style="float: right; color: var(--v2-text-3); font-size: 12px; margin-left: 12px;">{{ c.value }}</span>
            </el-option>
          </el-select>
          <div v-if="currentSpec?.description" class="cmd-desc">{{ currentSpec.description }}</div>
        </el-form-item>

        <!-- 第 4 步: 参数 — 智能 form / JSON 高级模式切换 -->
        <el-form-item :label="advancedJson ? '④ 参数 (JSON 高级)' : '④ 参数'" prop="paramsRaw">
          <div class="param-section">
            <div class="param-mode-row">
              <el-button v-if="!advancedJson" link type="primary" size="small" @click="toggleAdvanced">
                <Code2 :size="13" /> 切到 JSON 高级模式
              </el-button>
              <el-button v-else link type="primary" size="small" @click="toggleAdvanced">
                <Wand2 :size="13" /> 切回智能模式
              </el-button>
            </div>

            <!-- 智能 form 模式 -->
            <ActionParamForm
              v-if="!advancedJson && currentSpec"
              v-model="form.paramsForm"
              :spec="currentSpec"
            />
            <div v-else-if="!advancedJson && !currentSpec" class="no-schema-hint">
              这个命令 ({{ form.deviceType }}.{{ form.command }}) 还没注册智能 schema,
              请用 JSON 模式输入参数 →
              <el-button link type="primary" size="small" @click="toggleAdvanced">切到 JSON</el-button>
            </div>

            <!-- JSON 高级模式 -->
            <el-input
              v-if="advancedJson"
              v-model="form.paramsRaw"
              type="textarea"
              :rows="5"
              placeholder='例: {"value":80}'
              class="json-textarea"
            />
          </div>
        </el-form-item>

        <!-- 时序参数 -->
        <div class="form-row">
          <el-form-item label="延时 (毫秒)" class="half">
            <el-input-number v-model="form.delayMs" :min="0" :step="100" />
            <div class="cmd-desc">动作触发前先等多少毫秒</div>
          </el-form-item>
          <el-form-item label="执行顺序" class="half">
            <el-input-number v-model="form.sortOrder" :min="0" />
            <div class="cmd-desc">相同顺序并行, 不同顺序按升序串行</div>
          </el-form-item>
          <el-form-item label="启用" class="quarter">
            <el-switch v-model="form.enabled" />
          </el-form-item>
        </div>
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
.hero { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
.hero-left { display: flex; align-items: center; gap: 12px; }
.hero-right { display: flex; gap: 10px; }
.hero-btn { min-height: 42px; padding: 0 16px; }
.hero-tag {
  font-size: 12px;
  padding: 2px 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  color: var(--text-secondary);
  margin-left: 6px;
  font-weight: 500;
  vertical-align: middle;
}
.back-btn { margin-right: 4px; padding: 6px 10px; }

.code-cell {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}
.sub-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; color: var(--text-secondary); }
.params { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; color: var(--text-secondary); }
.hint { font-size: 12px; margin-top: 4px; }

.row-btn {
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border: 1px solid var(--border-soft);
  border-radius: 6px;
  padding: 4px 8px;
  margin-left: 6px;
  cursor: pointer;
  font-size: 12px;
  display: inline-flex; align-items: center; gap: 4px;
  font-family: inherit;
  touch-action: manipulation;
  transition: all 0.15s;
}
.row-btn:hover:not(:disabled) { color: #c7d2fe; border-color: rgba(99, 102, 241, 0.5); }
.row-btn-danger:hover:not(:disabled) { color: #f87171; border-color: rgba(239, 68, 68, 0.5); }
.row-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

/* 表格类型 / 操作列友好显示 */
.type-cell {
  font-size: 13px;
  color: var(--v2-text-1);
}
.cmd-cell {
  font-size: 13px;
  color: var(--v2-text-1);
  font-weight: 500;
}
.cmd-raw {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: var(--v2-text-3);
  margin-top: 2px;
}

/* 人话预览 */
.preview-text {
  font-size: 13px;
  color: var(--v2-text-1);
  line-height: 1.5;
}
.preview-text + .params {
  display: block;
  margin-top: 4px;
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 10.5px;
  color: var(--v2-text-3);
}

/* "试触发" 按钮强调 */
.row-btn-test {
  color: var(--v2-warning) !important;
  border-color: rgba(245, 158, 11, 0.4) !important;
}
.row-btn-test:hover:not(:disabled) {
  background: rgba(245, 158, 11, 0.08);
  color: #fbbf24 !important;
  border-color: rgba(245, 158, 11, 0.6) !important;
}

/* 新版 form */
.action-form :deep(.el-form-item__label) {
  font-weight: 500;
  color: var(--v2-text-1);
  padding-bottom: 6px;
  line-height: 1.4;
}
.cmd-desc {
  margin-top: 4px;
  font-size: 12px;
  color: var(--v2-text-3);
  line-height: 1.5;
}
.param-section {
  width: 100%;
  background: rgba(255, 255, 255, 0.025);
  border: 1px solid var(--v2-border-soft);
  border-radius: 8px;
  padding: 12px 14px;
}
.param-mode-row {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
.no-schema-hint {
  padding: 12px;
  background: rgba(245, 158, 11, 0.08);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 6px;
  font-size: 12px;
  color: var(--v2-text-2);
  line-height: 1.6;
}
.json-textarea :deep(textarea) {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
}
.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr 100px;
  gap: 14px;
  align-items: start;
}
@media (max-width: 720px) {
  .form-row { grid-template-columns: 1fr; }
}
</style>
