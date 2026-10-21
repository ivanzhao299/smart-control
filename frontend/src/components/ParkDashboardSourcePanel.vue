<script setup lang="ts">
/**
 * 输入源 · 园区运营大屏数据运营面板（2026-10 输入源改造）。
 *
 * 只做 UI 聚合：翻页 / 自动轮播 / 强制刷新 / 认领状态。全部 emit 由 PlayerConsole
 * 路由回现有 parkOpsControl / releaseParkOps，不新增业务逻辑。
 * 数据维护（园区平面图 / 自定义文案）配置在后台，仅后台权限可见，点击跳后台。
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

      <!-- 操作按钮 -->
      <div class="pd-actions">
        <button type="button" class="v2-quick" :disabled="busy" @click="emit('control', 'prev')">
          <ChevronLeft :size="15" /> 上一页
        </button>
        <button type="button" class="v2-quick" :disabled="busy" @click="emit('control', 'next')">
          <ChevronRight :size="15" /> 下一页
        </button>
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
      <p class="pd-maint-hint">园区平面图、自定义文案在后台配置，保存后大屏生效。</p>
      <button type="button" class="v2-quick" @click="emit('maintain')">
        <ExternalLink :size="14" /> 打开后台配置
      </button>
    </section>
  </div>
</template>

<style scoped>
.pd-grid { display: flex; flex-direction: column; gap: 12px; min-width: 0; }
.pd-state {
  display: flex; align-items: center; gap: 7px; flex-wrap: wrap;
  padding: 9px 11px; border-radius: var(--v2-r-md);
  background: var(--v2-surf-2); margin-bottom: 10px;
}
.pd-state-text { font-size: 13px; color: var(--v2-text-2); }
.pd-state-text.ok { color: #2FA36B; }
.pd-state-text.warn { color: #D98A2B; }
.pd-state .ok { color: #2FA36B; }
.pd-release {
  margin-left: auto; border: 1px solid rgba(47,163,107,.45); background: rgba(47,163,107,.12);
  color: #2FA36B; border-radius: 999px; font-size: 11px; line-height: 1; padding: 5px 11px; cursor: pointer;
}
.pd-release:hover { background: rgba(47,163,107,.22); }
.pd-actions { display: flex; gap: 8px; flex-wrap: wrap; }
.pd-actions .v2-quick { flex: 1 1 auto; min-width: 96px; }
.pd-actions .v2-quick.on { border-color: var(--v2-success); color: var(--v2-success); }
.pd-maint-hint { font-size: 12px; color: var(--v2-text-3); line-height: 1.5; margin-bottom: 10px; }
.pd-maint .v2-quick { width: 100%; }
</style>
