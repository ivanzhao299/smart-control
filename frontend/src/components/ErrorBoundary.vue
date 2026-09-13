<script setup lang="ts">
/**
 * 崩溃自恢复边界 — 工业终端健壮性
 *
 * 包住当前页面子树, 任何渲染 / 生命周期 / watcher 同步错误都在这里被捕获,
 * 显示降级 UI 而不是让一处未捕获异常拖垮整个界面 (白屏). 侧栏导航、其他
 * 功能都还在, 用户切到别的页面会自动恢复, 或就地点"重试本页"。
 */
import { ref, onErrorCaptured, watch } from 'vue';
import { useRoute } from 'vue-router';
import { RotateCcw, TriangleAlert } from 'lucide-vue-next';

const route = useRoute();
const err = ref<Error | null>(null);

onErrorCaptured((e) => {
  err.value = e as Error;
  // eslint-disable-next-line no-console
  console.error('[ErrorBoundary] 页面错误已隔离:', e);
  return false; // 阻止向上冒泡, 应用其余部分继续运行
});

// 切到别的页面自动恢复 — 用户换个菜单就好, 不必刷新整机
watch(() => route.fullPath, () => { err.value = null; });

function retry(): void { err.value = null; }
function reload(): void { window.location.reload(); }
</script>

<template>
  <div v-if="err" class="eb-fallback">
    <div class="eb-ico"><TriangleAlert :size="36" :stroke-width="1.6" /></div>
    <div class="eb-title">这个页面遇到了问题</div>
    <div class="eb-sub">已自动隔离 · 其他功能正常 · 可重试本页或刷新应用</div>
    <div class="eb-actions">
      <button class="eb-btn primary" @click="retry">
        <RotateCcw :size="15" :stroke-width="2" /> 重试本页
      </button>
      <button class="eb-btn" @click="reload">刷新应用</button>
    </div>
  </div>
  <slot v-else />
</template>

<style scoped>
.eb-fallback {
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 12px; min-height: 60vh; padding: 40px 24px; text-align: center;
}
.eb-ico {
  width: 72px; height: 72px; border-radius: 18px;
  display: grid; place-items: center;
  background: rgba(224, 160, 48, 0.12); color: #FCD34D;
  box-shadow: 0 0 30px -8px rgba(224, 160, 48, 0.4);
}
.eb-title { font-size: 19px; font-weight: 600; color: var(--v2-text-1); }
.eb-sub { font-size: 13px; color: var(--v2-text-3); max-width: 340px; line-height: 1.5; }
.eb-actions { display: flex; gap: 10px; margin-top: 8px; }
.eb-btn {
  padding: 10px 20px; border-radius: var(--v2-r-sm); font-size: 14px;
  background: var(--v2-surf-1); border: 1px solid var(--v2-border-soft);
  color: var(--v2-text-2); cursor: pointer;
  display: inline-flex; align-items: center; gap: 6px;
  transition: all 0.18s ease;
}
.eb-btn:hover { background: var(--v2-surf-1-hover); color: var(--v2-text-1); }
.eb-btn.primary {
  background: var(--v2-primary-soft); color: var(--v2-primary);
  border-color: rgba(76, 154, 255, 0.3);
}
</style>
