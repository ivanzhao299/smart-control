<script setup lang="ts">
defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  (e: 'enter'): void;
  (e: 'dismiss'): void;
}>();
</script>

<template>
  <transition name="fs-fade">
    <div v-if="visible" class="fs-mask" @click.self="emit('enter')">
      <div class="fs-card">
        <div class="fs-icon">🖥</div>
        <div class="fs-title">终端模式</div>
        <div class="fs-desc">
          建议进入全屏运行以获得最佳触控体验。<br />
          点击「进入终端」或在页面任意位置点击均可全屏；按 Esc 退出。
        </div>
        <div class="fs-actions">
          <button class="fs-btn fs-primary" @click="emit('enter')">进入终端模式</button>
          <button class="fs-btn fs-ghost" @click="emit('dismiss')">本次稍后</button>
        </div>
        <div class="fs-tip">
          💡 建议添加到主屏 (PWA)，下次自动全屏。
        </div>
      </div>
    </div>
  </transition>
</template>

<style scoped>
.fs-mask {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 24, 39, 0.86);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.fs-card {
  width: min(520px, 88vw);
  background: var(--bg-panel);
  border: 1px solid var(--border-soft);
  border-radius: 22px;
  padding: 32px 36px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  align-items: center;
  text-align: center;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.45);
}
.fs-icon { font-size: 52px; line-height: 1; }
.fs-title { font-size: 22px; font-weight: 600; letter-spacing: 1px; }
.fs-desc { font-size: 15px; color: var(--text-secondary); line-height: 1.7; }
.fs-actions {
  display: flex; gap: 12px; margin-top: 8px;
}
.fs-btn {
  min-height: 50px; padding: 0 26px;
  border: none; border-radius: 12px;
  font-size: 16px; font-weight: 600; cursor: pointer;
  transition: transform 0.1s, background 0.2s, opacity 0.2s;
}
.fs-btn:active { transform: scale(0.97); }
.fs-primary { background: var(--color-primary); color: #fff; }
.fs-primary:hover { background: var(--color-primary-hover); }
.fs-ghost { background: var(--bg-elevated); color: var(--text-primary); }
.fs-ghost:hover { background: var(--border-strong); }
.fs-tip { font-size: 13px; color: var(--text-secondary); margin-top: 6px; }

.fs-fade-enter-from, .fs-fade-leave-to { opacity: 0; }
.fs-fade-enter-active, .fs-fade-leave-active { transition: opacity 0.2s ease; }
</style>
