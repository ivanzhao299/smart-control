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
/* v2 玻璃风格: 半透明背景 + 暖色描边 + 内阴影 */
.alert-banner {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--v2-sp-3);
  padding: 10px 18px;
  margin: var(--v2-sp-3) var(--v2-sp-5) 0;
  border-radius: var(--v2-r-md);
  font-weight: 500;
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  background: rgba(239, 68, 68, 0.12);
  border: 1px solid rgba(239, 68, 68, 0.3);
  color: var(--v2-text-1);
  box-shadow: 0 8px 24px -10px rgba(239, 68, 68, 0.4);
}
.alert-banner.is-error {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.3);
}
.alert-banner.is-warning {
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.3);
  box-shadow: 0 8px 24px -10px rgba(245, 158, 11, 0.4);
}
.alert-banner.is-info {
  background: rgba(59, 130, 246, 0.12);
  border-color: rgba(59, 130, 246, 0.3);
  box-shadow: 0 8px 24px -10px rgba(59, 130, 246, 0.4);
}
.alert-banner.persisted { cursor: pointer; }
.alert-banner.persisted:hover {
  background: rgba(239, 68, 68, 0.18);
}
.alert-icon {
  width: 28px; height: 28px;
  border-radius: 50%;
  display: grid; place-items: center;
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
}
.alert-banner.is-error .alert-icon {
  background: rgba(239, 68, 68, 0.2);
  color: var(--v2-danger);
}
.alert-banner.is-warning .alert-icon {
  background: rgba(245, 158, 11, 0.2);
  color: var(--v2-warning);
}
.alert-banner.is-info .alert-icon {
  background: rgba(59, 130, 246, 0.2);
  color: var(--v2-info);
}
.alert-body { flex: 1; line-height: 1.3; min-width: 0; }
.alert-source {
  font-size: 11px;
  color: var(--v2-text-3);
  letter-spacing: 0.5px;
}
.alert-msg {
  font-size: 14px;
  color: var(--v2-text-1);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alert-count {
  font-size: 11px;
  padding: 4px 10px;
  background: var(--v2-surf-2);
  color: var(--v2-text-2);
  border-radius: 999px;
  flex-shrink: 0;
}
.alert-close {
  background: var(--v2-surf-2);
  border: none;
  color: var(--v2-text-2);
  font-size: 20px;
  cursor: pointer;
  width: 32px;
  height: 32px;
  border-radius: var(--v2-r-sm);
  transition: all 0.18s ease;
  flex-shrink: 0;
}
.alert-close:hover {
  background: var(--v2-surf-1-hover);
  color: var(--v2-text-1);
}
.banner-enter-from, .banner-leave-to { opacity: 0; transform: translateY(-10px); }
.banner-enter-active, .banner-leave-active { transition: all 0.22s ease; }
</style>
