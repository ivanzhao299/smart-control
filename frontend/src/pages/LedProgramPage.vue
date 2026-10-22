<script setup lang="ts">
/**
 * LED 节目制作页（勇电 290×30 灯珠屏）
 *
 * 真实物理规格（逆向结论）：
 *   - 290 列 × 30 行物理点阵，5 段组拼
 *   - 黑缝列（1 基）62-69 / 221-228（289 右缘缝近乎不可见不渲染）
 *   - 25 fps，帧格式 0x5001，推流 224.1.1.1:65535（PVE vmbr1）
 *
 * 本页 = v25 生成器移植进 SmartCtrl 真实前端，遵循 Design System（--v2-* tokens）。
 * 编排逻辑：多行文字 → 节目编排（文字段+视频段）→ 生成 bin → 推流播出。
 */
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { generateYongdianBin, downloadBin, decodeVideoFrames } from '@/lib/led-bin-builder';
import { ledProgramService } from '@/services/led-program.service';
import type { Ref } from 'vue';

const router = useRouter();

// 视频文件选择器（隐藏 input）
const videoInputRef: Ref<HTMLInputElement | null> = ref(null);

type TplKey = 'static' | 'scrollL' | 'scrollR' | 'blink' | 'gradient' | 'typing' | 'bounce' | 'wave' | 'glitch' | 'neon' | 'pulse' | 'zoomIn' | 'slideUp' | 'flash' | 'flip';
const TPL_OPTIONS: { value: TplKey; label: string }[] = [
  { value: 'static', label: '静态' },
  { value: 'scrollL', label: '左滚动' },
  { value: 'scrollR', label: '右滚动' },
  { value: 'blink', label: '闪烁' },
  { value: 'gradient', label: '彩虹渐变' },
  { value: 'typing', label: '打字机' },
  { value: 'bounce', label: '上下弹跳' },
  { value: 'wave', label: '波浪起伏' },
  { value: 'glitch', label: '故障错位' },
  { value: 'neon', label: '霓虹闪烁' },
  { value: 'pulse', label: '呼吸脉冲' },
  { value: 'zoomIn', label: '缩放入场' },
  { value: 'slideUp', label: '上滑入场' },
  { value: 'flash', label: '快闪强光' },
  { value: 'flip', label: '3D翻转' },
];
interface Line {
  id: number;
  text: string;
  size: number;   // 灯珠行高 3-30
  tpl: TplKey;
  color: string;
  bold?: boolean;
  italic?: boolean;
  stroke?: boolean;
}

// v25 预置 14 色
const COLOR_PRESETS = [
  '#4C9AFF', '#34D399', '#FBBF24', '#F87171',
  '#A78BFA', '#F472B6', '#22D3EE', '#FB923C',
  '#FFFFFF', '#FDE047', '#E879F9', '#5EEAD4',
  '#94A3B8', '#FF6B6B',
];

let lineSeq = 2;
const lines = ref<Line[]>([
  { id: 0, text: '金湖科创产业园', size: 6, tpl: 'static', color: '#4C9AFF', bold: true },
  { id: 1, text: '智慧园区 · 诚邀入驻', size: 4, tpl: 'scrollL', color: '#34D399' },
]);

// 颜色弹框状态：当前正在选色的行 id（null = 弹框关闭）
const colorPickerFor = ref<number | null>(null);
function openColorPicker(lineId: number) {
  colorPickerFor.value = lineId;
}
function closeColorPicker() {
  colorPickerFor.value = null;
}
function pickColor(c: string) {
  const ln = lines.value.find((l) => l.id === colorPickerFor.value);
  if (ln) ln.color = c;
}
function onNativeColor(e: Event) {
  const v = (e.target as HTMLInputElement).value;
  pickColor(v);
}

const BKG_LIST = [
  { key: 'none', name: '纯色' },
  { key: 'flow', name: '流光溢彩' },
  { key: 'breathe', name: '光晕呼吸' },
  { key: 'stars', name: '星光闪烁' },
  { key: 'rainbow', name: '彩虹流动' },
  { key: 'scan', name: '霓虹流光' },
  { key: 'tech', name: '科技光斑' },
  { key: 'matrix', name: '矩阵雨' },
  { key: 'grid', name: '网格扫描' },
  { key: 'aurora', name: '极光渐变' },
  { key: 'particles', name: '粒子飘雪' },
  { key: 'fireworks', name: '烟花绽放' },
] as const;
type BkgKey = typeof BKG_LIST[number]['key'];
const curBkg = ref<BkgKey>('flow');

const speed = ref(5); // 1-10 档，档×6 灯珠/秒
const speedNote = computed(() => `≈${speed.value * 6} 灯珠/秒`);

// 安全区提示：Σ行高+(n-1)行距 vs 30 行（防御空数组出现负值）
const usedRows = computed(() => {
  const gap = 1; // 行距 1 灯珠
  const sum = lines.value.reduce((s, l) => s + l.size, 0) + Math.max(0, lines.value.length - 1) * gap;
  return Math.max(0, sum);
});
const safeHint = computed(() =>
  usedRows.value <= 30
    ? `内容高 ${usedRows.value}/30 行 · 安全`
    : `超出安全区 ${usedRows.value - 30} 行`
);

function addLine() {
  lines.value.push({ id: lineSeq++, text: '新行文字', size: 4, tpl: 'static', color: '#4C9AFF', bold: false, italic: false, stroke: false });
}
function delLine(id: number) {
  if (lines.value.length <= 1) return;
  lines.value = lines.value.filter((l) => l.id !== id);
}

// 每行渲染字号（px）：屏高按 74px 设计基准，灯珠行 = 74/30
const ROW_PX = 74 / 30;
function lineSizePx(size: number) {
  return Math.max(1, Math.round(size * ROW_PX));
}

// 滚动行动画时长：屏宽(px) / (速率 × pxPerLed) ≈ 290/(档×6) 秒
const scrollDur = computed(() => (290 / (speed.value * 6)).toFixed(2) + 's');

// 节目编排段
interface Seg {
  id: number;
  kind: 'text' | 'video';
  name: string;
  rep: number;
  videoName?: string;
  videoFile?: File;
}
let segSeq = 0;
const segs = ref<Seg[]>([]);
const activeSegId = ref<number | null>(null); // 点段抽到预览区
function addTextSeg() {
  // 防御：空文本/超长输入截断，避免段名尾空格或撑爆 DOM
  const raw = (lines.value[0]?.text || '').trim();
  const first = raw ? (raw.length > 12 ? raw.slice(0, 12) + '…' : raw) : '文字段';
  const s: Seg = { id: segSeq++, kind: 'text', name: `文字段 · ${first}`, rep: 1 };
  segs.value.push(s);
  activeSegId.value = s.id;
}
function addVideoSeg() {
  // 触发文件选择
  videoInputRef.value?.click();
}
function onVideoPicked(e: Event) {
  const f = (e.target as HTMLInputElement).files?.[0];
  if (!f) return;
  // 视频上传大小限制：50MB（浏览器端解码大文件会卡顿/崩溃）
  const MAX_VIDEO = 50 * 1024 * 1024;
  if (f.size > MAX_VIDEO) {
    toast(`视频过大：${(f.size / 1024 / 1024).toFixed(1)}MB，上限 50MB，请先用 ffmpeg 压缩`);
    (e.target as HTMLInputElement).value = '';
    return;
  }
  const s: Seg = { id: segSeq++, kind: 'video', name: `视频段 · ${f.name}`, rep: 1, videoName: f.name, videoFile: f };
  segs.value.push(s);
  activeSegId.value = s.id;
  toast(`已选视频：${f.name}（${(f.size / 1024 / 1024).toFixed(1)}MB）`);
  // 清空 input value 允许重复选同一文件
  (e.target as HTMLInputElement).value = '';
}
function delSeg(id: number) {
  segs.value = segs.value.filter((s) => s.id !== id);
  if (activeSegId.value === id) activeSegId.value = null;
}
function bumpRep(id: number, delta: number) {
  const s = segs.value.find((x) => x.id === id);
  if (s) s.rep = Math.max(1, Math.min(99, s.rep + delta));
}
function previewSeg(id: number) {
  activeSegId.value = id;
}

// 灯珠底色（原 290 列 cell 已合并为单 div，避免冗余 DOM）

// PVE 探活（真实后端 /led-program/status）
const pveOnline = ref(false);
const pveBase = ref('');
const pveDotCls = computed(() => (pveOnline.value ? 'dot-on' : 'dot-off'));

// 历史记录（后端 /led-program/history）
interface HistItem { name: string; sub: string; state: 'ok' | 'wait'; stateText: string; }
const histList = ref<HistItem[]>([]);

// 最近一次入库的节目 id（用于"推流播出"）
const lastProgramId = ref<number | null>(null);
const busyGen = ref(false);
const busyPush = ref(false);

const toastMsg = ref('');
let toastTimer: number | undefined;
function toast(t: string) {
  toastMsg.value = t;
  // 连续调用时清掉上一个 timer，避免后出的 toast 被前一个 timer 提前清掉
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastMsg.value = '';
    toastTimer = undefined;
  }, 2200);
}

// ===== bin 文件生成（真生成器：块模板完整复制 + 动态帧数）=====
const genStamp = ref('未生成');

async function genBin() {
  if (busyGen.value) return;
  try {
    busyGen.value = true;
    toast('正在解码节目段…');

    // 按 segs 编排顺序构建段序列；空 segs 时默认一段文字
    const segList = segs.value.length > 0 ? segs.value : [{ kind: 'text' as const, rep: 1 }];
    const segments = [];
    for (const s of segList) {
      if (s.kind === 'video' && s.videoFile) {
        toast(`正在解码视频：${s.videoName}…`);
        const vf = await decodeVideoFrames(s.videoFile);
        segments.push({ type: 'video' as const, videoFrames: vf, rep: s.rep });
      } else {
        segments.push({
          type: 'text' as const,
          lines: lines.value.map((l) => ({ text: l.text, size: l.size, tpl: l.tpl, color: l.color, bold: l.bold })),
          scrollSpeed: speed.value * 6,
          rep: s.rep,
        });
      }
    }

    const bin = generateYongdianBin({ segments });

    // 1) 浏览器端下载一份（保留原行为，便于插 SD 卡测试）
    downloadBin(bin);

    // 2) 同时上传后端入库，拿到 program id（不自动推流）
    const segmentsPayload = segs.value.map((s) => ({
      type: s.kind === 'video' ? ('video' as const) : ('text' as const),
      text: s.kind === 'video' ? undefined : lines.value.map((l) => l.text).join(' / '),
      template: s.kind === 'video' ? s.videoName : lines.value[0]?.tpl,
      color: lines.value[0]?.color,
      durationMs: s.rep * 4000,
    }));
    const ingested = await ledProgramService.ingest(bin.bytes, bin.fileName, segmentsPayload);
    lastProgramId.value = ingested.program.id;

    const mb = (bin.sizeBytes / 1024 / 1024).toFixed(1);
    genStamp.value = `${bin.totalFrames} 帧 · ${mb} MB · 已入库 #${ingested.program.id}`;
    toast(`已生成 bin：${bin.fileName}（${bin.totalFrames} 帧，${mb} MB），已入库 #${ingested.program.id}，可点"推流播出"`);
    await refreshHistory();
  } catch (e: any) {
    const msg = e?.message || String(e);
    console.error('[genBin] 失败', e);
    genStamp.value = '失败';
    toast(`生成/入库失败：${msg}`);
  } finally {
    busyGen.value = false;
  }
}

async function pushStream() {
  if (busyPush.value) return;
  if (!lastProgramId.value) {
    toast('请先生成 bin 并入库');
    return;
  }
  try {
    busyPush.value = true;
    toast('正在推流到 PVE…');
    const r = await ledProgramService.push(lastProgramId.value);
    if (r.ok) {
      toast(`推流成功：${r.msg || 'PVE 已接收'}`);
    } else {
      toast(`推流失败：${r.msg || 'PVE 无响应'}`);
    }
  } catch (e: any) {
    toast(`推流异常：${e?.message || e}`);
  } finally {
    busyPush.value = false;
  }
}

async function refreshPveStatus() {
  try {
    const s = await ledProgramService.status();
    pveOnline.value = s.reachable;
    pveBase.value = s.base || '';
    toast(s.reachable ? `PVE 在线（${s.base || ''}）` : `PVE 离线：${s.error || '无响应'}`);
  } catch (e: any) {
    pveOnline.value = false;
    toast(`PVE 状态查询失败：${e?.message || e}`);
  }
}

async function refreshHistory() {
  try {
    const list = await ledProgramService.history();
    histList.value = list.slice(0, 8).map((p) => ({
      name: p.name,
      sub: `${(p.fileSize / 1024 / 1024).toFixed(1)} MB · ${p.createdBy}`,
      state: 'ok' as const,
      stateText: new Date(p.createdAt).toLocaleString('zh-CN', { hour12: false }),
    }));
  } catch (e) {
    // 静默：历史加载失败不打扰用户
  }
}

function clearSegs() {
  if (segs.value.length && !window.confirm('确定清空所有节目段？此操作不可撤销。')) return;
  segs.value = [];
  toast('已清空节目编排');
}

onMounted(() => {
  refreshHistory();
  refreshPveStatus();
});
onUnmounted(() => {
  // 卸载时清掉未触发的 toast timer，避免操作已卸载组件的 ref
  if (toastTimer !== undefined) {
    window.clearTimeout(toastTimer);
    toastTimer = undefined;
  }
});
</script>

<template>
  <div class="led-page">
    <!-- 页头 -->
    <div class="page-head">
      <div>
        <div class="page-title">
          楼顶广告屏
          <span class="pve-dot" :class="pveDotCls" :title="pveOnline ? 'PVE 在线' : 'PVE 离线'"></span>
        </div>
        <div class="page-sub">勇电灯珠屏 · 290×30 真实点阵 · 编排 → 生成 bin → PVE 直推接收卡（224.1.1.1:65535）</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" @click="refreshPveStatus">PVE 状态</button>
        <button class="btn btn-ghost" @click="router.push({ name: 'power-timing' })">定时开关</button>
      </div>
    </div>

    <div class="layout">
      <!-- 左：实时预览（sticky） -->
      <section class="card sticky-preview">
        <div class="card-head">
          <div class="card-title">实时预览</div>
          <span class="card-hint">所见即所得 · 290×30 真实比例 · 黑缝分隔还原</span>
        </div>
        <div class="preview-meta">
          <span class="meta-chip">屏体 <b>290×30 · 5 段</b></span>
          <span class="meta-chip">播放 <b>25 fps</b></span>
          <span class="meta-chip">目标 <b>224.1.1.1:65535</b></span>
          <span class="meta-chip">通道 <b>vmbr1</b></span>
        </div>
        <div class="screen-stage">
          <div class="screen-frame">
            <!-- 灯珠底网格（纯色底，原 290 个同色 cell 冗余 DOM 已合并为单 div） -->
            <div class="led-grid"></div>
            <!-- 黑缝层（盖文字/背景） -->
            <div class="led-gaps">
              <div class="led-gap-bar" style="left:21.0345%;width:2.75862%"></div>
              <div class="led-gap-bar" style="left:75.8621%;width:2.75862%"></div>
            </div>
            <!-- 背景动画层 -->
            <div class="bg-anim" :class="`bg-${curBkg}`">
              <template v-if="curBkg === 'stars'">
                <span class="star" style="top:30%;left:25%"></span>
                <span class="star" style="top:60%;left:60%;animation-delay:.6s"></span>
                <span class="star" style="top:40%;left:82%;animation-delay:1.1s"></span>
              </template>
            </div>
            <!-- 文字层 -->
            <div class="screen-text">
              <div
                v-for="l in lines"
                :key="l.id"
                class="text-line"
                :class="`ta-${l.tpl}`"
                :style="{
                  color: l.color,
                  fontSize: lineSizePx(l.size) + 'px',
                  lineHeight: '1.15',
                  fontWeight: l.bold ? 800 : 500,
                  fontStyle: l.italic ? 'italic' : 'normal',
                  WebkitTextStroke: l.stroke ? `1px #fff` : undefined,
                  textShadow: l.stroke ? `0 0 6px ${l.color}` : undefined,
                  animationDuration: l.tpl === 'scrollL' || l.tpl === 'scrollR' ? scrollDur : undefined,
                }"
              >{{ l.text }}</div>
            </div>
          </div>
          <!-- 屏底状态条 -->
          <div class="screen-bar">
            <span class="l">
              <span class="live-flag">PVE 在线</span>
              <span>{{ usedRows }}/30 行</span>
              <span>速度 {{ speedNote }}</span>
            </span>
            <span class="gen-stamp">{{ genStamp }}</span>
          </div>
        </div>
      </section>

      <!-- 右：节目编辑 -->
      <section class="card">
        <div class="card-head">
          <div class="card-title">节目编辑</div>
        </div>
        <div class="card-body">
          <!-- 多行文字 -->
          <div class="field">
            <div class="field-label">
              <b>多行文字</b>
              <span class="safe-hint" :class="{ over: usedRows > 30 }">{{ safeHint }}</span>
              <button class="btn-mini" @click="addLine">+ 添加行</button>
            </div>
            <div class="line-item" v-for="l in lines" :key="l.id">
              <div class="line-head">
                <span class="line-no">L{{ l.id + 1 }}</span>
                <input class="line-input" v-model="l.text" />
                <button class="line-del" @click="delLine(l.id)">×</button>
              </div>
              <div class="line-body">
                <span class="ll">字号 {{ l.size }}</span>
                <input type="range" min="3" max="30" v-model.number="l.size" />
                <span class="line-size-val">{{ l.size }}</span>
                <select v-model="l.tpl" class="line-tpl">
                  <option v-for="o in TPL_OPTIONS" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
                <!-- 文字样式切换：加粗 B / 斜体 I / 描边 S -->
                <button
                  class="style-toggle"
                  :class="{ on: l.bold }"
                  title="加粗"
                  @click="l.bold = !l.bold"
                ><b>B</b></button>
                <button
                  class="style-toggle"
                  :class="{ on: l.italic }"
                  title="倾斜"
                  @click="l.italic = !l.italic"
                ><i>I</i></button>
                <button
                  class="style-toggle"
                  :class="{ on: l.stroke }"
                  title="描边"
                  @click="l.stroke = !l.stroke"
                ><span class="strike-s">S</span></button>
                <!-- 颜色按钮：圆形色点，点击弹 14 色选择器 -->
                <button
                  class="line-color"
                  :style="{ color: l.color }"
                  :title="'文字颜色：' + l.color"
                  @click="openColorPicker(l.id)"
                >
                  <i></i>
                </button>
              </div>
            </div>
          </div>

          <!-- 速度 -->
          <div class="field">
            <div class="field-label"><b>动画速度</b><span class="hint-text">统一调整 · 滚动按真实灯珠速率换算</span></div>
            <div class="slider-row">
              <input type="range" min="1" max="10" v-model.number="speed" />
              <span class="slider-val">{{ speed }}</span>
              <span class="speed-note">{{ speedNote }}</span>
            </div>
          </div>

          <!-- 背景动画 -->
          <div class="field">
            <div class="field-label"><b>背景动画</b><span class="hint-text">叠加在文字下层</span></div>
            <div class="tpl-grid-pick">
              <div
                v-for="b in BKG_LIST"
                :key="b.key"
                class="tpl-item"
                :class="{ sel: curBkg === b.key }"
                @click="curBkg = b.key"
              >
                <div class="thumb" :class="`bg-${b.key}`"></div>
                <div class="tname">{{ b.name }}</div>
              </div>
            </div>
          </div>

          <!-- 节目编排 -->
          <div class="field">
            <div class="field-label"><b>节目编排</b><span class="hint-text">文字 + 视频分段合成单 bin</span></div>
            <div class="seg-add">
              <button class="btn btn-ghost" @click="addTextSeg">添加文字段</button>
              <button class="btn btn-ghost" @click="addVideoSeg">添加视频段</button>
            </div>
            <div class="seg-list" v-if="segs.length">
              <div
                class="seg-item"
                :class="{ cur: activeSegId === s.id }"
                v-for="s in segs"
                :key="s.id"
                @click="previewSeg(s.id)"
              >
                <span class="seg-ic" :class="s.kind === 'text' ? 't' : 'v'">{{ s.kind === 'text' ? '文' : '视' }}</span>
                <span class="seg-name">{{ s.name }}</span>
                <span class="seg-rep">
                  <button @click.stop="bumpRep(s.id, -1)" title="减少重复">−</button>
                  ×{{ s.rep }}
                  <button @click.stop="bumpRep(s.id, 1)" title="增加重复">+</button>
                </span>
                <button class="seg-op-btn del" @click.stop="delSeg(s.id)">删</button>
              </div>
            </div>
            <div class="seg-empty" v-else>尚未添加任何段 — 点上方按钮把当前设计封装为段</div>
            <div class="seg-actions">
              <button class="btn btn-primary" @click="genBin">生成节目 bin</button>
              <button class="btn btn-ghost" @click="clearSegs">清空节目</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 底部操作条 -->
    <div class="action-bar">
      <div class="action-btns">
        <button class="btn btn-primary" :disabled="busyGen" @click="genBin">
          {{ busyGen ? '生成中…' : '生成 bin 文件' }}
        </button>
        <button class="btn btn-danger" :disabled="busyPush || !lastProgramId" @click="pushStream">
          {{ busyPush ? '推流中…' : '推流播出' }}
        </button>
      </div>
      <div class="action-note">编排确认无误后生成 bin（自动入库），再推流到 PVE → 接收卡（224.1.1.1:65535）</div>
    </div>

    <!-- 历史记录 -->
    <section class="card hist-card">
      <div class="card-head">
        <div class="card-title">最近播出记录</div>
        <span class="card-hint">仅管理员可见全部，操作员可见本人</span>
      </div>
      <div class="card-body hist-list">
        <div class="hist-item" v-for="(h, i) in histList" :key="i">
          <div class="h-l">
            <span class="h-name">{{ h.name }}</span>
            <span class="h-sub">{{ h.sub }}</span>
          </div>
          <span class="h-state" :class="h.state">{{ h.stateText }}</span>
        </div>
      </div>
    </section>

    <!-- 隐藏的视频文件选择器 -->
    <input ref="videoInputRef" type="file" accept="video/*" hidden @change="onVideoPicked" />

    <!-- 颜色选择弹框（14 色预置 + 原生调色盘） -->
    <div v-if="colorPickerFor !== null" class="cp-mask" @click.self="closeColorPicker">
      <div class="cp-pop">
        <div class="cp-head">选择文字颜色</div>
        <div class="cp-grid">
          <div
            v-for="c in COLOR_PRESETS"
            :key="c"
            class="cp-cell"
            :class="{ sel: lines.find(l => l.id === colorPickerFor)?.color?.toLowerCase() === c.toLowerCase() }"
            :style="{ background: c }"
            @click="pickColor(c)"
          ></div>
        </div>
        <div class="cp-row">
          <input type="color" :value="lines.find(l => l.id === colorPickerFor)?.color || '#4C9AFF'" @input="onNativeColor" />
          <span class="cp-tip">自定义颜色</span>
        </div>
        <div class="cp-foot">
          <button class="btn btn-primary" @click="closeColorPicker">完成</button>
        </div>
      </div>
    </div>

    <!-- toast -->
    <transition name="toast-fade">
      <div v-if="toastMsg" class="toast-item">{{ toastMsg }}</div>
    </transition>
  </div>
</template>

<style scoped>
.led-page {
  padding: 16px 18px 28px;
  max-width: 1280px;
  margin: 0 auto;
}

/* ===== 页头 ===== */
.page-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 14px;
}
.page-title {
  font-size: 20px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--v2-text-1, #E6EDF6);
}
.pve-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
}
.pve-dot.dot-on { background: #3FBF87; box-shadow: 0 0 8px #3FBF87; }
.pve-dot.dot-off { background: #E5645D; box-shadow: 0 0 8px #E5645D; }
.page-sub {
  font-size: 12px;
  color: var(--v2-text-2, #8CA0B8);
  margin-top: 4px;
}
.page-actions { display: flex; gap: 8px; }

/* ===== 布局 ===== */
.layout {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(300px, 1fr);
  gap: 14px;
  align-items: start;
}

/* ===== 卡片（对齐 MainLayout v2 卡片语言） ===== */
.card {
  position: relative;
  background: var(--v2-surf-1, #242F44);
  border-radius: 12px;
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.08));
  box-shadow: var(--v2-elev-1, 0 1px 2px rgba(0,0,0,0.4));
  overflow: hidden;
}
.card.sticky-preview { position: sticky; top: 12px; z-index: 5; }
.card-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--v2-border-soft, rgba(255,255,255,0.06));
}
.card-title {
  font-size: 13px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--v2-text-1, #E6EDF6);
}
.card-hint { font-size: 11px; color: var(--v2-text-3, #5B6B82); }
.card-body { padding: 14px; }

/* ===== 预览屏 ===== */
.preview-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--v2-border-soft, rgba(255,255,255,0.06));
}
.meta-chip {
  font-size: 11px;
  color: var(--v2-text-2, #8CA0B8);
  background: var(--v2-surf-2, rgba(255,255,255,0.05));
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.06));
  padding: 3px 9px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  gap: 5px;
}
.meta-chip b { color: var(--v2-text-1, #E6EDF6); font-weight: 600; }

.screen-stage {
  margin: 20px 14px 14px;
  position: relative;
  overflow: hidden;
  background: #04060A;
}
.screen-frame {
  position: relative;
  aspect-ratio: 290 / 30;
  display: flex;
  align-items: center;
  justify-content: center;
  /* 屏体滚出视口时跳过渲染，降低后台动画合成开销 */
  content-visibility: auto;
  contain-intrinsic-size: auto 74px;
}
.led-grid {
  position: absolute;
  inset: 0;
  z-index: 1;
  background: #0C1B31;
}
.led-gaps {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
}
.led-gap-bar {
  position: absolute;
  top: 0;
  bottom: 0;
  background: #000;
  border-left: 1px solid rgba(255,255,255,0.06);
}

/* 背景动画层（屏相对尺寸，overflow 硬裁） */
.bg-anim {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  overflow: hidden;
}
.bg-none { background: transparent; }
.bg-flow { background: linear-gradient(180deg, #0B1B30, #0E2740); }
.bg-flow::before, .bg-flow::after {
  content: "";
  position: absolute;
  top: 0; bottom: 0;
  width: 5%;
  filter: blur(6px);
  border-radius: 999px;
}
.bg-flow::before {
  left: -14%;
  background: linear-gradient(180deg, transparent, rgba(76,154,255,.78), transparent);
  animation: flowX 5s linear infinite;
}
.bg-flow::after {
  left: 36%;
  background: linear-gradient(180deg, transparent, rgba(52,211,153,.6), transparent);
  animation: flowX 7s linear infinite;
}
.bg-breathe {
  background: radial-gradient(ellipse at 50% 50%, #1B446E 0%, #0A1526 70%);
  animation: breathe 3.4s ease-in-out infinite;
}
.bg-stars { background: radial-gradient(ellipse at 50% 120%, #15304F 0%, #081020 70%); }
.bg-stars .star {
  position: absolute;
  width: 1.5px;
  height: 1.5px;
  border-radius: 50%;
  background: #D6E6FF;
  box-shadow: 0 0 5px rgba(214,230,255,1);
  animation: twinkle 2.2s ease-in-out infinite;
}
.bg-rainbow {
  background: linear-gradient(100deg, rgba(255,80,120,.75), rgba(251,191,36,.75), rgba(52,211,153,.75), rgba(76,154,255,.75), rgba(255,80,120,.75));
  background-size: 200% 100%;
  animation: rainbowBg 7s linear infinite;
}
.bg-rainbow::after {
  content: "";
  position: absolute;
  inset: 0;
  background: repeating-linear-gradient(115deg, rgba(255,255,255,.2) 0 6px, transparent 6px 12px);
  animation: rainbowMove 6s linear infinite;
}
.bg-scan { background: #071019; }
.bg-scan::before, .bg-scan::after {
  content: "";
  position: absolute;
  left: 10%;
  width: 70%;
  height: 2px;
  filter: blur(3px);
}
.bg-scan::before {
  top: 30%;
  background: linear-gradient(90deg, transparent, #4C9AFF, transparent);
  animation: scanX 3.2s linear infinite;
}
.bg-scan::after {
  top: 64%;
  background: linear-gradient(90deg, transparent, #34D399, transparent);
  animation: scanX 4.1s linear infinite;
}
.bg-tech { background: radial-gradient(ellipse at 30% 60%, #0F2A4A 0%, #06090F 75%); }
.bg-tech::before, .bg-tech::after {
  content: "";
  position: absolute;
  border-radius: 50%;
  filter: blur(8px);
}
.bg-tech::before {
  width: 9%; height: 42%;
  top: 26%; left: 14%;
  background: radial-gradient(circle, rgba(52,211,153,.62), transparent 70%);
  animation: techDriftA 4.6s ease-in-out infinite alternate;
}
.bg-tech::after {
  width: 13%; height: 58%;
  top: 18%; left: 58%;
  background: radial-gradient(circle, rgba(76,154,255,.72), transparent 70%);
  animation: techDriftB 5.4s ease-in-out infinite alternate;
}
@keyframes flowX { from { transform: translateX(0); } to { transform: translateX(2480%); } }
@keyframes breathe { 0%,100% { opacity:.55; transform: scale(1); } 50% { opacity:1; transform: scale(1.06); } }
@keyframes twinkle { 0%,100% { opacity:.15; transform: scale(.6); } 50% { opacity:1; transform: scale(1.3); } }
@keyframes rainbowMove { from { transform: translateX(0); } to { transform: translateX(-120%); } }
@keyframes rainbowBg { from { background-position: 0% 0; } to { background-position: 100% 0; } }
@keyframes scanX { from { transform: translateX(0); } to { transform: translateX(260%); } }
@keyframes techDriftA { from { transform: translate(0,0); } to { transform: translate(140%,-18%); } }
@keyframes techDriftB { from { transform: translate(0,0); } to { transform: translate(-70%,22%); } }

/* ===== 新增背景动画（剪映风格） ===== */
/* 矩阵雨：绿色竖条从上往下落 */
.bg-matrix { background: #020A04; overflow: hidden; }
.bg-matrix::before {
  content: "";
  position: absolute; inset: 0;
  background: repeating-linear-gradient(
    180deg,
    transparent 0,
    transparent 12px,
    rgba(52, 211, 153, 0.35) 12px,
    rgba(52, 211, 153, 0.35) 14px
  );
  animation: matrixFall 2.4s linear infinite;
  mask-image: linear-gradient(180deg, transparent, #000 20%, #000 80%, transparent);
  -webkit-mask-image: linear-gradient(180deg, transparent, #000 20%, #000 80%, transparent);
}
@keyframes matrixFall { from { transform: translateY(-30%); } to { transform: translateY(100%); } }

/* 网格扫描：青色网格 + 扫光线 */
.bg-grid { background: #050A14; overflow: hidden; }
.bg-grid::before {
  content: "";
  position: absolute; inset: 0;
  background:
    linear-gradient(rgba(76,154,255,.18) 1px, transparent 1px),
    linear-gradient(90deg, rgba(76,154,255,.18) 1px, transparent 1px);
  background-size: 24px 24px;
}
.bg-grid::after {
  content: "";
  position: absolute; left: 0; right: 0; height: 2px;
  top: 0;
  background: linear-gradient(90deg, transparent, #4C9AFF, transparent);
  filter: blur(1px);
  animation: gridScan 3.5s linear infinite;
}
@keyframes gridScan { from { top: 0; } to { top: 100%; } }

/* 极光渐变：多色斜向流动 */
.bg-aurora {
  background: linear-gradient(120deg, #0B1B30, #1B3A6B, #4C2A6B, #0B1B30);
  background-size: 300% 300%;
  animation: auroraMove 8s ease-in-out infinite;
}
@keyframes auroraMove {
  0%, 100% { background-position: 0% 50%; }
  50% { background-position: 100% 50%; }
}

/* 粒子飘雪：小白点随机飘 */
.bg-particles { background: radial-gradient(ellipse at 50% 0%, #0E1E35 0%, #050A14 80%); overflow: hidden; }
.bg-particles::before, .bg-particles::after {
  content: "";
  position: absolute; inset: -10% 0;
  background-image:
    radial-gradient(2px 2px at 10% 20%, rgba(255,255,255,.9), transparent),
    radial-gradient(1.5px 1.5px at 30% 60%, rgba(255,255,255,.7), transparent),
    radial-gradient(2px 2px at 55% 30%, rgba(255,255,255,.8), transparent),
    radial-gradient(1.5px 1.5px at 75% 70%, rgba(255,255,255,.6), transparent),
    radial-gradient(2px 2px at 90% 40%, rgba(255,255,255,.9), transparent);
  animation: particleDrift 6s linear infinite;
}
.bg-particles::after { animation-duration: 9s; opacity: .6; }
@keyframes particleDrift {
  from { transform: translateY(-10%); }
  to { transform: translateY(110%); }
}

/* 烟花绽放：径向闪光 */
.bg-fireworks { background: #060810; overflow: hidden; }
.bg-fireworks::before, .bg-fireworks::after {
  content: "";
  position: absolute;
  width: 60px; height: 60px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(253,224,71,.9), transparent 60%);
  filter: blur(2px);
  opacity: 0;
  animation: fireworksBoom 3.5s ease-out infinite;
}
.bg-fireworks::before { left: 20%; top: 30%; }
.bg-fireworks::after { right: 20%; bottom: 30%; animation-delay: 1.7s; }
@keyframes fireworksBoom {
  0% { opacity: 0; transform: scale(.2); }
  15% { opacity: 1; transform: scale(1); }
  60% { opacity: .4; transform: scale(2.5); }
  100% { opacity: 0; transform: scale(3); }
}

/* 样式切换按钮（B/I/S） */
.style-toggle {
  width: 26px; height: 26px;
  border-radius: 6px;
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.1));
  background: var(--v2-surf-2, rgba(255,255,255,0.05));
  color: var(--v2-text-2, #8CA0B8);
  cursor: pointer;
  font-size: 12px;
  font-family: inherit;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  padding: 0;
  transition: all .15s;
}
.style-toggle:hover { border-color: var(--v2-primary, #4C9AFF); color: var(--v2-primary, #4C9AFF); }
.style-toggle.on {
  background: var(--v2-primary, #4C9AFF);
  color: #fff;
  border-color: var(--v2-primary, #4C9AFF);
}
.style-toggle .strike-s {
  text-decoration: underline;
  text-decoration-color: currentColor;
  text-underline-offset: 2px;
  font-weight: 700;
}

/* 屏上文字 */
.screen-text {
  position: relative;
  z-index: 3;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}
.text-line {
  font-weight: 800;
  letter-spacing: 0.12em;
  text-align: center;
  white-space: nowrap;
  padding: 0 4%;
  text-shadow: 0 1px 4px rgba(0,0,0,.6), 0 0 8px currentColor;
  flex-shrink: 0;
}
/* 滚动行：起点屏右缘外贴屏（首帧可见），恒速滚至完全出屏左 */
.text-line.ta-scrollL {
  animation: taScrollL linear infinite;
}
.text-line.ta-scrollR {
  animation: taScrollR linear infinite;
}
@keyframes taScrollL {
  from { transform: translateX(60%); }
  to { transform: translateX(-100%); }
}
@keyframes taScrollR {
  from { transform: translateX(-100%); }
  to { transform: translateX(60%); }
}
.text-line.ta-blink { animation: taBlink 1.2s step-end infinite; }
@keyframes taBlink { 0%,55% { opacity: 1; } 56%,100% { opacity: .08; } }
.text-line.ta-gradient {
  background: linear-gradient(90deg, #4C9AFF, #34D399, #FBBF24, #F87171, #4C9AFF);
  background-size: 300% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  animation: taGrad 5s linear infinite;
  text-shadow: none;
}
@keyframes taGrad { from { background-position: 0% 50%; } to { background-position: 300% 50%; } }

/* ===== v25 新增 6 款文字动画 ===== */
.text-line.ta-typing {
  overflow: hidden;
  white-space: nowrap;
  border-right: 2px solid currentColor;
  animation: taTyping 4s steps(24, end) infinite;
}
@keyframes taTyping {
  0% { width: 0; }
  60% { width: 100%; }
  100% { width: 100%; }
}
.text-line.ta-bounce { animation: taBounce 1.6s ease-in-out infinite; }
@keyframes taBounce {
  0%, 100% { transform: translateY(0); }
  30% { transform: translateY(-6px); }
  60% { transform: translateY(0); }
}
.text-line.ta-wave { animation: taWave 2.2s ease-in-out infinite; }
@keyframes taWave {
  0%, 100% { transform: translateY(0) scaleY(1); }
  50% { transform: translateY(-2px) scaleY(1.08); }
}
.text-line.ta-glitch {
  position: relative;
  animation: taGlitch 2s steps(2, end) infinite;
}
@keyframes taGlitch {
  0%, 90%, 100% { transform: translate(0); text-shadow: none; }
  92% { transform: translate(-2px, 1px); text-shadow: 2px 0 #F87171, -2px 0 #22D3EE; }
  96% { transform: translate(2px, -1px); text-shadow: -2px 0 #F87171, 2px 0 #22D3EE; }
}
.text-line.ta-neon {
  animation: taNeon 2.4s ease-in-out infinite;
}
@keyframes taNeon {
  0%, 100% { text-shadow: 0 0 4px currentColor, 0 0 10px currentColor; opacity: 1; }
  50% { text-shadow: 0 0 1px currentColor, 0 0 3px currentColor; opacity: .75; }
}
.text-line.ta-pulse { animation: taPulse 1.8s ease-in-out infinite; }
@keyframes taPulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: .55; transform: scale(.96); }
}

/* 缩放入场：从小放大回稳定 */
.text-line.ta-zoomIn { animation: taZoomIn 2.4s cubic-bezier(.2,.8,.3,1.2) infinite; }
@keyframes taZoomIn {
  0% { transform: scale(.3); opacity: 0; }
  40% { transform: scale(1.05); opacity: 1; }
  60% { transform: scale(1); }
  85%, 100% { transform: scale(1); opacity: 1; }
}

/* 上滑入场：从下方滑入 */
.text-line.ta-slideUp { animation: taSlideUp 2.6s cubic-bezier(.2,.8,.3,1) infinite; }
@keyframes taSlideUp {
  0% { transform: translateY(120%); opacity: 0; }
  35% { transform: translateY(0); opacity: 1; }
  85%, 100% { transform: translateY(0); opacity: 1; }
}

/* 快闪强光：高频明暗交替 */
.text-line.ta-flash { animation: taFlash 0.9s steps(2, end) infinite; }
@keyframes taFlash {
  0%, 49% { opacity: 1; text-shadow: 0 0 8px currentColor, 0 0 20px currentColor; }
  50%, 100% { opacity: .15; text-shadow: none; }
}

/* 3D 翻转：绕 Y 轴 */
.text-line.ta-flip { animation: taFlip 2.8s ease-in-out infinite; transform-style: preserve-3d; }
@keyframes taFlip {
  0%, 15% { transform: rotateY(0deg); }
  50% { transform: rotateY(180deg); }
  85%, 100% { transform: rotateY(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .text-line.ta-typing, .text-line.ta-bounce, .text-line.ta-wave,
  .text-line.ta-glitch, .text-line.ta-neon, .text-line.ta-pulse,
  .text-line.ta-zoomIn, .text-line.ta-slideUp, .text-line.ta-flash, .text-line.ta-flip {
    animation: none !important;
  }
}

/* 屏底状态条 */
.screen-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  border-top: 1px solid var(--v2-border-soft, rgba(255,255,255,0.06));
  font-size: 11px;
  color: var(--v2-text-2, #8CA0B8);
  background: var(--v2-surf-2, rgba(255,255,255,0.03));
}
.screen-bar .l { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
.live-flag {
  color: #3FBF87;
  display: flex;
  align-items: center;
  gap: 5px;
}
.live-flag::before {
  content: "";
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #3FBF87;
  animation: twinkle 1.6s infinite;
}

/* ===== 编辑面板 ===== */
.field { margin-bottom: 16px; }
.field:last-child { margin-bottom: 0; }
.field-label {
  font-size: 12px;
  color: var(--v2-text-2, #8CA0B8);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.field-label b { color: var(--v2-text-1, #E6EDF6); font-weight: 600; }
.hint-text { font-size: 11px; }
.btn-mini {
  background: var(--v2-primary, #4C9AFF);
  color: #fff;
  border: none;
  border-radius: 6px;
  font-size: 11px;
  padding: 4px 10px;
  cursor: pointer;
  font-family: inherit;
  flex-shrink: 0;
}
.btn-mini:hover { filter: brightness(1.1); }
.safe-hint { font-size: 11px; color: #3FBF87; font-weight: 600; }
.safe-hint.over { color: #E5645D; }

.line-item {
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.06));
  border-radius: 8px;
  background: var(--v2-surf-2, rgba(255,255,255,0.03));
  padding: 8px;
  margin-bottom: 8px;
}
.line-item:last-child { margin-bottom: 0; }
.line-head { display: flex; gap: 6px; align-items: center; }
.line-no {
  font-size: 10px;
  color: var(--v2-text-3, #5B6B82);
  font-weight: 700;
  width: 24px;
  flex-shrink: 0;
}
.line-input {
  flex: 1;
  background: var(--v2-surf-1, rgba(0,0,0,0.2));
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.1));
  border-radius: 6px;
  color: var(--v2-text-1, #E6EDF6);
  padding: 7px 10px;
  font-size: 14px;
  outline: none;
  font-family: inherit;
  min-width: 0;
}
.line-input:focus { border-color: var(--v2-primary, #4C9AFF); }
.line-del {
  border: none;
  background: transparent;
  color: var(--v2-text-2, #8CA0B8);
  font-size: 15px;
  cursor: pointer;
  line-height: 1;
  padding: 2px 4px;
  flex-shrink: 0;
}
.line-del:hover { color: #E5645D; }
.line-body { display: flex; align-items: center; gap: 8px; margin-top: 6px; }
.line-body .ll { font-size: 10px; color: var(--v2-text-3, #5B6B82); flex-shrink: 0; }
.line-body input[type=range] { flex: 1; height: 3px; }
.line-size-val {
  font-size: 11px;
  color: var(--v2-primary, #4C9AFF);
  min-width: 16px;
  text-align: center;
  font-weight: 600;
}
select.line-tpl {
  background: var(--v2-surf-1, rgba(0,0,0,0.2));
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.1));
  border-radius: 6px;
  color: var(--v2-text-1, #E6EDF6);
  font-size: 13px;
  padding: 5px 8px;
  font-family: inherit;
  outline: none;
  min-width: 88px;
  flex-shrink: 0;
}

/* 每行颜色按钮（圆形色点） */
.line-color {
  width: 26px; height: 26px;
  border-radius: 50%;
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.2));
  background: var(--v2-surf-2, rgba(255,255,255,0.06));
  flex-shrink: 0;
  cursor: pointer;
  position: relative;
  padding: 0;
}
.line-color i {
  position: absolute;
  inset: 4px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 6px currentColor;
}

/* 颜色选择弹框 */
.cp-mask {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,.55);
  z-index: 95;
  display: flex;
  align-items: center;
  justify-content: center;
}
.cp-pop {
  width: min(320px, 90vw);
  background: var(--v2-surf-1, #242F44);
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.1));
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 20px 50px rgba(0,0,0,.5);
}
.cp-head { font-size: 14px; font-weight: 700; color: var(--v2-text-1, #E6EDF6); margin-bottom: 12px; }
.cp-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.cp-cell {
  aspect-ratio: 1;
  border-radius: 8px;
  cursor: pointer;
  border: 1px solid rgba(255,255,255,.18);
  transition: transform .1s;
}
.cp-cell:hover { transform: scale(1.08); }
.cp-cell.sel {
  box-shadow: 0 0 0 2px var(--v2-surf-1, #242F44), 0 0 0 4px var(--v2-primary, #4C9AFF);
}
.cp-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid var(--v2-border-soft, rgba(255,255,255,0.08));
}
.cp-row input[type=color] {
  width: 46px; height: 34px;
  border: none; border-radius: 8px;
  background: none; padding: 0; cursor: pointer;
}
.cp-tip { font-size: 12px; color: var(--v2-text-2, #8CA0B8); }
.cp-foot { margin-top: 14px; display: flex; justify-content: flex-end; }

/* 滑块 */
.slider-row { display: flex; align-items: center; gap: 12px; }
input[type=range] {
  -webkit-appearance: none;
  appearance: none;
  flex: 1;
  height: 4px;
  border-radius: 999px;
  background: var(--v2-surf-2, rgba(255,255,255,0.08));
  outline: none;
}
input[type=range]::-webkit-slider-thumb {
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--v2-primary, #4C9AFF);
  border: 2px solid var(--v2-surf-1, #242F44);
  cursor: pointer;
}
.slider-val {
  font-size: 12px;
  color: var(--v2-primary, #4C9AFF);
  min-width: 30px;
  text-align: right;
  font-weight: 600;
}
.speed-note {
  font-size: 11px;
  color: var(--v2-primary, #4C9AFF);
  min-width: 70px;
  text-align: right;
  font-weight: 600;
}

/* 背景动画网格 */
.tpl-grid-pick {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}
.tpl-item {
  position: relative;
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.08));
  border-radius: 8px;
  overflow: hidden;
  cursor: pointer;
  aspect-ratio: 16/9;
  background: var(--v2-surf-2, rgba(255,255,255,0.03));
  transition: border-color .15s, box-shadow .15s;
}
.tpl-item:hover { border-color: var(--v2-primary, #4C9AFF); }
.tpl-item.sel {
  border-color: var(--v2-primary, #4C9AFF);
  box-shadow: 0 0 0 2px var(--v2-primary-soft, rgba(76,154,255,0.14));
}
.tpl-item .thumb {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.tpl-item .tname {
  position: absolute;
  left: 0; right: 0; bottom: 0;
  font-size: 10px;
  color: #fff;
  background: linear-gradient(transparent, rgba(0,0,0,.75));
  padding: 8px 6px 4px;
  text-align: center;
  letter-spacing: .05em;
}

/* 节目编排 */
.seg-add { display: flex; gap: 8px; }
.seg-add .btn { flex: 1; }
.seg-list { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.seg-item {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--v2-surf-2, rgba(255,255,255,0.03));
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.06));
  border-radius: 8px;
  padding: 7px 10px;
  font-size: 12px;
  color: var(--v2-text-1, #E6EDF6);
  cursor: pointer;
  transition: border-color .15s, background .15s;
}
.seg-item:hover { border-color: var(--v2-primary, #4C9AFF); }
.seg-item.cur {
  border-color: var(--v2-primary, #4C9AFF);
  background: rgba(76,154,255,.12);
}
.seg-ic {
  width: 22px; height: 22px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
}
.seg-ic.t { background: rgba(76,154,255,.14); color: #4C9AFF; }
.seg-ic.v { background: rgba(224,160,48,.14); color: #E0A030; }
.seg-name { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.seg-rep {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: var(--v2-text-2, #8CA0B8);
  flex-shrink: 0;
}
.seg-rep button {
  width: 18px; height: 18px;
  border-radius: 4px;
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.1));
  background: var(--v2-surf-1, rgba(255,255,255,0.05));
  color: var(--v2-text-1, #E6EDF6);
  cursor: pointer;
  font-size: 12px; line-height: 1;
  font-family: inherit;
  padding: 0;
}
.seg-rep button:hover { border-color: var(--v2-primary, #4C9AFF); color: var(--v2-primary, #4C9AFF); }
.seg-op-btn {
  border: none;
  background: none;
  color: var(--v2-text-3, #5B6B82);
  cursor: pointer;
  font-size: 11px;
  font-family: inherit;
  padding: 2px 6px;
}
.seg-op-btn:hover { color: var(--v2-primary, #4C9AFF); }
.seg-op-btn.del:hover { color: #E5645D; }
.seg-empty {
  font-size: 11px;
  color: var(--v2-text-3, #5B6B82);
  margin-top: 10px;
  padding: 10px;
  text-align: center;
  border: 1px dashed var(--v2-border-soft, rgba(255,255,255,0.1));
  border-radius: 8px;
}
.seg-actions { display: flex; gap: 8px; margin-top: 10px; }
.seg-actions .btn { flex: 1; }

/* 按钮 */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 34px;
  padding: 0 16px;
  border-radius: 8px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
  font-family: inherit;
  white-space: nowrap;
  transition: filter .15s;
}
.btn-primary {
  background: linear-gradient(135deg, #4C9AFF 0%, #3B7FD4 100%);
  color: #fff;
}
.btn-primary:hover { filter: brightness(1.08); }
.btn-ghost {
  background: var(--v2-surf-2, rgba(255,255,255,0.05));
  border-color: var(--v2-border-soft, rgba(255,255,255,0.1));
  color: var(--v2-text-1, #E6EDF6);
}
.btn-ghost:hover {
  border-color: var(--v2-primary, #4C9AFF);
  color: var(--v2-primary, #4C9AFF);
}
.btn-danger {
  background: linear-gradient(135deg, #E5645D 0%, #DC2626 100%);
  color: #fff;
}
.btn-danger:hover { filter: brightness(1.08); }

/* 操作条 */
.action-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  flex-wrap: wrap;
}
.action-btns { display: flex; gap: 8px; }
.action-note { font-size: 11px; color: var(--v2-text-2, #8CA0B8); }

/* 历史记录 */
.hist-card {
  margin-top: 14px;
  /* 首屏不可见，跳过渲染直到滚入视口 */
  content-visibility: auto;
  contain-intrinsic-size: auto 200px;
}
.hist-list { display: flex; flex-direction: column; gap: 6px; }
.hist-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: var(--v2-text-1, #E6EDF6);
  background: var(--v2-surf-2, rgba(255,255,255,0.03));
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.06));
  border-radius: 8px;
  padding: 8px 10px;
}
.hist-item .h-l { display: flex; align-items: center; gap: 8px; min-width: 0; }
.hist-item .h-name { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.hist-item .h-sub { font-size: 11px; color: var(--v2-text-3, #5B6B82); }
.hist-item .h-state { font-size: 11px; display: flex; align-items: center; gap: 5px; }
.hist-item .h-state.ok { color: #3FBF87; }
.hist-item .h-state.wait { color: var(--v2-text-3, #5B6B82); }

/* toast */
.toast-item {
  position: fixed;
  top: 64px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 99;
  background: var(--v2-surf-2, #2C3A55);
  color: var(--v2-text-1, #E6EDF6);
  border: 1px solid var(--v2-border-soft, rgba(255,255,255,0.1));
  border-radius: 8px;
  padding: 10px 18px;
  font-size: 13px;
  box-shadow: 0 12px 28px rgba(0,0,0,0.35);
}
.toast-fade-enter-active, .toast-fade-leave-active { transition: opacity .24s ease, transform .24s ease; }
.toast-fade-enter-from, .toast-fade-leave-to { opacity: 0; transform: translate(-50%, -8px); }

/* 响应式 */
/* 无障碍：用户系统开启"减少动态效果"时停掉所有背景/文字动画，省电且防晕 */
@media (prefers-reduced-motion: reduce) {
  .bg-anim *, .bg-anim::before, .bg-anim::after,
  .text-line, .live-flag::before {
    animation: none !important;
  }
}

@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; min-height: calc(100vh - 120px); }
  /* 用 clip 而非 hidden：既裁横向溢出，又不建立滚动容器，保住 position:sticky */
  .led-page { padding: 12px 12px 20px; overflow-x: clip; max-width: 100vw; touch-action: manipulation; }
  .page-actions { width: 100%; }
  .page-actions .btn { flex: 1; }
  .action-bar { flex-direction: column; align-items: stretch; }
  /* 平板/窄屏：按钮双列，不要一行一个全宽 */
  .action-btns, .seg-add, .seg-actions {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
    width: 100%;
  }
  .action-btns .btn, .seg-add .btn, .seg-actions .btn {
    flex: none;
    width: 100%;
  }
  .screen-stage { margin: 16px 10px 10px; }
  /* iOS Safari: input/select 字号 <16px focus 时会强制放大页面，抬到 16px  */
  .line-input { font-size: 16px; }
  select.line-tpl { font-size: 16px; }
  /* 手机端实时预览卡 sticky 悬浮：上下滑动时贴顶固定 */
  .card.sticky-preview {
    position: sticky;
    top: 0;
    z-index: 20;
    border-radius: 0;
    margin: 0 -12px;
  }
}

/* 手机 PWA（390×844）细化：双列按钮、紧凑、安全区 */
@media (max-width: 480px) {
  .led-page { padding: env(safe-area-inset-top) 10px calc(env(safe-area-inset-bottom) + 20px); }
  .page-head { flex-direction: column; gap: 8px; align-items: stretch; }
  .page-title { font-size: 18px; }
  .page-sub { font-size: 12px; }
  .preview-meta { flex-wrap: wrap; gap: 4px; font-size: 11px; }
  .screen-stage canvas, .screen-stage .screen { width: 100% !important; height: auto !important; }
  .bkg-grid { grid-template-columns: repeat(2, 1fr) !important; gap: 6px; }
  .line-row { flex-direction: column; gap: 6px; align-items: stretch; }
  .line-row .line-text { width: 100%; }
  /* 按钮双列：每行两个，节约竖屏空间 */
  .seg-add, .seg-actions, .action-btns {
    display: grid !important;
    grid-template-columns: repeat(2, 1fr);
    gap: 6px;
  }
  .seg-add .btn, .seg-actions .btn, .action-btns .btn {
    width: 100% !important;
    flex: none !important;
    padding: 0 8px;
    font-size: 12px;
    height: 36px;
  }
  /* 颜色弹框在窄屏上更紧凑 */
  .cp-pop { padding: 12px; }
  .cp-grid { gap: 6px; }
  .history-list .history-item { padding: 8px; font-size: 12px; }
  .card { padding: 10px; border-radius: 10px; }
}
</style>
