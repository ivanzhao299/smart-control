<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue';
import { RefreshCw, Crosshair, Trash2, RotateCcw, Plus, Hand } from 'lucide-vue-next';
import { getApiBaseURL, getAdminToken, getClientToken } from '@/services/http';

/**
 * AI 检测范围编辑器（计数线 + 多边形 ROI）。
 *
 * - 拖拽为主：SVG 16:9 画布，拖计数线两端点定越线方向；拖 ROI 顶点圈定“只在区域内检测”，
 *   区域外目标 AI 不计数、不输出。pointer 事件统一鼠标 / 手指，touch-action:none 防页面滚动，
 *   顶点另设透明大热点照顾手指；
 * - 数值兜底：右侧 / 下方可直接填 0~1 坐标、增删顶点，拖不准也能精确录入；
 * - 对位底图：打开时拉该路一张 snapshot 当背景，可手动刷新；拉不到则显示网格，不阻塞编辑。
 * 坐标全部归一化 0~1，与分辨率无关，直接落库并下发 AI。
 */
interface Pt { x: number; y: number; }

const props = defineProps<{
  modelValue: boolean;
  channelId: string;
  title?: string;
  aiEnabled?: boolean;
  countLine?: Pt[] | null;
  roiPolygon?: Pt[] | null;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void;
  (e: 'save', payload: { aiEnabled: boolean; countLine: Pt[]; roiPolygon: Pt[] }): void;
}>();

// 16:9 逻辑坐标，归一化点 ×(W,H) 即 SVG 坐标；容器同样 16:9，meet 不拉伸、顶点保持正圆
const W = 1000;
const H = 562.5;
const DEFAULT_LINE: Pt[] = [{ x: 0.5, y: 0.2 }, { x: 0.5, y: 0.8 }];

const enabled = ref(true);
const line = ref<Pt[]>([{ ...DEFAULT_LINE[0] }, { ...DEFAULT_LINE[1] }]);
const roi = ref<Pt[]>([]);
const svgRef = ref<SVGSVGElement | null>(null);
const bgUrl = ref('');
const loadingShot = ref(false);
const selected = ref<{ kind: 'la' | 'lb' | 'roi'; idx: number } | null>(null);
let drag: { kind: 'la' | 'lb' | 'roi'; idx: number } | null = null;

const roiPointsAttr = computed(() =>
  roi.value.map(p => `${(p.x * W).toFixed(1)},${(p.y * H).toFixed(1)}`).join(' '));
const lineAx = computed(() => line.value[0].x * W);
const lineAy = computed(() => line.value[0].y * H);
const lineBx = computed(() => line.value[1].x * W);
const lineBy = computed(() => line.value[1].y * H);

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
function clonePts(pts?: Pt[] | null): Pt[] {
  return Array.isArray(pts) ? pts.map(p => ({ x: clamp01(Number(p.x)), y: clamp01(Number(p.y)) })) : [];
}

function resetInternal() {
  enabled.value = props.aiEnabled !== false;
  const l = clonePts(props.countLine);
  line.value = l.length === 2 ? l : [{ ...DEFAULT_LINE[0] }, { ...DEFAULT_LINE[1] }];
  roi.value = clonePts(props.roiPolygon);
  selected.value = null;
  drag = null;
}

async function refreshSnapshot() {
  if (!props.channelId) return;
  loadingShot.value = true;
  try {
    // 封装的 api 不透传 responseType，这里用原生 fetch 带鉴权头取一帧 JPEG blob
    const headers: Record<string, string> = {};
    const at = getAdminToken();
    const ct = getClientToken();
    if (at) headers.Authorization = `Bearer ${at}`;
    if (ct) headers['X-Client-Token'] = ct;
    const r = await fetch(`${getApiBaseURL()}/cameras/${props.channelId}/snapshot`, {
      headers, credentials: 'omit', cache: 'no-store',
    });
    if (!r.ok) throw new Error(`snapshot ${r.status}`);
    const blob = await r.blob();
    if (bgUrl.value) URL.revokeObjectURL(bgUrl.value);
    bgUrl.value = blob ? URL.createObjectURL(blob) : '';
  } catch {
    bgUrl.value = '';
  } finally {
    loadingShot.value = false;
  }
}

// 每次打开：用传入值重置并抓一张当前画面做对位
watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    resetInternal();
    await nextTick();
    void refreshSnapshot();
  }
);

function eventToNorm(e: PointerEvent | MouseEvent): Pt {
  const svg = svgRef.value;
  if (!svg) return { x: 0, y: 0 };
  const rect = svg.getBoundingClientRect();
  return {
    x: clamp01((e.clientX - rect.left) / Math.max(1, rect.width)),
    y: clamp01((e.clientY - rect.top) / Math.max(1, rect.height)),
  };
}

function startDrag(kind: 'la' | 'lb' | 'roi', idx: number, e: PointerEvent) {
  e.preventDefault();
  e.stopPropagation();
  (e.target as Element).setPointerCapture?.(e.pointerId);
  drag = { kind, idx };
  selected.value = { kind, idx };
}

function onDragMove(e: PointerEvent) {
  if (!drag) return;
  const p = eventToNorm(e);
  if (drag.kind === 'la') line.value[0] = p;
  else if (drag.kind === 'lb') line.value[1] = p;
  else roi.value[drag.idx] = p;
}

function endDrag() {
  drag = null;
}

function addRoiPoint() {
  if (roi.value.length === 0) {
    // 空区域时先给一个内缩矩形，拖四角即可快速成型
    roi.value = [
      { x: 0.2, y: 0.25 }, { x: 0.8, y: 0.25 }, { x: 0.8, y: 0.75 }, { x: 0.2, y: 0.75 },
    ];
    return;
  }
  const c = roi.value.reduce((a, p) => ({ x: a.x + p.x, y: a.y + p.y }), { x: 0, y: 0 });
  roi.value.push({ x: clamp01(c.x / roi.value.length + 0.03), y: clamp01(c.y / roi.value.length + 0.03) });
}

function removeRoiPoint(i: number) {
  roi.value.splice(i, 1);
  if (selected.value?.kind === 'roi' && selected.value.idx === i) selected.value = null;
}

function clearRoi() {
  roi.value = [];
  selected.value = null;
}

function resetLine() {
  line.value = [{ ...DEFAULT_LINE[0] }, { ...DEFAULT_LINE[1] }];
}

// 数值输入兜底
function setNum(target: 'la' | 'lb' | 'roi', idx: number, axis: 'x' | 'y', raw: string | number) {
  const v = clamp01(parseFloat(String(raw)));
  if (target === 'la') line.value[0][axis] = v;
  else if (target === 'lb') line.value[1][axis] = v;
  else if (roi.value[idx]) roi.value[idx][axis] = v;
}

function close() {
  emit('update:modelValue', false);
}

function save() {
  const outLine: Pt[] = [
    { x: clamp01(line.value[0].x), y: clamp01(line.value[0].y) },
    { x: clamp01(line.value[1].x), y: clamp01(line.value[1].y) },
  ];
  // 不足 3 点不构成区域，按“全画面”处理
  const outRoi = roi.value.length >= 3 ? roi.value.map(p => ({ x: clamp01(p.x), y: clamp01(p.y) })) : [];
  emit('save', { aiEnabled: enabled.value, countLine: outLine, roiPolygon: outRoi });
  emit('update:modelValue', false);
}
</script>

<template>
  <el-dialog
    :model-value="modelValue"
    :title="`AI 检测范围 · ${title || channelId}`"
    class="ai-region-dialog"
    width="860px"
    :close-on-click-modal="false"
    @update:model-value="(v: boolean) => emit('update:modelValue', v)"
  >
    <div class="are-topbar">
      <label class="are-enable">
        <input type="checkbox" v-model="enabled" />
        <span>该路启用 AI 分析 / 越线计数</span>
      </label>
      <el-button size="small" :loading="loadingShot" @click="refreshSnapshot">
        <RefreshCw :size="14" /> 刷新对位画面
      </el-button>
    </div>
    <p class="are-tip">
      黄色虚线为<strong>越线计数线</strong>（拖两端圆点调整）；青色多边形为<strong>检测区域 ROI</strong>
      （只统计区域内目标，区域外忽略）。坐标 0~1 对应画面左上→右下。
    </p>

    <!-- 拖拽画布 -->
    <div class="are-stage">
      <svg
        ref="svgRef"
        class="are-svg"
        :viewBox="`0 0 ${W} ${H}`"
        preserveAspectRatio="xMidYMid meet"
        @pointermove="onDragMove"
        @pointerup="endDrag"
        @pointercancel="endDrag"
        @pointerleave="endDrag"
      >
        <defs>
          <pattern id="areGrid" width="50" height="50" patternUnits="userSpaceOnUse">
            <path d="M 50 0 L 0 0 0 50" fill="none" stroke="rgba(120,180,210,.14)" stroke-width="1" />
          </pattern>
        </defs>
        <rect x="0" y="0" :width="W" :height="H" fill="#0a1622" />
        <image v-if="bgUrl" :href="bgUrl" x="0" y="0" :width="W" :height="H" preserveAspectRatio="xMidYMid slice" opacity="0.85" />
        <rect x="0" y="0" :width="W" :height="H" fill="url(#areGrid)" />

        <!-- ROI 区域 -->
        <polygon v-if="roi.length >= 3" :points="roiPointsAttr" class="are-roi-fill" />
        <polyline
          v-if="roi.length >= 2"
          :points="roiPointsAttr + (roi.length >= 3 ? ' ' + ((roi[0].x*W).toFixed(1)+','+(roi[0].y*H).toFixed(1)) : '')"
          class="are-roi-line"
        />
        <template v-for="(p, i) in roi" :key="'roi' + i">
          <circle :cx="p.x * W" :cy="p.y * H" r="44" class="are-hit"
            @pointerdown="startDrag('roi', i, $event)" />
          <circle :cx="p.x * W" :cy="p.y * H" r="11"
            :class="['are-pt', 'are-roi-pt', { on: selected?.kind==='roi' && selected?.idx===i }]" />
          <text :x="p.x * W" :y="p.y * H - 16" class="are-pt-label">{{ i + 1 }}</text>
        </template>

        <!-- 计数线 -->
        <line :x1="lineAx" :y1="lineAy" :x2="lineBx" :y2="lineBy" class="are-count-line" />
        <circle :cx="lineAx" :cy="lineAy" r="44" class="are-hit" @pointerdown="startDrag('la', 0, $event)" />
        <circle :cx="lineBx" :cy="lineBy" r="44" class="are-hit" @pointerdown="startDrag('lb', 0, $event)" />
        <circle :cx="lineAx" :cy="lineAy" r="11" :class="['are-pt','are-line-pt',{on:selected?.kind==='la'}]" />
        <circle :cx="lineBx" :cy="lineBy" r="11" :class="['are-pt','are-line-pt',{on:selected?.kind==='lb'}]" />
        <text :x="lineAx" :y="lineAy - 16" class="are-pt-label are-line-label">A</text>
        <text :x="lineBx" :y="lineBy - 16" class="are-pt-label are-line-label">B</text>
      </svg>
    </div>

    <!-- 数值兜底 -->
    <div class="are-numeric">
      <div class="are-block">
        <div class="are-block-h">
          <Crosshair :size="14" /> 计数线（0~1）
          <button class="are-mini" type="button" @click="resetLine"><RotateCcw :size="13" /> 默认中线</button>
        </div>
        <div class="are-row">
          <span class="tag">A</span>
          <label>X<input type="number" min="0" max="1" step="0.01" :value="line[0].x.toFixed(2)"
            @input="setNum('la',0,'x',($event.target as HTMLInputElement).value)" /></label>
          <label>Y<input type="number" min="0" max="1" step="0.01" :value="line[0].y.toFixed(2)"
            @input="setNum('la',0,'y',($event.target as HTMLInputElement).value)" /></label>
        </div>
        <div class="are-row">
          <span class="tag">B</span>
          <label>X<input type="number" min="0" max="1" step="0.01" :value="line[1].x.toFixed(2)"
            @input="setNum('lb',0,'x',($event.target as HTMLInputElement).value)" /></label>
          <label>Y<input type="number" min="0" max="1" step="0.01" :value="line[1].y.toFixed(2)"
            @input="setNum('lb',0,'y',($event.target as HTMLInputElement).value)" /></label>
        </div>
      </div>

      <div class="are-block">
        <div class="are-block-h">
          <Hand :size="14" /> 检测区域 ROI（{{ roi.length }} 点，≥3 生效）
          <span class="are-spacer" />
          <button class="are-mini" type="button" @click="addRoiPoint"><Plus :size="13" /> 加顶点</button>
          <button class="are-mini danger" type="button" @click="clearRoi"><Trash2 :size="13" /> 清空=全画面</button>
        </div>
        <div class="are-verts">
          <div v-for="(p, i) in roi" :key="'nv' + i" class="are-row">
            <span class="tag roi">{{ i + 1 }}</span>
            <label>X<input type="number" min="0" max="1" step="0.01" :value="p.x.toFixed(2)"
              @input="setNum('roi',i,'x',($event.target as HTMLInputElement).value)" /></label>
            <label>Y<input type="number" min="0" max="1" step="0.01" :value="p.y.toFixed(2)"
              @input="setNum('roi',i,'y',($event.target as HTMLInputElement).value)" /></label>
            <button class="are-del" type="button" @click="removeRoiPoint(i)"><Trash2 :size="12" /></button>
          </div>
          <div v-if="roi.length === 0" class="are-empty">未圈定区域 = 全画面检测；点「加顶点」开始圈定</div>
        </div>
      </div>
    </div>

    <template #footer>
      <el-button @click="close">取消</el-button>
      <el-button type="primary" @click="save">保存并下发 AI</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.are-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.are-enable { display: inline-flex; align-items: center; gap: 8px; font-size: 14px; cursor: pointer; }
.are-enable input { width: 16px; height: 16px; }
.are-tip { font-size: 12.5px; color: var(--v2-text-3, #9fb4c4); margin: 10px 0; line-height: 1.6; }
.are-tip strong { color: var(--v2-text-1, #e6f2fb); }

.are-stage { width: 100%; border: 1px solid var(--v2-border-soft, rgba(120,170,200,.25)); border-radius: 10px; overflow: hidden; background: #0a1622; }
.are-svg { display: block; width: 100%; height: auto; aspect-ratio: 16 / 9; touch-action: none; user-select: none; -webkit-user-select: none; }

.are-count-line { stroke: #ffd24a; stroke-width: 3; stroke-dasharray: 10 7; filter: drop-shadow(0 0 4px rgba(255,210,74,.5)); }
.are-roi-fill { fill: rgba(74, 222, 210, .12); stroke: none; }
.are-roi-line { fill: none; stroke: #4aded2; stroke-width: 2.5; stroke-dasharray: 8 5; }
.are-hit { fill: transparent; cursor: grab; touch-action: none; }
.are-hit:active { cursor: grabbing; }
.are-pt { stroke-width: 2.5; cursor: grab; }
.are-line-pt { fill: #ffd24a; stroke: #5a4300; }
.are-roi-pt { fill: #4aded2; stroke: #043833; }
.are-pt.on { stroke-width: 4; stroke: #fff; }
.are-pt-label { fill: #d8ecfb; font-size: 20px; font-weight: 700; text-anchor: middle; paint-order: stroke; stroke: rgba(0,0,0,.55); stroke-width: 3px; }
.are-line-label { fill: #ffe9a6; }

.are-numeric { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 14px; }
.are-block { border: 1px solid var(--v2-border-soft, rgba(120,170,200,.2)); border-radius: 8px; padding: 10px 12px; min-width: 0; }
.are-block-h { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; margin-bottom: 8px; }
.are-spacer { flex: 1; }
.are-mini { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; padding: 3px 8px; border-radius: 6px;
  border: 1px solid var(--v2-border-soft, rgba(120,170,200,.3)); background: transparent; color: var(--v2-text-2, #c6dbea); cursor: pointer; }
.are-mini.danger { color: #ff9a9a; border-color: rgba(255,140,140,.35); }
.are-row { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; }
.are-row label { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; color: var(--v2-text-3, #9fb4c4); }
.are-row input[type=number] { width: 74px; padding: 4px 6px; font-size: 13px; border-radius: 6px;
  border: 1px solid var(--v2-border-soft, rgba(120,170,200,.3)); background: var(--v2-inset-bg, rgba(0,0,0,.2)); color: var(--v2-text-1, #e6f2fb); }
.are-row .tag { width: 20px; height: 20px; flex-shrink: 0; border-radius: 50%; display: grid; place-items: center; font-size: 11px; font-weight: 700; background: #5a4300; color: #ffd24a; }
.are-row .tag.roi { background: #043833; color: #4aded2; }
.are-del { width: 24px; height: 24px; border-radius: 6px; border: 1px solid rgba(255,140,140,.3); background: transparent; color: #ff9a9a; cursor: pointer; display: grid; place-items: center; }
.are-verts { max-height: 168px; overflow-y: auto; }
.are-empty { font-size: 12px; color: var(--v2-text-3, #9fb4c4); padding: 6px 2px; }

@media (max-width: 640px) {
  .are-numeric { grid-template-columns: 1fr; gap: 10px; }
  .are-row input[type=number] { width: 64px; }
}
</style>

<style>
.ai-region-dialog { width: 94vw !important; max-width: 860px; }
@media (max-width: 640px) {
  .ai-region-dialog { width: 96vw !important; margin: 2vh auto !important; }
  .ai-region-dialog .el-dialog__body { padding: 12px; max-height: 78vh; overflow-y: auto; }
}
</style>
