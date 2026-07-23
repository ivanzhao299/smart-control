<script setup lang="ts">
// 投影视频融合器 (JBT-SK-HD02) 控制面板 —— 走后端 /api/projector/* (已实机验通的核心命令)。
// 2026-07-23 重写: 原来这页是 in-house PlayerConsole slot2(GK9000 渲染 HDMI2), 跟现场这台
// 融合器是两套。现在直接控这台融合器: 看/摆/切/关窗口 + 音量。
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useRouter } from 'vue-router';
import { ArrowLeft, MonitorPlay, RefreshCw, X, Plus, Volume2, AlertTriangle, Layout, Trash2 } from 'lucide-vue-next';
import { projectorService, type ProjectorStatus } from '@/services/projector.service';

const router = useRouter();
function goBack(): void { router.push({ name: 'dashboard' }); }

const status = ref<ProjectorStatus | null>(null);
const loading = ref(false);
const loadError = ref<string | null>(null);
const busy = ref(false);
const selectedId = ref<number | null>(null);
const newSource = ref('');
const vol = ref(50);

const windows = computed(() => status.value?.windows ?? []);
const selected = computed(() => windows.value.find((w) => w.id === selectedId.value) ?? null);
/** 可控窗口: 排除默认播放窗口(id=-1, enum 里 id 空, 不能用数字 id 操作) */
const controllable = computed(() => windows.value.filter((w) => w.id >= 0));
/** 现有窗口用过的源, 给"开窗"快速填 */
const knownSources = computed(() => Array.from(new Set(windows.value.map((w) => w.source).filter(Boolean))));

async function load(): Promise<void> {
  loading.value = true;
  loadError.value = null;
  try {
    status.value = await projectorService.status();
    if (selectedId.value != null && !windows.value.some((w) => w.id === selectedId.value)) {
      selectedId.value = null;
    }
  } catch (err) {
    loadError.value = (err as Error).message;
  } finally {
    loading.value = false;
  }
}

async function selectWindow(id: number): Promise<void> {
  if (id < 0) return;
  selectedId.value = id;
  try {
    const v = await projectorService.getVolume(id);
    vol.value = v.volume;
  } catch { /* 音量读不到就保持上一个 */ }
}

// 布局预设 (归一化 x,y,w,h)
const LAYOUTS: Array<{ key: string; label: string; box: [number, number, number, number] }> = [
  { key: 'full', label: '全屏', box: [0, 0, 1, 1] },
  { key: 'left', label: '左半', box: [0, 0, 0.5, 1] },
  { key: 'right', label: '右半', box: [0.5, 0, 0.5, 1] },
  { key: 'tl', label: '左上', box: [0, 0, 0.5, 0.5] },
  { key: 'tr', label: '右上', box: [0.5, 0, 0.5, 0.5] },
  { key: 'bl', label: '左下', box: [0, 0.5, 0.5, 0.5] },
  { key: 'br', label: '右下', box: [0.5, 0.5, 0.5, 0.5] },
  { key: 'pip', label: '角落画中画', box: [0.72, 0.03, 0.25, 0.25] },
];

async function guarded(fn: () => Promise<unknown>, okMsg?: string): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await fn();
    if (okMsg) ElMessage.success(okMsg);
    await load();
  } catch (err) {
    ElMessage.error((err as Error).message);
  } finally {
    busy.value = false;
  }
}

async function applyLayout(box: [number, number, number, number]): Promise<void> {
  const w = selected.value;
  if (!w) return;
  await guarded(async () => {
    await projectorService.move(w.id, box[0], box[1]);
    await projectorService.resize(w.id, box[2], box[3]);
  }, '布局已应用');
}

async function openWindow(box: [number, number, number, number]): Promise<void> {
  const src = newSource.value.trim();
  if (!src) { ElMessage.warning('请先填信号源名称'); return; }
  await guarded(async () => {
    const r = await projectorService.open(src, box[0], box[1], box[2], box[3]);
    selectedId.value = r.windowId;
  }, '已开窗');
}

async function closeWindow(id: number): Promise<void> {
  await guarded(() => projectorService.close(id), '已关窗');
}
async function cleanAll(): Promise<void> {
  await guarded(() => projectorService.clean(), '已清空窗口');
}
function onVolChange(e: Event): void {
  const id = selectedId.value;
  if (id == null || id < 0) return;
  const v = +(e.target as HTMLInputElement).value;
  vol.value = v;
  void guarded(() => projectorService.setVolume(id, v));
}

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void load();
  timer = setInterval(() => { if (!busy.value) void load(); }, 4000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <section class="v2-page">
    <header class="v2-page-head">
      <div class="back-row">
        <button class="v2-back-btn" @click="goBack" title="返回首页">
          <ArrowLeft :size="18" :stroke-width="2" />
        </button>
        <div class="title"><MonitorPlay :size="18" :stroke-width="1.8" /> 投影融合器</div>
      </div>
      <div class="head-right">
        <span v-if="status" class="chip" :class="status.kind === 'FUSION' ? 'ok' : ''">
          {{ status.kind || '—' }} · v{{ status.version || '—' }}
        </span>
        <button class="v2-quick" @click="load" :disabled="loading" title="刷新">
          <RefreshCw :size="14" :class="{ spin: loading }" /> 刷新
        </button>
      </div>
    </header>

    <div v-if="loadError" class="state-card error">
      <AlertTriangle :size="28" /> <div>连接融合器失败: {{ loadError }}</div>
      <button class="v2-quick" @click="load">重试</button>
    </div>

    <template v-else>
      <div v-if="status?.planRunning" class="plan-warn">
        <AlertTriangle :size="15" /> 融合器正在运行预案 —— 此时开/关/移动窗口可能不生效, 需先在设备上停止预案。
      </div>

      <div class="main-grid">
        <!-- 左: 可视化布局画布 -->
        <div class="canvas-card">
          <div class="card-label"><Layout :size="14" /> 输出画面布局 <span class="dim">(点窗口选中)</span></div>
          <div class="canvas">
            <div
              v-for="w in windows"
              :key="w.id"
              class="win-box"
              :class="{ selected: w.id === selectedId, ghost: w.id < 0 }"
              :style="{ left: w.x * 100 + '%', top: w.y * 100 + '%', width: w.width * 100 + '%', height: w.height * 100 + '%' }"
              @click="selectWindow(w.id)"
              :title="w.id < 0 ? '默认播放窗口 (不可用数字ID控制)' : '窗口 ' + w.id"
            >
              <span class="win-src">{{ w.source || '(无源)' }}</span>
              <span class="win-id">{{ w.id < 0 ? '默认' : '#' + w.id }}</span>
            </div>
            <div v-if="windows.length === 0" class="canvas-empty">当前无窗口</div>
          </div>
        </div>

        <!-- 右: 控制 -->
        <div class="ctl-col">
          <div class="ctl-card">
            <div class="card-label"><Plus :size="14" /> 开新窗口</div>
            <input v-model="newSource" class="src-input" placeholder="信号源名称 (如 media 里的文件名)" />
            <div v-if="knownSources.length" class="src-chips">
              <button v-for="s in knownSources" :key="s" class="src-chip" @click="newSource = s" :title="s">{{ s }}</button>
            </div>
            <div class="layout-grid">
              <button v-for="l in LAYOUTS" :key="l.key" class="lay-btn" :disabled="busy || !newSource.trim()" @click="openWindow(l.box)">
                {{ l.label }}
              </button>
            </div>
          </div>

          <div class="ctl-card" v-if="selected">
            <div class="card-label">
              <MonitorPlay :size="14" /> 窗口 #{{ selected.id }} 控制
              <button class="close-x" @click="closeWindow(selected.id)" :disabled="busy" title="关闭此窗口"><X :size="14" /></button>
            </div>
            <div class="cur-src" :title="selected.source">{{ selected.source || '(无源)' }}</div>
            <div class="dim sub">摆放</div>
            <div class="layout-grid">
              <button v-for="l in LAYOUTS" :key="l.key" class="lay-btn" :disabled="busy" @click="applyLayout(l.box)">{{ l.label }}</button>
            </div>
            <div class="vol-row">
              <Volume2 :size="15" />
              <input type="range" min="0" max="100" step="1" :value="vol" @change="onVolChange" />
              <span class="vol-num v2-inter">{{ vol }}</span>
            </div>
          </div>
          <div class="ctl-card hint" v-else-if="controllable.length">
            点左侧画面里的窗口进行控制
          </div>

          <button class="v2-quick danger clean" @click="cleanAll" :disabled="busy || windows.length === 0">
            <Trash2 :size="14" /> 清空所有窗口
          </button>
        </div>
      </div>

      <div class="list-card" v-if="controllable.length">
        <div class="card-label">窗口清单</div>
        <div class="win-row" v-for="w in controllable" :key="w.id" :class="{ selected: w.id === selectedId }" @click="selectWindow(w.id)">
          <span class="wr-id">#{{ w.id }}</span>
          <span class="wr-src">{{ w.source }}</span>
          <span class="wr-pos v2-inter">{{ (w.x * 100).toFixed(0) }},{{ (w.y * 100).toFixed(0) }} · {{ (w.width * 100).toFixed(0) }}×{{ (w.height * 100).toFixed(0) }}%</span>
          <button class="close-x" @click.stop="closeWindow(w.id)" :disabled="busy"><X :size="13" /></button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.v2-page { padding: var(--v2-sp-5); display: flex; flex-direction: column; gap: var(--v2-sp-4); }
.v2-page-head { display: flex; justify-content: space-between; align-items: center; gap: var(--v2-sp-4); flex-wrap: wrap; }
.back-row { display: flex; align-items: center; gap: var(--v2-sp-3); }
.v2-back-btn { width: 36px; height: 36px; border-radius: var(--v2-r-sm); background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-2); cursor: pointer; display: grid; place-items: center; }
.v2-back-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.title { display: flex; align-items: center; gap: var(--v2-sp-2); font-size: 18px; font-weight: 700; color: var(--v2-text-1); }
.head-right { display: flex; align-items: center; gap: var(--v2-sp-2); }
.v2-quick { display: inline-flex; align-items: center; gap: 5px; padding: 7px 12px; border-radius: var(--v2-r-sm); font-size: var(--v2-fs-sm); background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); color: var(--v2-text-2); cursor: pointer; }
.v2-quick:hover:not(:disabled) { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.v2-quick:disabled { opacity: 0.5; cursor: default; }
.v2-quick.danger { background: var(--v2-danger-soft); color: var(--v2-danger); border-color: transparent; }
.chip { font-size: 11px; padding: 4px 10px; border-radius: 999px; background: var(--v2-surf-2); color: var(--v2-text-2); border: 1px solid var(--v2-border-soft); font-family: 'Inter', monospace; }
.chip.ok { background: var(--v2-success-soft); color: var(--v2-success); border-color: transparent; }
.spin { animation: sp 0.9s linear infinite; } @keyframes sp { to { transform: rotate(360deg); } }

.plan-warn { display: flex; align-items: center; gap: 8px; padding: 9px 14px; border-radius: var(--v2-r-sm); background: var(--v2-warning-soft); color: var(--v2-warning); font-size: var(--v2-fs-sm); font-weight: 600; }

.main-grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: var(--v2-sp-4); align-items: start; }
@media (max-width: 860px) { .main-grid { grid-template-columns: 1fr; } }

.canvas-card, .ctl-card, .list-card { background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); border-radius: var(--v2-r-lg); padding: var(--v2-sp-4); }
.card-label { display: flex; align-items: center; gap: 6px; font-size: var(--v2-fs-sm); font-weight: 700; color: var(--v2-text-1); margin-bottom: var(--v2-sp-3); }
.dim { color: var(--v2-text-3); font-weight: 400; } .sub { font-size: 11px; margin: 8px 0 4px; }

.canvas { position: relative; width: 100%; aspect-ratio: 16 / 9; background: repeating-conic-gradient(var(--v2-surf-2) 0% 25%, var(--v2-surf-3) 0% 50%) 50% / 28px 28px; border: 1px solid var(--v2-border-strong); border-radius: var(--v2-r-md); overflow: hidden; }
.win-box { position: absolute; box-sizing: border-box; border: 2px solid var(--v2-primary); background: var(--v2-primary-soft); display: flex; flex-direction: column; justify-content: space-between; padding: 4px 6px; cursor: pointer; overflow: hidden; transition: box-shadow 0.15s; }
.win-box.ghost { border-style: dashed; border-color: var(--v2-text-3); background: transparent; cursor: default; }
.win-box.selected { box-shadow: 0 0 0 2px var(--v2-primary), 0 0 18px -4px var(--v2-primary); z-index: 2; }
.win-src { font-size: 11px; color: var(--v2-text-1); font-weight: 600; line-height: 1.2; word-break: break-all; }
.win-id { font-size: 10px; color: var(--v2-text-2); font-family: 'Inter', monospace; align-self: flex-end; }
.canvas-empty { position: absolute; inset: 0; display: grid; place-items: center; color: var(--v2-text-3); font-size: var(--v2-fs-sm); }

.ctl-col { display: flex; flex-direction: column; gap: var(--v2-sp-3); }
.src-input { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: var(--v2-r-sm); background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft); color: var(--v2-text-1); font-size: var(--v2-fs-sm); }
.src-chips { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }
.src-chip { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 10px; padding: 3px 8px; border-radius: 999px; background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft); color: var(--v2-text-2); cursor: pointer; }
.layout-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; margin-top: 8px; }
.lay-btn { padding: 7px 4px; border-radius: var(--v2-r-sm); background: var(--v2-surf-2); border: 1px solid var(--v2-border-soft); color: var(--v2-text-2); font-size: 11px; cursor: pointer; }
.lay-btn:hover:not(:disabled) { background: var(--v2-primary-soft); color: var(--v2-primary); border-color: var(--v2-primary); }
.lay-btn:disabled { opacity: 0.4; cursor: default; }
.cur-src { font-size: var(--v2-fs-sm); color: var(--v2-text-1); font-weight: 600; word-break: break-all; margin-bottom: 4px; }
.close-x { margin-left: auto; width: 24px; height: 24px; display: grid; place-items: center; border-radius: var(--v2-r-sm); background: var(--v2-danger-soft); color: var(--v2-danger); border: none; cursor: pointer; }
.close-x:disabled { opacity: 0.4; }
.vol-row { display: flex; align-items: center; gap: 8px; margin-top: 12px; color: var(--v2-text-2); }
.vol-row input[type=range] { flex: 1; accent-color: var(--v2-primary); }
.vol-num { font-size: 12px; color: var(--v2-text-1); min-width: 26px; text-align: right; }
.ctl-card.hint { color: var(--v2-text-3); font-size: var(--v2-fs-sm); text-align: center; }
.clean { justify-content: center; }

.win-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--v2-r-sm); cursor: pointer; }
.win-row:hover, .win-row.selected { background: var(--v2-surf-2); }
.wr-id { font-family: 'Inter', monospace; font-size: 12px; color: var(--v2-text-2); }
.wr-src { flex: 1; font-size: var(--v2-fs-sm); color: var(--v2-text-1); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wr-pos { font-size: 11px; color: var(--v2-text-3); }
.state-card { display: flex; align-items: center; gap: 12px; padding: var(--v2-sp-5); background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft); border-radius: var(--v2-r-lg); color: var(--v2-text-2); }
.state-card.error { color: var(--v2-danger); }
.v2-inter { font-family: 'Inter', monospace; }
</style>
