<script setup lang="ts">
/**
 * 输入源 · 园区运营大屏数据运营面板（2026-10 输入源改造）。
 *
 * 只做 UI 聚合：翻页 / 自动轮播 / 强制刷新 / 认领状态。全部 emit 由 PlayerConsole
 * 路由回现有 parkOpsControl / releaseParkOps，不新增业务逻辑。
 * 数据维护（在园人员/在场车辆/企业数/运营文案）配置在后台，仅运营数据权限可见，点击跳后台。
 */
import { computed } from 'vue';
import {
  ChevronLeft, ChevronRight, RefreshCw, Play, Timer, ExternalLink,
  Map, Check,
} from 'lucide-vue-next';

const props = defineProps<{
  page: number;
  totalPages: number;
  auto: boolean;
  busy: boolean;
  claimed: boolean;
  claimByMe: boolean;
  claimName: string | null;
  claimRemaining: number;
  canMaintain: boolean;
}>();

const emit = defineEmits<{
  (e: 'control', action: 'next' | 'prev' | 'auto' | 'refresh'): void;
  (e: 'release'): void;
  (e: 'maintain'): void;
}>();

const remainingText = computed(() => {
  const total = Math.max(0, Math.round(props.claimRemaining / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
});
</script>

<template>
  <div class="pd-grid">
    <!-- 数据运营 -->
    <section class="panel pd-ops">
      <div class="panel-head">
        <span class="panel-title"><Timer :size="17" /> 数据运营</span>
        <span class="panel-count" v-if="totalPages">第 {{ page }} / {{ totalPages }} 页</span>
      </div>

      <!-- 状态行 -->
      <div class="pd-state">
        <Check v-if="claimByMe" :size="14" class="ok" />
        <span v-if="auto" class="pd-state-text">自动轮播中 · 第 {{ page }} 页</span>
        <span v-else-if="claimByMe" class="pd-state-text ok">我接管中 · 手动翻页 · 第 {{ page }} 页</span>
        <span v-else-if="claimed && claimName" class="pd-state-text warn">
          {{ claimName }} 接管中 · 剩余 {{ remainingText }}（操作即接管）
        </span>
        <span v-else class="pd-state-text">手动翻页 · 第 {{ page }} 页（操作即接管）</span>
        <button v-if="claimByMe" type="button" class="pd-release" @click="emit('release')">释放</button>
      </div>

      <!-- 强调翻页：上一页 / 下一页（主色实心大按钮，醒目可点） -->
      <div class="pd-nav">
        <button type="button" class="pd-nav-btn" :disabled="busy" @click="emit('control', 'prev')">
          <ChevronLeft :size="24" :stroke-width="2.5" /> 上一页
        </button>
        <button type="button" class="pd-nav-btn" :disabled="busy" @click="emit('control', 'next')">
          下一页 <ChevronRight :size="24" :stroke-width="2.5" />
        </button>
      </div>

      <!-- 次要操作：自动轮播 / 强制刷新 -->
      <div class="pd-sub">
        <button type="button" class="v2-quick" :class="{ on: auto }" :disabled="busy" @click="emit('control', 'auto')">
          <Play :size="14" /> 自动轮播
        </button>
        <button type="button" class="v2-quick" :disabled="busy" @click="emit('control', 'refresh')">
          <RefreshCw :size="14" /> 强制刷新
        </button>
      </div>
    </section>

    <!-- 数据维护（仅后台权限可见） -->
    <section v-if="canMaintain" class="panel pd-maint">
      <div class="panel-head">
        <span class="panel-title"><Map :size="17" /> 数据维护</span>
      </div>
      <p class="pd-maint-hint">在园人员、在场车辆、入驻企业数等运营指标，以及大屏文案在此维护；发布后约 15 秒同步到运营大屏，也可在上方点「强制刷新」立即生效。</p>
      <button type="button" class="v2-quick" @click="emit('maintain')">
        <ExternalLink :size="14" /> 打开运营数据维护
      </button>
    </section>
  </div>
</template>

<style scoped>
.pd-grid { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.pd-state {
  display: flex; align-items: center; gap: 7px; flex-wrap: nowrap;
  min-height: 38px; overflow: hidden;
  padding: 9px 11px; border-radius: var(--v2-r-md);
  background: var(--v2-surf-2); margin-bottom: 10px;
}
.pd-state-text {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 13px; color: var(--v2-text-2);
}
.pd-state-text.ok { color: #2FA36B; }
.pd-state-text.warn { color: #D98A2B; }
.pd-state .ok { color: #2FA36B; }
.pd-release {
  flex: 0 0 auto;
  margin-left: auto; border: 1px solid rgba(47,163,107,.45); background: rgba(47,163,107,.12);
  color: #2FA36B; border-radius: 999px; font-size: 11px; line-height: 1; padding: 5px 11px; cursor: pointer;
}
.pd-release:hover { background: rgba(47,163,107,.22); }
/* 强调翻页：主色实心渐变 + 投影，按下时轻微缩小、提亮（克制反馈） */
.pd-nav { display: flex; gap: 10px; margin-bottom: 10px; }
.pd-nav-btn {
  flex: 1 1 0; min-width: 0; height: 54px; border-radius: var(--v2-r-md);
  background: linear-gradient(180deg, var(--v2-primary), var(--v2-primary-dark));
  border: 1px solid var(--v2-primary-dark); color: #fff;
  font-size: 14.5px; font-weight: 700; font-family: inherit; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  box-shadow: 0 4px 14px rgba(99,102,241,.35);
  transition: transform .12s, box-shadow .12s, filter .15s;
}
.pd-nav-btn:active {
  transform: scale(.97); filter: brightness(1.06);
  box-shadow: inset 0 2px 6px rgba(0,0,0,.22), 0 2px 8px rgba(99,102,241,.3);
}
.pd-nav-btn:disabled { opacity: .5; cursor: not-allowed; box-shadow: none; }
/* 次要操作：自动轮播 / 强制刷新，等宽 */
.pd-sub { display: flex; gap: 8px; }
.pd-sub .v2-quick { flex: 1 1 0; min-width: 0; }
.pd-sub .v2-quick.on { border-color: var(--v2-success); color: var(--v2-success); }
.pd-maint-hint { font-size: 12px; color: var(--v2-text-3); line-height: 1.5; margin-bottom: 10px; }
.pd-maint .v2-quick { width: 100%; }
</style>
