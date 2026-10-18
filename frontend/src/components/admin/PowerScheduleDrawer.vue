<script setup lang="ts">
/**
 * 电源回路自动开关规则（定时 + 日落/日出）共享面板。
 * 同时供：
 *  - 设备与分区 → 电源回路（hardware，硬件接线页）
 *  - 日常运行 → 自动开关（config，运营时间配置页）
 * 复用，避免两套规则 UI；写接口走 power-schedules（energy 模块，config/hardware 可写）。
 */
import { computed, onMounted, onUnmounted, reactive, ref } from 'vue';
import { Plus } from 'lucide-vue-next';
import { ElMessage, ElMessageBox, type FormInstance } from 'element-plus';
import {
  powerSchedulesService,
  type PowerCircuitView,
  type PowerScheduleRule,
  type PowerScheduleInput,
} from '@/services/power-circuits.service';

const emit = defineEmits<{ (e: 'changed', circuitId: number): void }>();

// 窄屏（手机 / 前台 PWA）自适应：抽屉加宽到 92%、规则弹窗 92vw；桌面后台保持 46% / 440px。
const isNarrow = ref(typeof window !== 'undefined' && window.innerWidth < 640);
function onViewportResize(): void { isNarrow.value = window.innerWidth < 640; }
onMounted(() => window.addEventListener('resize', onViewportResize));
onUnmounted(() => window.removeEventListener('resize', onViewportResize));
const drawerSize = computed(() => (isNarrow.value ? '92%' : '46%'));
const dialogWidth = computed(() => (isNarrow.value ? '92vw' : '440px'));

const visible = ref(false);
const circuit = ref<PowerCircuitView | null>(null);
const rules = ref<PowerScheduleRule[]>([]);
const loading = ref(false);

const ruleVisible = ref(false);
const ruleFormRef = ref<FormInstance>();
const ruleForm = reactive<{
  id?: number;
  action: 'on' | 'off';
  mode: 'fixed' | 'sunset' | 'sunrise';
  time: string;
  offsetMin: number;
  weekdays: string;
  enabled: boolean;
}>({
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
  set: (vals) => { ruleForm.weekdays = vals.join(','); },
});

async function open(c: PowerCircuitView): Promise<void> {
  circuit.value = c;
  visible.value = true;
  await load(c.id);
}
defineExpose({ open });

async function load(circuitId: number): Promise<void> {
  loading.value = true;
  try {
    rules.value = await powerSchedulesService.listForCircuit(circuitId);
  } catch (err) {
    ElMessage.error(`加载自动开关规则失败: ${(err as Error).message}`);
  } finally {
    loading.value = false;
  }
}

function openRuleCreate(): void {
  Object.assign(ruleForm, {
    id: undefined, action: 'on', mode: 'sunset', time: '18:30',
    offsetMin: 0, weekdays: '', enabled: true,
  });
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
  if (!ruleFormRef.value || !circuit.value) return;
  await ruleFormRef.value.validate(async (valid) => {
    if (!valid) return;
    const target = circuit.value as PowerCircuitView;
    const payload: PowerScheduleInput = {
      circuitId: target.id,
      action: ruleForm.action,
      mode: ruleForm.mode,
      time: ruleForm.mode === 'fixed' ? ruleForm.time : null,
      offsetMin: Number(ruleForm.offsetMin ?? 0),
      weekdays: ruleForm.weekdays
        ? ruleForm.weekdays.split(',').map((x) => x.trim()).filter(Boolean).join(',')
        : null,
      enabled: ruleForm.enabled,
    };
    try {
      if (ruleForm.id != null) await powerSchedulesService.update(ruleForm.id, payload);
      else await powerSchedulesService.create(payload);
      ElMessage.success(ruleForm.id != null ? '已更新规则' : '已新增规则');
      ruleVisible.value = false;
      await load(target.id);
      emit('changed', target.id);
    } catch (err) {
      ElMessage.error(`保存规则失败: ${(err as Error).message}`);
    }
  });
}

async function removeRule(r: PowerScheduleRule): Promise<void> {
  try {
    await ElMessageBox.confirm('删除这条自动开关规则?', '确认删除', {
      type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消',
    });
  } catch { return; }
  try {
    await powerSchedulesService.remove(r.id);
    ElMessage.success('已删除');
    if (circuit.value) await load(circuit.value.id);
    emit('changed', r.circuitId);
  } catch (err) {
    ElMessage.error(`删除失败: ${(err as Error).message}`);
  }
}

function toggleRule(r: PowerScheduleRule): void {
  powerSchedulesService.update(r.id, { enabled: !r.enabled })
    .then(async () => {
      if (circuit.value) await load(circuit.value.id);
      emit('changed', r.circuitId);
    })
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
</script>

<template>
  <!-- 自动开关规则列表 (定时/日落/日出) -->
  <el-drawer v-model="visible" :title="`自动开关 — ${circuit?.name ?? ''}`" :size="drawerSize" direction="rtl">
    <div class="sched-head">
      <p class="sched-sub">
        以日落/日出为参考点: 开、关都可设在参考点前后 (如日落前30分通电 + 日落后90分断电, 形成一段亮灯时间)。
        日落/日出按设备上报的园区经纬度每日自动重算 (NOAA 算法, ±5 分钟内)。动作经 4G 平台下发, 失败会记日志并在下一周期重试。
      </p>
      <el-button type="primary" size="small" class="sched-add" @click="openRuleCreate">
        <el-icon><Plus /></el-icon> 新增规则
      </el-button>
    </div>
    <div v-loading="loading" class="sched-list">
      <div v-if="!loading && rules.length === 0" class="sched-empty">还没有自动开关规则 — 点“新增规则”添加</div>
      <div v-for="r in rules" :key="r.id" class="sched-item">
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
  <el-dialog v-model="ruleVisible" :title="ruleForm.id != null ? '编辑规则' : '新增规则'" :width="dialogWidth">
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
        <el-input-number v-model="ruleForm.offsetMin" :min="-600" :max="600" controls-position="right" />
        <span class="hint inline">以{{ ruleForm.mode === 'sunset' ? '日落' : '日出' }}为参考: 负数=之前, 正数=之后 (日落前30分=-30); 范围前后 10 小时</span>
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
</template>

<style scoped>
.hint { font-size: 12px; color: var(--v2-text-2); margin-top: 4px; line-height: 1.5; }
.hint.inline { margin-left: 8px; }

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
.sched-item-ops { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
</style>
