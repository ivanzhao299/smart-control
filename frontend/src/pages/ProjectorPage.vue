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
  <!-- 电源: 时序器 5 路(投影仪) + 4 路(视频拼接器) 一个开关同开同关 (2026-07-26 业主,
       两台设备总是一起工作; 此前误绑 seq-8) -->
  <PlayerConsole :slot="2" title="投影仪" power-code="seq-5,seq-4">
    <template #alert>
      <div v-if="showingHdmi !== true" class="out-bar" :class="showingHdmi === false ? 'warn' : 'unknown'">
        <AlertTriangle :size="15" />
        <span v-if="showingHdmi === false">投影当前显示的不是 GK9000 推的画面</span>
        <span v-else>融合器连不上:{{ fusionErr || '检查融合器电源/网络' }}</span>
        <button class="out-btn" :disabled="busy" @click="switchToGk">
          <RefreshCw :size="13" :class="{ spin: busy }" /> 切到 GK9000 画面
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
.out-bar > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.out-btn { flex: 0 0 auto; }
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
</style>
