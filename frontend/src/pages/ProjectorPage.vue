<script setup lang="ts">
// 投影仪页 (模型A, 2026-07-23 定): 投影内容由 GK9000 出 —— 跟 LED 一样用 PlayerConsole 管
// 媒体库/播放列表/选片/切换/上传, 推到 slot2 → GK9000 渲染 HDMI2 → 融合器显示 HDMI 输入
// (边缘融合到两台投影)。融合器只做"融合显示", 固定显示 GK9000 的 HDMI 输入。
//
// 顶部一条"投影输出"控制条: 显示融合器现在放的是不是 GK9000 的 HDMI 输入, 一键切回。
// (之前那版直控融合器窗口的完整面板是模型B, 业主选了模型A, 收成这条。)
import { onMounted, onUnmounted, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { MonitorPlay, Check, AlertTriangle, RefreshCw } from 'lucide-vue-next';
import PlayerConsole from '@/components/PlayerConsole.vue';
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

let timer: ReturnType<typeof setInterval> | null = null;
onMounted(() => {
  void loadFusion();
  timer = setInterval(() => { if (!busy.value) void loadFusion(); }, 8000);
});
onUnmounted(() => { if (timer) clearInterval(timer); });
</script>

<template>
  <div class="proj-wrap">
    <!-- 投影输出状态条 (融合器: 是否在显示 GK9000 的 HDMI 输入) -->
    <div class="out-bar" :class="showingHdmi === true ? 'ok' : showingHdmi === false ? 'warn' : 'unknown'">
      <MonitorPlay :size="16" :stroke-width="1.9" />
      <template v-if="showingHdmi === true">
        <Check :size="15" /> <span>投影正在显示 <b>GK9000 画面</b>(融合器 HDMI 输入,边缘融合中)</span>
      </template>
      <template v-else-if="showingHdmi === false">
        <AlertTriangle :size="15" /> <span>投影现在显示的是<b>融合器内部内容</b>,不是 GK9000 推的画面</span>
      </template>
      <template v-else>
        <AlertTriangle :size="15" /> <span>融合器连不上:{{ fusionErr || '检查融合器电源/网络' }}</span>
      </template>
      <button class="out-btn" :disabled="busy" @click="switchToGk">
        <RefreshCw :size="13" :class="{ spin: busy }" /> 切到 GK9000 画面
      </button>
    </div>
    <div class="out-hint">
      投影内容用下面的播放列表管(跟 LED 一样)。融合器负责把 GK9000 的画面边缘融合到两台投影,
      平时固定显示 GK9000 输入;若投影上不是 GK9000 的画面,点上面「切到 GK9000 画面」。
    </div>

    <!-- 播放控制台 (slot2 = 投影仪, GK9000 出内容) -->
    <PlayerConsole :slot="2" title="投影仪" />
  </div>
</template>

<style scoped>
.proj-wrap { display: flex; flex-direction: column; }
.out-bar {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
  margin: var(--v2-sp-5) var(--v2-sp-5) 0;
  padding: 10px 14px; border-radius: var(--v2-r-md);
  font-size: var(--v2-fs-sm); font-weight: 600;
}
.out-bar b { font-weight: 700; }
.out-bar.ok { background: var(--v2-success-soft); color: var(--v2-success); border: 1px solid var(--v2-success-soft); }
.out-bar.warn { background: var(--v2-warning-soft); color: var(--v2-warning); border: 1px solid var(--v2-warning-soft); }
.out-bar.unknown { background: var(--v2-danger-soft); color: var(--v2-danger); border: 1px solid var(--v2-danger-soft); }
.out-btn {
  margin-left: auto; display: inline-flex; align-items: center; gap: 5px;
  padding: 6px 12px; border-radius: 999px; cursor: pointer;
  font-size: 12px; font-weight: 600;
  background: var(--v2-surf-1); color: var(--v2-text-1); border: 1px solid var(--v2-border-soft);
}
.out-btn:hover:not(:disabled) { background: var(--v2-surf-1-hover); }
.out-btn:disabled { opacity: 0.5; cursor: default; }
.spin { animation: sp 0.9s linear infinite; } @keyframes sp { to { transform: rotate(360deg); } }
.out-hint { margin: 6px var(--v2-sp-5) 0; font-size: 11px; color: var(--v2-text-3); line-height: 1.5; }
</style>
