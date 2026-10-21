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

interface Line {
  id: number;
  text: string;
  size: number;   // 灯珠行高 3-30
  tpl: 'static' | 'scrollL' | 'scrollR' | 'blink' | 'gradient';
  color: string;
}

let lineSeq = 2;
const lines = ref<Line[]>([
  { id: 0, text: '金湖科创产业园', size: 6, tpl: 'static', color: '#4C9AFF' },
  { id: 1, text: '智慧园区 · 诚邀入驻', size: 4, tpl: 'scrollL', color: '#34D399' },
]);

const BKG_LIST = [
  { key: 'none', name: '纯色' },
  { key: 'flow', name: '流光溢彩' },
  { key: 'breathe', name: '光晕呼吸' },
  { key: 'stars', name: '星光闪烁' },
  { key: 'rainbow', name: '彩虹流动' },
  { key: 'scan', name: '霓虹流光' },
  { key: 'tech', name: '科技光斑' },
] as const;
type BkgKey = typeof BKG_LIST[number]['key'];
const curBkg = ref<BkgKey>('flow');

const speed = ref(5); // 1-10 档，档×6 灯珠/秒
const speedNote = computed(() => `≈${speed.value * 6} 灯珠/秒`);

// 安全区提示：Σ行高+(n-1)行距 vs 30 行
const usedRows = computed(() => {
  const gap = 1; // 行距 1 灯珠
  return lines.value.reduce((s, l) => s + l.size, 0) + (lines.value.length - 1) * gap;
});
const safeHint = computed(() =>
  usedRows.value <= 30
    ? `内容高 ${usedRows.value}/30 行 · 安全`
    : `超出安全区 ${usedRows.value - 30} 行`
);

function addLine() {
  lines.value.push({ id: lineSeq++, text: '新行文字', size: 4, tpl: 'static', color: '#4C9AFF' });
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
}
let segSeq = 0;
const segs = ref<Seg[]>([]);
function addTextSeg() {
  const first = lines.value[0]?.text || '文字段';
  segs.value.push({ id: segSeq++, kind: 'text', name: `文字段 · ${first}`, rep: 1 });
}
function addVideoSeg() {
  segs.value.push({ id: segSeq++, kind: 'video', name: `视频段 · 未选择`, rep: 1 });
}
function delSeg(id: number) {
  segs.value = segs.value.filter((s) => s.id !== id);
}

// 灯珠网格（290 列）
const ledCells = Array.from({ length: 290 }, (_, i) => i + 1);

// PVE 探活（演示态）
const pveOnline = ref(true);
const pveDotCls = computed(() => (pveOnline.value ? 'dot-on' : 'dot-off'));

// 历史记录（静态演示）
const histList = [
  { name: '园区宣传 · 08:30', sub: '左滚动 · 流光 · 290×30', state: 'ok' as const, stateText: '已播出' },
  { name: '招商信息页 · 07:00', sub: '招商模板 · 科技光斑 · 290×30', state: 'ok' as const, stateText: '已播出' },
  { name: '视频节目 · 昨天 18:30', sub: '2 段视频拼接 · 290×30', state: 'wait' as const, stateText: '已归档' },
];

const toastMsg = ref('');
function toast(t: string) {
  toastMsg.value = t;
  window.setTimeout(() => (toastMsg.value = ''), 2200);
}

function genBin() {
  toast(segs.value.length
    ? `已生成节目 bin（${segs.value.length} 段），预览区即完整效果`
    : '已自动将当前多行设计封装为文字段');
}

onMounted(() => { /* 预留：拉历史记录/探活 PVE */ });
onUnmounted(() => { /* 预留 */ });
</script>

<template>
  <div class="led-page">
    <!-- 页头 -->
    <div class="page-head">
      <div>
        <div class="page-title">
          LED 节目制作
          <span class="pve-dot" :class="pveDotCls" :title="pveOnline ? 'PVE 在线' : 'PVE 离线'"></span>
        </div>
        <div class="page-sub">勇电灯珠屏 · 290×30 真实点阵 · 编排 → 生成 bin → PVE 直推接收卡（224.1.1.1:65535）</div>
      </div>
      <div class="page-actions">
        <button class="btn btn-ghost" @click="toast('PVE 连接配置面板')">PVE 状态</button>
        <button class="btn btn-ghost" @click="toast('PVE 定时开关机配置')">定时开关</button>
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
            <!-- 灯珠底网格 -->
            <div class="led-grid">
              <div v-for="c in ledCells" :key="c" class="led-cell"></div>
            </div>
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
            <span class="gen-stamp">未生成</span>
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
                  <option value="static">静态</option>
                  <option value="scrollL">左滚动</option>
                  <option value="scrollR">右滚动</option>
                  <option value="blink">闪烁</option>
                  <option value="gradient">渐变</option>
                </select>
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
              <div class="seg-item" v-for="s in segs" :key="s.id">
                <span class="seg-ic" :class="s.kind === 'text' ? 't' : 'v'">{{ s.kind === 'text' ? '文' : '视' }}</span>
                <span class="seg-name">{{ s.name }}</span>
                <span class="seg-rep">×{{ s.rep }}</span>
                <button class="seg-op-btn del" @click="delSeg(s.id)">删</button>
              </div>
            </div>
            <div class="seg-empty" v-else>尚未添加任何段 — 点上方按钮把当前设计封装为段</div>
            <div class="seg-actions">
              <button class="btn btn-primary" @click="genBin">生成节目 bin</button>
              <button class="btn btn-ghost" @click="segs = []">清空节目</button>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- 底部操作条 -->
    <div class="action-bar">
      <div class="action-btns">
        <button class="btn btn-primary" @click="genBin">生成 bin 文件</button>
        <button class="btn btn-danger" @click="toast('推流播出确认（生产环境需管理员权限）')">推流播出</button>
      </div>
      <div class="action-note">编排确认无误后生成 bin，再推流到接收卡</div>
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
}
.led-grid {
  position: absolute;
  inset: 0;
  z-index: 1;
  display: flex;
}
.led-cell {
  flex: 1 1 0;
  min-width: 0;
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
.seg-rep { font-size: 11px; color: var(--v2-text-2, #8CA0B8); }
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
.hist-card { margin-top: 14px; }
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
@media (max-width: 860px) {
  .layout { grid-template-columns: 1fr; min-height: calc(100vh - 120px); }
  .led-page { padding: 12px 12px 20px; overflow-x: hidden; overflow-y: visible; max-width: 100vw; }
  .page-actions { width: 100%; }
  .page-actions .btn { flex: 1; }
  .action-bar { flex-direction: column; align-items: stretch; }
  .action-btns { width: 100%; }
  .action-btns .btn { flex: 1; }
  .screen-stage { margin: 16px 10px 10px; }
  /* 手机端实时预览卡 sticky 悬浮：上下滑动时贴顶固定 */
  .card.sticky-preview {
    position: sticky;
    top: 0;
    z-index: 20;
    border-radius: 0;
    margin: 0 -12px;
  }
}
</style>
