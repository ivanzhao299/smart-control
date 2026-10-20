<script setup lang="ts">
// 投影仪页 (模型A, 2026-07-23 定): 投影内容由 GK9000 出 —— 跟 LED 一样用 PlayerConsole 管
// 媒体库/播放列表/选片/切换/上传, 推到 slot2 → GK9000 渲染 HDMI2 → 融合器显示 HDMI 输入
// (边缘融合到两台投影)。融合器只做"融合显示", 固定显示 GK9000 的 HDMI 输入。
//
// 顶部一条"投影输出"控制条: 显示融合器现在放的是不是 GK9000 的 HDMI 输入, 一键切回。
// (之前那版直控融合器窗口的完整面板是模型B, 业主选了模型A, 收成这条。)
import { ref } from 'vue';
import { ElMessage } from 'element-plus';
import { AlertTriangle, RefreshCw } from 'lucide-vue-next';
import PlayerConsole from '@/components/PlayerConsole.vue';
import { useActivePolling } from '@/composables/useActivePolling';
import { projectorService } from '@/services/projector.service';

const showingHdmi = ref<boolean | null>(null); // null = 还没读到/连不上
const fusionErr = ref('');
const busy = ref(false);

async function loadFusion(): Promise<void> {
  try {
    const s = await projectorService.status();
    showingHdmi.value = s.showingHdmi;
    fusionErr.value = '';
  } catch (e) {
    showingHdmi.value = null;
    fusionErr.value = (e as Error).message;
  }
}

async function switchToGk(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await projectorService.showHdmi();
    ElMessage.success('已让投影切回 GK9000 画面');
    await loadFusion();
  } catch (e) {
    ElMessage.error(`切换失败: ${(e as Error).message}`);
  } finally {
    busy.value = false;
  }
}

// 2026-07-27 切页卡顿根治: keep-alive 下 onUnmounted 不触发, 原来的 8s 轮询在
// 切走后永续后台运行。改 useActivePolling — 在本页才轮询, 切走即停。
let timer: ReturnType<typeof setInterval> | null = null;
function startPolling(): void {
  if (timer) return; // mounted+activated 双触发, 幂等
  void loadFusion();
  timer = setInterval(() => {
    if (document.hidden) return; // C3: 页面在后台不打设备
    if (!busy.value) void loadFusion();
  }, 8000);
}
function stopPolling(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
useActivePolling(startPolling, stopPolling);
</script>

<template>
  <!-- 电源: 时序器 5 路(投影仪) + 4 路(音频矩阵主机) + 「投影功放」(seq55-8,
       第三十轮确认已移到 SEQ55) 一个开关同开同关; 功放改用 code 精确绑定,
       电源页各路仍单独控制。
       音频矩阵与 LED 共用，power-keep-peers 标注「最后离开才关」：投影关机时若 LED
       主开关(1f-led)仍通电，矩阵保留给 LED。 -->
  <PlayerConsole
    :slot="2" title="投影仪" power-code="seq-5,seq-4"
    :power-amp-codes="['seq55-8']"
    :power-keep-peers="[{ code: 'seq-4', peers: ['1f-led'], peerLabel: 'LED 大屏' }]"
  >
    <template #alert>
      <div v-if="showingHdmi !== true" class="out-bar" :class="showingHdmi === false ? 'warn' : 'unknown'">
        <AlertTriangle :size="15" class="out-ico" />
        <!-- 手机端在播放卡内做无缝滚动字幕: 同一句文案渲染两份, .out-scroll-run 用 translateX(-50%)
             循环; 桌面端只显示第一份并单行省略(见 scoped 样式)。 -->
        <span class="out-scroll">
          <span class="out-scroll-run">
            <template v-if="showingHdmi === false">
              <span class="out-txt">投影当前显示的不是 GK9000 推的画面</span>
              <span class="out-txt" aria-hidden="true">投影当前显示的不是 GK9000 推的画面</span>
            </template>
            <template v-else>
              <span class="out-txt">融合器连不上:{{ fusionErr || '检查融合器电源/网络' }}</span>
              <span class="out-txt" aria-hidden="true">融合器连不上:{{ fusionErr || '检查融合器电源/网络' }}</span>
            </template>
          </span>
        </span>
        <button class="out-btn" :disabled="busy" @click="switchToGk">
          <RefreshCw :size="13" :class="{ spin: busy }" />
          <!-- 桌面显示完整「切到 GK9000 画面」; 手机端缩短为「切换画面」给滚动字幕腾空间(动作不变) -->
          <span class="out-btn-full">切到 GK9000 画面</span>
          <span class="out-btn-short">切换画面</span>
        </button>
      </div>
    </template>
  </PlayerConsole>
</template>

<style scoped>
.out-bar {
  /* 2026-07-25 业主: 只要文字不要文本框 — 一行警示小字, 零底色零边框 */
  /* 2026-07-26 业主: "投影卡片被两行文字撑高, 要和 LED 卡片高度一致" —
     改绝对定位悬浮在卡片右上角, 完全不占布局高度; 单行省略不换行 */
  position: absolute; top: 8px; right: 14px; max-width: 62%;
  display: flex; align-items: center; gap: 6px; flex-wrap: nowrap;
  margin: 0; overflow: hidden;
  font-size: 12px; font-weight: 500;
}
/* 桌面: .out-scroll 即原单行省略文字位; 只显示第一份文案, 第二份隐藏(手机端才双份滚动) */
.out-scroll { min-width: 0; flex: 1 1 auto; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.out-scroll-run { display: inline; white-space: nowrap; }
.out-scroll .out-txt { white-space: nowrap; }
.out-scroll .out-txt[aria-hidden="true"] { display: none; }
.out-ico { flex: 0 0 auto; }
.out-btn { flex: 0 0 auto; }
.out-btn-full { white-space: nowrap; }
.out-btn-short { display: none; } /* 桌面只显示完整文案, 手机端在 @media 里互换 */
.out-bar b { font-weight: 700; }
.out-bar.warn { color: var(--v2-warning); }
.out-bar.unknown { color: var(--v2-danger); }
.out-btn {
  margin-left: 6px; display: inline-flex; align-items: center; gap: 4px;
  padding: 2px 8px; border-radius: 999px; cursor: pointer;
  font-size: 12px; font-weight: 600;
  background: transparent; color: var(--v2-primary); border: 1px solid transparent;
  text-decoration: underline; text-underline-offset: 3px;
}
.out-btn:hover:not(:disabled) { background: var(--v2-surf-1-hover); }
.out-btn:disabled { opacity: 0.5; cursor: default; }
.spin { animation: sp 0.9s linear infinite; } @keyframes sp { to { transform: rotate(360deg); } }

/* 手机竖屏(≤640px): 告警回到播放卡内底部行, 与「铺放」同一行、位于铺放左侧(.alert-slot 是
   PlayerConsole 底部 .now-bottom flex 行的左项, 天然与铺放垂直对齐)。透明底、无胶囊、无绝对定位,
   不占任何额外行高, 故下方输入源/列表绝不下移、播放卡恒 150、两播放器切换无感。
   结构: 警示图标(固定) + 滚动字幕(占剩余, 双份文案 translateX(-50%) 无缝循环) +
   「切换画面」按钮(固定可点, 文案缩短给字幕腾空间)。无告警时 .alert-slot 为空、该处留白。桌面仍悬浮右上角。 */
@media (max-width: 640px) {
  .out-bar {
    position: static; top: auto; right: auto;
    width: 100%; max-width: 100%; margin: 0;
    padding: 0; background: transparent; border: none; border-radius: 0;
    display: flex; align-items: center; gap: 6px; flex-wrap: nowrap;
    overflow: hidden;
  }
  .out-ico { flex: 0 0 auto; }
  .out-scroll { flex: 1 1 0; min-width: 0; overflow: hidden; text-overflow: clip; }
  .out-scroll-run {
    display: inline-flex; white-space: nowrap;
    animation: out-marquee 11s linear infinite; will-change: transform;
  }
  .out-scroll .out-txt { display: inline; white-space: nowrap; padding-right: 42px; }
  /* 手机端恢复第二份文案, 与第一份首尾相接, 构成无缝横向滚动 */
  .out-scroll .out-txt[aria-hidden="true"] { display: inline; }
  /* 窄行不换行; 手机端按钮文案缩短为「切换画面」(动作不变), 给左侧滚动字幕腾出更多宽度 */
  .out-btn { margin-left: 0; flex: 0 0 auto; white-space: nowrap; }
  .out-btn-full { display: none; }
  .out-btn-short { display: inline; white-space: nowrap; }
  @keyframes out-marquee { from { transform: translateX(0); } to { transform: translateX(-50%); } }
}
@media (prefers-reduced-motion: reduce) {
  .out-scroll-run { animation: none; }
}
</style>
