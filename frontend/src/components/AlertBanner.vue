<script setup lang="ts">
import { computed } from 'vue';
import { useSystemStore } from '@/stores/system';

const sys = useSystemStore();

const errorAlert = computed(() => sys.alerts.find((a) => a.level === 'error'));
const warningAlert = computed(() => sys.alerts.find((a) => a.level === 'warning'));
const active = computed(() => errorAlert.value ?? warningAlert.value ?? null);

function dismiss(): void {
  sys.clearAlerts();
}
</script>

<template>
  <transition name="banner">
    <div v-if="active" :class="['alert-banner', `is-${active.level}`]">
      <div class="alert-icon">{{ active.level === 'error' ? '✖' : '⚠' }}</div>
      <div class="alert-body">
        <div class="alert-source">{{ active.source }}</div>
        <div class="alert-msg">{{ active.message }}</div>
      </div>
      <div class="alert-count" v-if="sys.alerts.length > 1">+{{ sys.alerts.length - 1 }}</div>
      <button class="alert-close" @click="dismiss" aria-label="清除">×</button>
    </div>
  </transition>
</template>

<style scoped>
.alert-banner {
  position: relative;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 18px;
  border-radius: 0;
  background: rgba(239, 68, 68, 0.92);
  color: #fff;
  font-weight: 500;
}
.alert-banner.is-warning {
  background: rgba(245, 158, 11, 0.92);
  color: #1f2937;
}
.alert-icon {
  font-size: 20px;
  font-weight: 700;
}
.alert-body { flex: 1; line-height: 1.3; }
.alert-source { font-size: 12px; opacity: 0.85; }
.alert-msg { font-size: 15px; }
.alert-count {
  font-size: 12px;
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.25);
  border-radius: 999px;
}
.alert-close {
  background: transparent;
  border: none;
  color: inherit;
  font-size: 24px;
  cursor: pointer;
  width: 36px;
  height: 36px;
  border-radius: 8px;
}
.alert-close:active {
  background: rgba(0, 0, 0, 0.2);
}
.banner-enter-from, .banner-leave-to { opacity: 0; transform: translateY(-10px); }
.banner-enter-active, .banner-leave-active { transition: all 0.2s ease; }
</style>
