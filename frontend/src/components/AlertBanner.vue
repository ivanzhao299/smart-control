<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSystemStore } from '@/stores/system';
import { adminAlertService } from '@/services/admin.service';
import type { Alert, WsEvent } from '@/types/api';
import { wsClient } from '@/services/websocket.service';
import { polling } from '@/services/polling.service';

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
let unsubscribePoll: (() => void) | null = null;

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
  // PERFORMANCE_AUDIT P0-#3: 走统一 polling
  unsubscribePoll = polling.subscribe('alert:refresh', 30_000, refresh);
});

onBeforeUnmount(() => {
  if (unsubscribeWs) unsubscribeWs();
  if (unsubscribePoll) unsubscribePoll();
});

function dismiss(): void {
  sys.clearAlerts();
}

function gotoAlerts(): void {
  router.push({ name: 'status' });
}

/**
 * 持久化报警的 "×" — 把这个 source 下所有 active 报警一次性清掉.
 * 适合用户判断报警已不需要 (设备拆了 / 误报) 的场景. stopPropagation 防触发
 * 跳转到 status 页. 注意: 如果设备真的还离线, probe 还会重新生成新 alert.
 * 真要静音: 在 backend env 配 LED_PROBE_DISABLED=1 之类 (具体 key 见
 * device-health.service GATEWAY_META).
 */
async function dismissPersisted(ev: MouseEvent): Promise<void> {
  ev.stopPropagation();
  const a = topPersistedAlert.value;
  if (!a) return;
  try {
    const r = await adminAlertService.resolveBySource(a.sourceType, a.sourceId ?? null, 'admin');
    persistedAlerts.value = persistedAlerts.value.filter(
      (x) => !(x.sourceType === a.sourceType && x.sourceId === a.sourceId),
    );
    activeCount.value = Math.max(0, activeCount.value - (r?.count ?? 1));
  } catch {
    void refresh();
  }
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
      <button class="alert-close" @click="dismissPersisted" aria-label="清除此来源所有报警" title="清除此来源所有报警 (设备真离线下次探活会再报)">×</button>
    </div>
  </transition>
</template>

<style scoped>
/* v3 告警条 — 红色渐变 + 边框 glow + 慢脉动 + 流光扫描 */
.alert-banner {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--v2-sp-2);
  padding: 5px 10px 5px 6px;
  border-radius: var(--v2-r-sm);
  font-weight: 500;
  background: linear-gradient(90deg, rgba(229, 100, 93, 0.22) 0%, rgba(229, 100, 93, 0.10) 100%);
  border: 1px solid rgba(229, 100, 93, 0.55);
  color: var(--v2-text-1);
  overflow: hidden;
  height: 34px;
  box-sizing: border-box;
  box-shadow:
    0 0 16px -2px rgba(229, 100, 93, 0.4),
    inset 0 1px 0 rgba(229, 100, 93, 0.55);
  animation: v3-alert-pulse 2.4s ease-in-out infinite;
}
/* 流光扫描条 — 从左到右每 3 秒扫一次, 像故障告警光带 */
.alert-banner::before {
  content: '';
  position: absolute;
  top: 0; bottom: 0; left: -40%;
  width: 30%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.18), transparent);
  animation: v3-alert-sweep 3s linear infinite;
  pointer-events: none;
}
@keyframes v3-alert-pulse {
  0%, 100% { box-shadow: 0 0 16px -2px rgba(229, 100, 93, 0.4), inset 0 1px 0 rgba(229, 100, 93, 0.55); }
  50% { box-shadow: 0 0 28px -2px rgba(229, 100, 93, 0.7), inset 0 1px 0 rgba(229, 100, 93, 0.8); }
}
@keyframes v3-alert-sweep {
  0% { left: -40%; }
  100% { left: 110%; }
}

.alert-banner.is-error {
  background: linear-gradient(90deg, rgba(229, 100, 93, 0.22) 0%, rgba(229, 100, 93, 0.10) 100%);
  border-color: rgba(229, 100, 93, 0.55);
}
.alert-banner.is-warning {
  background: linear-gradient(90deg, rgba(224, 160, 48, 0.22) 0%, rgba(224, 160, 48, 0.10) 100%);
  border-color: rgba(224, 160, 48, 0.55);
  box-shadow:
    0 0 16px -2px rgba(224, 160, 48, 0.4),
    inset 0 1px 0 rgba(224, 160, 48, 0.55);
  animation: v3-alert-pulse-amber 2.4s ease-in-out infinite;
}
@keyframes v3-alert-pulse-amber {
  0%, 100% { box-shadow: 0 0 16px -2px rgba(224, 160, 48, 0.4), inset 0 1px 0 rgba(224, 160, 48, 0.55); }
  50% { box-shadow: 0 0 28px -2px rgba(224, 160, 48, 0.7), inset 0 1px 0 rgba(224, 160, 48, 0.8); }
}
.alert-banner.is-info {
  background: linear-gradient(90deg, rgba(76, 154, 255, 0.22) 0%, rgba(76, 154, 255, 0.10) 100%);
  border-color: rgba(76, 154, 255, 0.55);
  box-shadow: 0 0 14px -2px rgba(76, 154, 255, 0.35);
  animation: none;
}
.alert-banner.persisted { cursor: pointer; }
.alert-banner.persisted:hover { filter: brightness(1.2); }

.alert-icon {
  width: 22px; height: 22px;
  border-radius: 4px;
  display: grid; place-items: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}
.alert-banner.is-error .alert-icon {
  background: rgba(229, 100, 93, 0.35);
  color: #FFB4B4;
  filter: drop-shadow(0 0 6px rgba(229, 100, 93, 0.7));
}
.alert-banner.is-warning .alert-icon {
  background: rgba(224, 160, 48, 0.35);
  color: #FFE082;
  filter: drop-shadow(0 0 6px rgba(224, 160, 48, 0.7));
}
.alert-banner.is-info .alert-icon {
  background: rgba(76, 154, 255, 0.35);
  color: #BFD7FF;
  filter: drop-shadow(0 0 6px rgba(76, 154, 255, 0.5));
}

.alert-body {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}
.alert-source {
  font-size: 11px;
  color: var(--v2-text-3);
  letter-spacing: 0.3px;
  flex-shrink: 0;
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.alert-source::after {
  content: '·';
  margin-left: 6px;
  color: var(--v2-text-3);
}
.alert-msg {
  font-size: 12px;
  color: var(--v2-text-1);
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}

.alert-count {
  font-size: 10px;
  padding: 2px 8px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--v2-text-2);
  border-radius: 999px;
  flex-shrink: 0;
  letter-spacing: 0.5px;
}
.alert-close {
  background: transparent;
  border: none;
  color: var(--v2-text-2);
  font-size: 16px;
  cursor: pointer;
  width: 22px;
  height: 22px;
  border-radius: 4px;
  transition: all 0.18s ease;
  flex-shrink: 0;
  display: grid;
  place-items: center;
  line-height: 1;
  padding: 0;
}
.alert-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: var(--v2-text-1);
}

.banner-enter-from, .banner-leave-to { opacity: 0; transform: scale(0.96); }
.banner-enter-active, .banner-leave-active { transition: all 0.18s ease; }
</style>
