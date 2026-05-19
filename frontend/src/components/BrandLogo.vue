<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(
  defineProps<{
    /** 整块高度 (px); 宽度由 aspect 自动算 */
    height?: number;
    /** 显式 width (px), 仅在需要精确控件大小时传 */
    width?: number;
    /** 使用真实公司 LOGO 图片 (默认 true). 设 false 强制使用 SVG 几何标识 */
    useImage?: boolean;
    /** 图片路径; 默认 BASE_URL + 'brand-logo.png' (放 frontend/public/) */
    src?: string;
    alt?: string;
    active?: boolean;
  }>(),
  {
    height: 44,
    width: undefined,
    useImage: true,
    src: undefined,
    alt: '金湖科创产业园',
    active: true,
  },
);

const imageBroken = ref(false);
const imageSrc = props.src ?? `${import.meta.env.BASE_URL}brand-logo.png`;
const showImage = props.useImage && !imageBroken.value;
</script>

<template>
  <div
    class="brand-logo"
    :class="{ 'is-active': active, 'is-image': showImage }"
    :style="{
      height: height + 'px',
      width: width ? width + 'px' : undefined,
    }"
    aria-hidden="true"
  >
    <!-- 公司 LOGO 图片 -->
    <img
      v-if="showImage"
      :src="imageSrc"
      :alt="alt"
      class="logo-img"
      @error="imageBroken = true"
    />

    <!-- 回退: SVG 几何标识 (图片缺失 / useImage=false) -->
    <template v-else>
      <svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" class="logo-svg">
        <defs>
          <linearGradient id="bl-grad" x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
            <stop offset="0" stop-color="#3b82f6" />
            <stop offset="1" stop-color="#7c3aed" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="48" height="48" rx="12" fill="url(#bl-grad)" />
        <circle cx="24" cy="24" r="13.5" fill="none" stroke="rgba(255,255,255,0.85)" stroke-width="1.6" />
        <circle cx="24" cy="24" r="8" fill="none" stroke="rgba(255,255,255,0.95)" stroke-width="1.6" />
        <circle cx="24" cy="24" r="3.4" fill="#ffffff" />
        <circle cx="24" cy="6"  r="1.6" fill="rgba(255,255,255,0.95)" />
        <circle cx="42" cy="24" r="1.6" fill="rgba(255,255,255,0.95)" />
      </svg>
      <span v-if="active" class="pulse" />
    </template>
  </div>
</template>

<style scoped>
.brand-logo {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.logo-img {
  height: 100%;
  width: auto;
  max-width: 100%;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 2px 6px rgba(15, 23, 42, 0.18));
}

.logo-svg {
  height: 100%;
  aspect-ratio: 1;
  border-radius: 14px;
  display: block;
  box-shadow: 0 8px 20px -8px rgba(59, 130, 246, 0.55);
}

.pulse {
  position: absolute;
  top: 50%; left: 50%;
  width: 8%; height: 8%;
  transform: translate(-50%, -50%);
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.65);
  animation: bl-pulse 2.4s ease-out infinite;
  pointer-events: none;
}
.brand-logo.is-image .pulse { display: none; }
@keyframes bl-pulse {
  0%   { transform: translate(-50%, -50%) scale(1);   opacity: 0.7; }
  70%  { transform: translate(-50%, -50%) scale(4);   opacity: 0;   }
  100% { transform: translate(-50%, -50%) scale(4);   opacity: 0;   }
}
</style>
