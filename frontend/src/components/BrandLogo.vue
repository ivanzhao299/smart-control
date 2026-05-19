<script setup lang="ts">
withDefaults(
  defineProps<{ size?: number; active?: boolean }>(),
  { size: 42, active: true },
);
</script>

<template>
  <div
    class="brand-logo"
    :class="{ 'is-active': active }"
    :style="{ width: size + 'px', height: size + 'px' }"
    aria-hidden="true"
  >
    <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bl-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#3b82f6" />
          <stop offset="1" stop-color="#7c3aed" />
        </linearGradient>
        <linearGradient id="bl-grad-soft" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stop-color="#3b82f6" stop-opacity="0.18" />
          <stop offset="1" stop-color="#7c3aed" stop-opacity="0.18" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="48" height="48" rx="12" fill="url(#bl-grad)" />
      <circle cx="24" cy="24" r="13.5" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.6" />
      <circle cx="24" cy="24" r="8" fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="1.6" />
      <circle cx="24" cy="24" r="3.4" fill="#ffffff" />
      <circle cx="24" cy="6"  r="1.6" fill="rgba(255,255,255,0.95)" />
      <circle cx="24" cy="42" r="1.6" fill="rgba(255,255,255,0.55)" />
      <circle cx="6"  cy="24" r="1.6" fill="rgba(255,255,255,0.55)" />
      <circle cx="42" cy="24" r="1.6" fill="rgba(255,255,255,0.95)" />
    </svg>
    <span v-if="active" class="pulse" />
  </div>
</template>

<style scoped>
.brand-logo {
  position: relative;
  border-radius: 14px;
  display: inline-block;
  box-shadow: 0 8px 20px -8px rgba(59, 130, 246, 0.55);
}
.brand-logo svg {
  width: 100%; height: 100%;
  border-radius: 14px;
  display: block;
}
.pulse {
  position: absolute;
  top: 50%; left: 50%;
  width: 16%; height: 16%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.65);
  animation: bl-pulse 2.4s ease-out infinite;
  pointer-events: none;
}
@keyframes bl-pulse {
  0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.7; }
  70%  { transform: translate(-50%, -50%) scale(3.4); opacity: 0;   }
  100% { transform: translate(-50%, -50%) scale(3.4); opacity: 0;   }
}
</style>
