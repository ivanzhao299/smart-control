<script setup lang="ts">
/**
 * 播放器卡片 · 视频控制条 (2026-10)。
 *
 * 自包含: 只读 slot, 内部从播放 store 取通道与大屏回传进度, 逻辑全部委托
 * usePlayerVideoControls。抽成独立组件以保持 PlayerConsole 精简(项目约定组件行数有上限)。
 * 仅视频时渲染: 单次/循环切换 + 可拖拽进度条(当前/总时长)。大屏画面纯净, 此条只在控制端。
 */
import { computed, onScopeDispose } from 'vue';
import { Repeat, Repeat1 } from 'lucide-vue-next';
import { usePlaybackStore } from '@/stores/playback';
import { captureIdentityGuard } from '@/services/identity-boundary';
import { usePlayerVideoControls } from '@/composables/usePlayerVideoControls';

const props = defineProps<{ slot: 1 | 2 }>();

const playbackStore = usePlaybackStore();
const ch = computed(() => (props.slot === 1 ? playbackStore.slot1 : playbackStore.slot2));

let disposed = false;
onScopeDispose(() => { disposed = true; });
function captureAction(): () => boolean {
  const s = props.slot;
  return captureIdentityGuard(() => !disposed && props.slot === s);
}

const {
  isVideoPlaying,
  seekDuration,
  seekCurrent,
  loopBusy,
  onSeekInput,
  onSeekCommit,
  toggleLoop,
  formatTime,
} = usePlayerVideoControls({
  slot: computed(() => props.slot),
  channel: ch,
  captureAction,
});
</script>

<template>
  <div v-if="isVideoPlaying" class="video-ctrl">
    <button
      type="button"
      class="loop-toggle"
      :class="{ on: ch?.loopMode === 'loop' }"
      :disabled="loopBusy"
      :title="ch?.loopMode === 'loop' ? '当前循环播放，点击改为单次（播完停尾帧）' : '当前单次播放（播完停尾帧），点击改为循环'"
      @click="toggleLoop"
    >
      <Repeat v-if="ch?.loopMode === 'loop'" :size="13" />
      <Repeat1 v-else :size="13" />
      {{ ch?.loopMode === 'loop' ? '循环' : '单次' }}
    </button>
    <div class="seek-row">
      <span class="seek-time">{{ formatTime(seekCurrent) }}</span>
      <input
        class="seek-range"
        type="range"
        min="0"
        :max="seekDuration || 0"
        step="0.1"
        :value="seekCurrent"
        :aria-label="`视频进度，总时长 ${formatTime(seekDuration)}`"
        @input="onSeekInput"
        @change="onSeekCommit"
      />
      <span class="seek-time">{{ formatTime(seekDuration) }}</span>
    </div>
  </div>
</template>

<style scoped>
.video-ctrl {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
/* 单次/循环切换: 循环=科技蓝高亮; 触摸目标足够 */
.loop-toggle {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 5px 11px;
  border-radius: 999px;
  cursor: pointer;
  font-size: 12px;
  line-height: 1.4;
  white-space: nowrap;
  color: var(--v2-text-2);
  background: var(--v2-surf-2, #1a1d22);
  border: 1px solid var(--v2-border-soft, #23262c);
}
.loop-toggle:hover:not(:disabled) {
  border-color: var(--v2-primary);
  color: var(--v2-primary);
}
.loop-toggle.on {
  color: var(--v2-primary);
  border-color: var(--v2-primary);
  background: rgba(64, 140, 255, 0.12);
}
.loop-toggle:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.seek-time {
  font-size: 12px;
  color: var(--v2-text-2);
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-width: 40px;
  text-align: center;
}
/* 进度条行: 包裹"当前时间 + 滑块 + 总时长", 桌面端吃满剩余宽度 */
.seek-row {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.seek-range {
  flex: 1 1 auto;
  min-width: 0;
  height: 24px;
  margin: 0;
  cursor: pointer;
  accent-color: var(--v2-primary, #408cff);
}

/* 手机端: 元素紧凑样式; 换行/与"画面铺放"同行的整体布局由 PlayerConsole 统一控制
   (PlayerConsole 把 .video-ctrl 设为 display:contents, 让这两个元素直接参与 .now 的 flex 排列)
   进度条行压到最矮: 视觉轨道/拇指由原生控件渲染, 仅收窄占位高度, 点击仍可命中整条 */
@media (max-width: 640px) {
  .loop-toggle {
    padding: 3px 12px;
    font-size: 11px;
  }
  /* 进度条压成一根细线(业主要求): 视觉轨道 3px、拇指 12px, 命中盒只留 14px,
     不再占 20px 高; 配合 .now 固定 150px, 视频态绝不把播放卡撑高。 */
  .seek-row {
    gap: 5px;
    min-height: 14px;
  }
  .seek-time {
    min-width: 28px;
    font-size: 10px;
    line-height: 1;
  }
  .seek-range {
    height: 14px;
    -webkit-appearance: none;
    appearance: none;
    background: transparent;
    accent-color: var(--v2-primary, #408cff);
  }
  /* 一根 3px 细轨道 + 圆形拇指(webkit 系: iOS WKWebView / 安卓 WebView / Chrome) */
  .seek-range::-webkit-slider-runnable-track {
    height: 3px;
    border-radius: 2px;
    background: var(--v2-border-soft, #2a313c);
  }
  .seek-range::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    /* 命中盒扩大到 28×28(手指易抓), 视觉仍是中心 12px 圆点: radial-gradient
       中心 6px 半径画实心圆点(=12px), 外圈透明; 透明区域仍属 thumb 命中盒、可点按。
       margin-top 让 28px 命中盒相对 3px 轨道垂直居中(2026-10-17 #134)。 */
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--v2-primary, #408cff) 0 6px, transparent 6.5px);
    margin-top: -12.5px; /* (轨道3 - 命中盒28) / 2 */
    border: none;
  }
  .seek-range::-moz-range-track {
    height: 3px;
    border-radius: 2px;
    background: var(--v2-border-soft, #2a313c);
  }
  .seek-range::-moz-range-thumb {
    /* 同 webkit: 命中盒 28px, 中心 12px 可见圆点; moz 拇指自动相对轨道垂直居中, 无需 margin */
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: radial-gradient(circle, var(--v2-primary, #408cff) 0 6px, transparent 6.5px);
    border: none;
  }
}
</style>
