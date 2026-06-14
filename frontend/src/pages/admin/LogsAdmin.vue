<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { FileText, Filter, Loader } from 'lucide-vue-next';
import { adminLogService, type LogsQuery } from '@/services/admin.service';
import type { OperationLogEntry } from '@/types/api';

const loading = ref(false);
const rows = ref<OperationLogEntry[]>([]);
const total = ref(0);

const filter = reactive<LogsQuery>({
  operator: '',
  action: '',
  targetType: '',
  result: undefined,
  startTime: undefined,
  endTime: undefined,
  page: 1,
  pageSize: 50,
});

const dateRange = ref<[Date, Date] | null>(null);

const actionOptions = [
  { label: '全部', value: '' },
  { label: '设备创建', value: 'device.create' },
  { label: '设备更新', value: 'device.update' },
  { label: '设备删除', value: 'device.delete' },
  { label: '场景创建', value: 'scene.create' },
  { label: '场景执行', value: 'scene.execute' },
  { label: '场景停止', value: 'scene.stop' },
  { label: '动作创建', value: 'scene-action.create' },
  { label: '灯光分区', value: 'lighting.zone.brightness' },
  { label: 'LED 控制', value: 'led.on' },
  { label: '空调控制', value: 'hvac.on' },
  { label: '音响控制', value: 'audio.volume' },
  { label: '定时任务触发', value: 'scheduler.fire' },
];

const targetTypeOptions = [
  { label: '全部', value: '' },
  { label: '设备', value: 'device' },
  { label: '场景', value: 'scene' },
  { label: '场景动作', value: 'scene-action' },
  { label: '定时任务', value: 'scheduler' },
  { label: '灯光分区', value: 'lighting-zone' },
  { label: 'LED', value: 'led' },
  { label: '音响', value: 'audio' },
  { label: '空调', value: 'hvac' },
  { label: '用户', value: 'user' },
];

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    if (dateRange.value && dateRange.value.length === 2) {
      filter.startTime = dateRange.value[0].toISOString();
      filter.endTime = dateRange.value[1].toISOString();
    } else {
      filter.startTime = undefined;
      filter.endTime = undefined;
    }
    const r = await adminLogService.list({
      ...filter,
      operator: filter.operator || undefined,
      action: filter.action || undefined,
      targetType: filter.targetType || undefined,
    });
    rows.value = r.list;
    total.value = r.total;
  } catch (err) {
    ElMessage.error('加载失败: ' + (err as Error).message);
  } finally {
    loading.value = false;
  }
}

function reset(): void {
  filter.operator = '';
  filter.action = '';
  filter.targetType = '';
  filter.result = undefined;
  dateRange.value = null;
  filter.page = 1;
  void refresh();
}

function onPage(p: number): void {
  filter.page = p;
  void refresh();
}

function prettyMessage(msg: string | null): string {
  if (!msg) return '—';
  try {
    const parsed = JSON.parse(msg);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return msg;
  }
}

onMounted(refresh);
</script>

<template>
  <section class="page">
    <header class="hero">
      <div class="hero-left">
        <div class="sc-head-ico"><FileText :size="22" :stroke-width="1.75" /></div>
        <div>
          <h2 class="sc-title">日志中心</h2>
          <div class="sc-subtle">操作审计 · 失败追踪 · 共 {{ total }} 条</div>
        </div>
      </div>
    </header>

    <div class="sc-panel filter-panel">
      <div class="section-title"><Filter :size="16" :stroke-width="1.75" /> 筛选</div>
      <div class="filters">
        <el-input v-model="filter.operator" placeholder="操作人" clearable style="width: 140px;" />
        <el-select v-model="filter.action" placeholder="操作类型" clearable style="width: 180px;">
          <el-option v-for="o in actionOptions" :key="o.value || 'all'" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="filter.targetType" placeholder="目标类型" clearable style="width: 140px;">
          <el-option v-for="o in targetTypeOptions" :key="o.value || 'all'" :label="o.label" :value="o.value" />
        </el-select>
        <el-select v-model="filter.result" placeholder="结果" clearable style="width: 110px;">
          <el-option label="成功" value="success" />
          <el-option label="失败" value="failure" />
        </el-select>
        <el-date-picker
          v-model="dateRange"
          type="datetimerange"
          range-separator="—"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          style="width: 360px;"
        />
        <button class="sc-touch sc-act sc-act-primary section-btn" :disabled="loading" @click="refresh">
          <Loader v-if="loading" :size="14" class="spin" :stroke-width="2" />
          <Filter v-else :size="14" :stroke-width="2" />
          查询
        </button>
        <button class="row-btn" @click="reset">重置</button>
      </div>
    </div>

    <el-table v-loading="loading" :data="rows" stripe size="default">
      <el-table-column label="时间" width="170">
        <template #default="{ row }"><span class="sub-mono">{{ new Date(row.createdAt).toLocaleString('zh-CN', { hour12: false }) }}</span></template>
      </el-table-column>
      <el-table-column prop="operator" label="操作人" width="150" />
      <el-table-column label="动作" width="190">
        <template #default="{ row }"><code class="code-cell">{{ row.action }}</code></template>
      </el-table-column>
      <el-table-column prop="targetType" label="目标类型" width="120" />
      <el-table-column label="结果" width="90">
        <template #default="{ row }">
          <span class="sc-status" :class="row.result === 'success' ? 'is-on' : 'is-error'">
            <span class="sc-status-dot" /> {{ row.result === 'success' ? '成功' : '失败' }}
          </span>
        </template>
      </el-table-column>
      <el-table-column label="消息" min-width="300">
        <template #default="{ row }">
          <el-popover :width="500" trigger="hover" placement="left-start">
            <template #reference>
              <span class="msg-cell">{{ row.message ?? '—' }}</span>
            </template>
            <pre class="msg-full">{{ prettyMessage(row.message) }}</pre>
          </el-popover>
        </template>
      </el-table-column>
    </el-table>

    <el-pagination
      class="pager"
      v-model:current-page="filter.page"
      :page-size="filter.pageSize"
      :total="total"
      layout="total, prev, pager, next"
      @current-change="onPage"
    />
  </section>
</template>

<style scoped>
.page { display: flex; flex-direction: column; gap: 16px; }
.hero { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
.hero-left { display: flex; align-items: center; gap: 14px; }

.filter-panel { display: flex; flex-direction: column; gap: 10px; }
.section-title { display: inline-flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
.section-btn { min-height: 36px; padding: 0 14px; font-size: 13px; }
.filters {
  display: flex; gap: 10px; flex-wrap: wrap; align-items: center;
}

.code-cell {
  font-family: 'JetBrains Mono', ui-monospace, monospace;
  font-size: 12px;
  color: #93c5fd;
  background: rgba(59, 130, 246, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}
.sub-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; font-size: 11.5px; color: var(--text-secondary); }
.row-btn {
  background: var(--bg-elevated); color: var(--text-secondary);
  border: 1px solid var(--border-soft); border-radius: 6px;
  padding: 4px 10px; cursor: pointer; font-size: 12px;
  font-family: inherit; touch-action: manipulation;
  transition: all 0.15s;
}
.row-btn:hover { color: #c7d2fe; border-color: rgba(99, 102, 241, 0.5); }

.spin { animation: spin 0.8s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }

.msg-cell {
  display: inline-block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}
.msg-full {
  font-family: ui-monospace, SFMono-Regular, monospace;
  font-size: 12px;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 400px;
  overflow: auto;
  margin: 0;
}
.pager { display: flex; justify-content: flex-end; }
</style>
