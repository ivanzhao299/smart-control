<template>
  <div class="metrics-admin">
    <header class="ma-hero">
      <h2>运营数据</h2>
      <p>这里发布的数字会同步到园区运营大屏（约 15 秒内自动更新，也可在播控卡片点「强制刷新」立即生效），刷新或重启都不会回退。</p>
      <p class="ma-baseline-tip">「当前在园人员 / 在场车辆」是 AI 实时数的<strong>基线</strong>：大屏实时显示 = 基线 + 各门进出场净增，由 AI 每 5 秒叠加。</p>
    </header>

    <div v-if="loading" class="ma-state">正在加载已发布的运营数据…</div>

    <template v-else>
      <section class="ma-card">
        <h3>来源与日期</h3>
        <label class="ma-field ma-span2">
          <span>数据来源</span>
          <input v-model="source" maxlength="200" placeholder="如：园区运营部 · 2026年9月口径" />
        </label>
        <label class="ma-field">
          <span>数据日期</span>
          <input v-model="date" type="date" />
        </label>
      </section>

      <section v-for="group in FIELD_GROUPS" :key="group" class="ma-card">
        <h3>{{ group }}</h3>
        <div class="ma-grid">
          <label v-for="f in fieldsOf(group)" :key="f.key" class="ma-field" :class="{ 'is-baseline': isBaseline(f.key) }">
            <span class="ma-label">
              {{ f.label }}
              <em v-if="isBaseline(f.key)" class="ma-tag">AI 基线</em>
            </span>
            <div class="ma-input-wrap">
              <input
                v-model="metricText[f.key]"
                type="number"
                inputmode="decimal"
                :min="0"
                :max="f.unit === '%' ? 100 : 1e9"
                step="any"
                placeholder="留空=未知"
              />
              <i class="ma-unit">{{ f.unit }}</i>
            </div>
            <label class="ma-placeholder">
              <input v-model="placeholderOn[f.key]" type="checkbox" />
              <span class="ma-ph-text">标记为占位（未接现场系统）</span>
            </label>
          </label>
        </div>
      </section>

      <details class="ma-card ma-content">
        <summary>运营内容 / 文案（高级）</summary>
        <label v-for="cf in COPY_FIELDS" :key="cf.key" class="ma-field ma-span2">
          <span>{{ cf.label }}</span>
          <textarea v-model="contentText[cf.key]" :rows="cf.isList ? 3 : 2"></textarea>
        </label>
      </details>

      <footer class="ma-actions">
        <button type="button" class="ma-btn ghost" :disabled="saving" @click="resetDefault">载入出厂默认</button>
        <button type="button" class="ma-btn primary" :disabled="saving" @click="save">
          {{ saving ? '正在发布…' : '保存并发布到大屏' }}
        </button>
      </footer>
      <p class="ma-foot-note">数字仅保存在服务器共享文档中（JSON），不改动数据库；产业结构五项合计须为 100%。</p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import {
  FIELDS, FIELD_GROUPS, COPY_FIELDS, buildDefaultDoc, validateDoc,
  fetchParkOpsMetrics, saveParkOpsMetrics, type ParkOpsMetricsDoc, type FieldMeta,
} from '@/services/park-ops-metrics.service';

const loading = ref(true);
const saving = ref(false);
const source = ref('');
const date = ref('');
const metricText = reactive<Record<string, string>>({});
const placeholderOn = reactive<Record<string, boolean>>({});
const contentText = reactive<Record<string, string>>({});

function toDateInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' }); // yyyy-mm-dd
}

function fill(doc: ParkOpsMetricsDoc) {
  source.value = doc.source;
  date.value = toDateInput(doc.updatedAt);
  for (const f of FIELDS) {
    const v = doc.metrics[f.key];
    metricText[f.key] = v === null || v === undefined ? '' : String(v);
    placeholderOn[f.key] = doc.placeholderKeys.includes(f.key);
  }
  for (const cf of COPY_FIELDS) {
    const v = doc.content[cf.key];
    contentText[cf.key] = Array.isArray(v) ? v.join('\n') : (v ?? '');
  }
}

async function load() {
  loading.value = true;
  try {
    const remote = await fetchParkOpsMetrics();
    if (remote) {
      fill(remote);
    } else {
      fill(buildDefaultDoc());
      ElMessage.info('尚未发布过运营数据，已载入出厂默认值，修改后点「保存并发布」。');
    }
  } catch (e) {
    fill(buildDefaultDoc());
    ElMessage.warning('读取服务端数据失败，已载入出厂默认值供编辑。');
  } finally {
    loading.value = false;
  }
}

function collect(): ParkOpsMetricsDoc {
  const metrics: Record<string, number | null> = {};
  for (const f of FIELDS) {
    // v-model 在 type="number" 输入上会自动转为 number, 这里统一回字符串再判空
    const raw = String(metricText[f.key] ?? '').trim();
    metrics[f.key] = raw === '' ? null : Number(raw);
  }
  const placeholderKeys = FIELDS.filter((f) => placeholderOn[f.key]).map((f) => f.key);
  const content: Record<string, string | string[]> = {};
  for (const cf of COPY_FIELDS) {
    const raw = contentText[cf.key] ?? '';
    content[cf.key] = cf.isList
      ? raw.split('\n').map((x) => x.trim()).filter(Boolean)
      : raw;
  }
  const updatedAt = date.value ? `${date.value}T00:00:00+08:00` : new Date().toISOString();
  return validateDoc({ version: 1, source: source.value, updatedAt, placeholderKeys, metrics, content });
}

async function save() {
  let doc: ParkOpsMetricsDoc;
  try {
    doc = collect();
  } catch (e) {
    ElMessage.error((e as Error).message);
    return;
  }
  saving.value = true;
  try {
    await saveParkOpsMetrics(doc);
    ElMessage.success('已发布，运营大屏约 15 秒内自动更新（或点强制刷新立即生效）。');
  } catch (e) {
    ElMessage.error(`发布失败：${(e as Error).message || '请检查是否已用管理员登录'}`);
  } finally {
    saving.value = false;
  }
}

function resetDefault() {
  fill(buildDefaultDoc());
  ElMessage.info('已载入出厂默认值到表单，尚未发布，点「保存并发布」才会生效。');
}

const fieldsOf = (group: string): FieldMeta[] => FIELDS.filter((f) => f.group === group);
const isBaseline = (key: string): boolean => key === 'people' || key === 'vehicles';

onMounted(load);
</script>

<style scoped>
/* 统一深色主题: 全部走 design-tokens 变量, 不写死颜色, 与后台管理其他页面一致 */
.metrics-admin { padding: 4px 4px 96px; max-width: 920px; margin: 0 auto; color: var(--v2-text-2); min-width: 0; overflow-x: hidden; }
.ma-hero h2 { margin: 0 0 8px; font-size: 20px; color: var(--v2-text-1); }
.ma-hero p { margin: 4px 0; font-size: 13px; line-height: 1.6; color: var(--v2-text-3); }
.ma-baseline-tip strong { color: var(--v2-success); font-weight: 700; }
.ma-state { padding: 32px; text-align: center; color: var(--v2-text-3); }
.ma-card {
  background: var(--v2-surf-1);
  border: 1px solid var(--v2-border-soft);
  border-radius: 14px;
  padding: 14px;
  margin: 12px 0;
  box-shadow: var(--v2-elev-1);
}
.ma-card h3 { margin: 0 0 12px; font-size: 15px; color: var(--v2-text-1); }
.ma-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
.ma-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--v2-text-3); min-width: 0; }
.ma-span2 { grid-column: 1 / -1; min-width: 0; }
.ma-label { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-weight: 600; color: var(--v2-text-2); line-height: 1.3; min-width: 0; }
.ma-tag { flex-shrink: 0; font-style: normal; font-size: 10px; color: #04101f; background: var(--v2-success); border-radius: 6px; padding: 1px 6px; font-weight: 700; }
.is-baseline .ma-input-wrap input { border-color: var(--v2-success); }
.ma-input-wrap { position: relative; display: flex; align-items: center; min-width: 0; }

/* 所有原生输入控件统一深色内陷面 */
.ma-field input, .ma-content textarea {
  width: 100%; min-width: 0; box-sizing: border-box; border: 1px solid var(--v2-border-soft); border-radius: 9px;
  padding: 8px 10px; font-size: 16px; color: var(--v2-text-1);
  background: var(--v2-inset-bg); font-family: inherit;
}
.ma-input-wrap input { padding-right: 34px; font-size: 16px; }
.ma-field input:focus, .ma-content textarea:focus {
  outline: none; border-color: var(--v2-primary); box-shadow: 0 0 0 2px var(--v2-primary-soft);
}
.ma-field input::placeholder, .ma-content textarea::placeholder { color: var(--v2-text-3); }
.ma-field input[type="date"] { color-scheme: dark; }
.ma-unit { position: absolute; right: 10px; font-style: normal; font-size: 11px; color: var(--v2-text-3); }
.ma-placeholder { display: flex; align-items: flex-start; gap: 5px; font-size: 11px; line-height: 1.35; color: var(--v2-text-3); font-weight: 400; width: 100%; min-width: 0; }
.ma-placeholder input[type="checkbox"] { accent-color: var(--v2-primary); flex: 0 0 auto; width: 15px; height: 15px; margin-top: 2px; }
.ma-ph-text { flex: 1 1 auto; min-width: 0; }
.ma-content summary { cursor: pointer; font-size: 15px; font-weight: 600; color: var(--v2-text-2); }
.ma-content[open] summary { margin-bottom: 12px; }
.ma-content textarea { resize: vertical; }
.ma-actions {
  position: fixed; left: 0; right: 0; bottom: 0; display: flex; gap: 10px;
  padding: 12px 16px calc(12px + env(safe-area-inset-bottom));
  background: var(--v2-chrome-bg-solid); border-top: 1px solid var(--v2-border-soft); backdrop-filter: blur(6px);
  max-width: 920px; margin: 0 auto;
}
.ma-btn { flex: 1; padding: 12px; border-radius: 11px; font-size: 15px; font-weight: 600; border: 1px solid transparent; cursor: pointer; }
.ma-btn.primary { background: var(--v2-primary); color: #fff; }
.ma-btn.primary:hover { background: var(--v2-primary-hover); }
.ma-btn.primary:disabled { opacity: .6; cursor: not-allowed; }
.ma-btn.ghost { flex: 0 0 38%; background: var(--v2-surf-2); border-color: var(--v2-border-strong); color: var(--v2-text-2); }
.ma-btn.ghost:hover { background: var(--v2-surf-3); }
.ma-foot-note { text-align: center; font-size: 11px; color: var(--v2-text-3); margin-top: 8px; }

/* ============ 手机端 (≤560px): 两列等宽不横溢、对齐、底部按钮不折行 ============ */
@media (max-width: 560px) {
  .metrics-admin { padding: 0 2px 104px; }
  /* minmax(0,1fr) 关键: 允许列收缩到内容以下, 杜绝长 label/数字把栅格撑出横向滚动 */
  .ma-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 8px; }
  .ma-card { padding: 12px; border-radius: 12px; }
  .ma-hero h2 { font-size: 18px; }
  .ma-hero p { font-size: 12px; }
  .ma-card h3 { font-size: 14px; margin-bottom: 10px; }
  .ma-field input, .ma-content textarea { font-size: 16px; padding: 9px 10px; }
  .ma-actions { gap: 8px; padding: 10px 12px calc(10px + env(safe-area-inset-bottom)); }
  .ma-btn { padding: 12px 8px; font-size: 14px; white-space: nowrap; }
  .ma-btn.ghost { flex: 0 0 34%; }
}
/* 超窄屏 (≤340px): 单列, 彻底不挤 */
@media (max-width: 340px) {
  .ma-grid { grid-template-columns: minmax(0, 1fr); }
}
</style>
