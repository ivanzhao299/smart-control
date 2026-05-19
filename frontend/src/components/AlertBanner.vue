<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSystemStore } from '@/stores/system';
import { adminAlertService } from '@/services/admin.service';
import type { Alert, WsEvent } from '@/types/api';
import { wsClient } from '@/services/websocket.service';

const sys = useSystemStore();
const router = useRouter();

const persistedAlerts = ref<Alert[]>([]);
const activeCount = ref(0);

// 临时 WS 报警 (sys.alerts) 优先；否则展示持久化报警
const inMemoryAlert = computed(
  () =>
    sys.alerts.find((a) => a.level === 'error') ??
    sys.alerts.find((a) => a.level === 'warning') ??
    null,
);

const topPersistedAlert = computed<Alert | null>(() => {
  return (
    persistedAlerts.value.find((a) => a.level === 'emergency') ??
    persistedAlerts.value.find((a) => a.level === 'critical') ??
    persistedAlerts.value.find((a) => a.level === 'warning') ??
    persistedAlerts.value[0] ??
    null
  );
});

const showInMemory = computed(() => inMemoryAlert.value !== null);
const showPersisted = computed(() => !showInMemory.value && topPersistedAlert.value !== null);

const persistedLevelClass = computed(() => {
  const lv = topPersistedAlert.value?.level;
  if (lv === 'emergency' || lv === 'critical') return 'is-error';
  if (lv === 'warning') return 'is-warning';
  return 'is-info';
});

let unsubscribeWs: (() => void) | null = null;
let pollTimer: number | undefined;

async function refresh(): Promise<void> {
  try {
    const [list, summary] = await Promise.all([
      adminAlertService.list({ status: 'active', pageSize: 5 }),
      adminAlertService.summary(),
    ]);
    persistedAlerts.value = list.list;
    activeCount.value = summary.active;
  } catch {
    // 后台未起或路径无效, 不影响平板
  }
}

function handleWs(event: WsEvent): void {
  if (event.type === 'alert_created' || event.type === 'alert_resolved') {
    void refresh();
  }
}

onMounted(() => {
  void refresh();
  unsubscribeWs = wsClient.on(handleWs);
  pollTimer = window.setInterval(refresh, 30_000);
});

onBeforeUnmount(() => {
  if (unsubscribeWs) unsubscribeWs();
  if (pollTimer) window.clearInterval(pollTimer);
});

function dismiss(): void {
  sys.clearAlerts();
}

function gotoAlerts(): void {
  router.push({ name: 'status' });
}
</script>

<template>
  <transition name="banner">
    <!-- 临时 WS 报警 (优先级最高, 短时间显示) -->
    <div v-if="showInMemory" :class="['alert-banner', `is-${inMemoryAlert!.level}`]">
      <div class="alert-icon">{{ inMemoryAlert!.level === 'error' ? '✖' : '⚠' }}</div>
      <div class="alert-body">
        <div class="alert-source">{{ inMemoryAlert!.source }}</div>
        <div class="alert-msg">{{ inMemoryAlert!.message }}</div>
      </div>
      <div class="alert-count" v-if="sys.alerts.length > 1">+{{ sys.alerts.length - 1 }}</div>
      <button class="alert-close" @click="dismiss" aria-label="清除">×</button>
    </div>

    <!-- 持久化报警条 (一直显示直到处理) -->
    <div
      v-else-if="showPersisted"
      :class="['alert-banner', 'persisted', persistedLevelClass]"
      @click="gotoAlerts"
    >
      <div class="alert-icon">⚠</div>
      <div class="alert-body">
        <div class="alert-source">{{ topPersistedAlert!.sourceType }} · {{ topPersistedAlert!.sourceId ?? '系统' }}</div>
        <div class="alert-msg">{{ topPersistedAlert!.title }}</div>
      </div>
      <div class="alert-count" v-if="activeCount > 1">共 {{ activeCount }} 条 →</div>
      <div v-else class="alert-count">查看 →</div>
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
  background: rgba(239, 68, 68, 0.92);
  color: #fff;
  font-weight: 500;
}
.alert-banner.is-warning {
  background: rgba(245, 158, 11, 0.92);
  color: #1f2937;
}
.alert-banner.is-info {
  background: rgba(96, 165, 250, 0.92);
  color: #1f2937;
}
.alert-banner.persisted { cursor: pointer; }
.alert-banner.persisted:active { filter: brightness(0.92); }
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
