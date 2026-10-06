<script setup lang="ts">
import { pwaUpdate, acceptUpdate, declineUpdate } from '@/services/pwa-update-state';
</script>

<template>
  <Transition name="pwa-banner">
    <div
      v-if="pwaUpdate.visible"
      class="pwa-update-banner"
      role="alertdialog"
      aria-label="发现新版本"
    >
      <div class="pwa-update-banner__inner">
        <span class="pwa-update-banner__icon" aria-hidden="true">
          <svg
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 4v5h-5" />
          </svg>
        </span>
        <span class="pwa-update-banner__text">发现新版本，更新后可使用最新功能</span>
        <span class="pwa-update-banner__actions">
          <button type="button" class="pwa-btn pwa-btn--ghost" @click="declineUpdate">
            稍后
          </button>
          <button type="button" class="pwa-btn pwa-btn--primary" @click="acceptUpdate">
            立即更新
          </button>
        </span>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.pwa-update-banner {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 4000;
  box-sizing: border-box;
  padding: calc(env(safe-area-inset-top, 0px) + 8px) 10px 8px;
  pointer-events: none;
}

.pwa-update-banner__inner {
  box-sizing: border-box;
  max-width: 720px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 12px;
  background: rgba(17, 24, 39, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.09);
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.4);
  backdrop-filter: blur(8px);
  pointer-events: auto;
}

.pwa-update-banner__icon {
  flex: 0 0 auto;
  display: inline-flex;
  color: #818cf8;
}

.pwa-update-banner__text {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  line-height: 1.35;
  color: #e5e7eb;
}

.pwa-update-banner__actions {
  flex: 0 0 auto;
  display: inline-flex;
  gap: 8px;
}

.pwa-btn {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.pwa-btn--ghost {
  background: transparent;
  color: #9ca3af;
  border-color: rgba(255, 255, 255, 0.14);
}

.pwa-btn--ghost:active {
  background: rgba(255, 255, 255, 0.06);
}

.pwa-btn--primary {
  background: #6366f1;
  color: #fff;
  font-weight: 600;
}

.pwa-btn--primary:active {
  background: #4f46e5;
}

.pwa-banner-enter-active,
.pwa-banner-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.pwa-banner-enter-from,
.pwa-banner-leave-to {
  opacity: 0;
  transform: translateY(-12px);
}

@media (max-width: 420px) {
  .pwa-update-banner {
    padding-left: 8px;
    padding-right: 8px;
  }

  .pwa-update-banner__inner {
    gap: 8px;
    padding: 9px 10px;
  }

  .pwa-btn {
    padding: 8px 10px;
  }
}
</style>
