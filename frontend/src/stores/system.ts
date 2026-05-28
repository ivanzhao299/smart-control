import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { deviceService } from '@/services/device.service';
import { wsClient, type WsConnectionState } from '@/services/websocket.service';
import type { SystemInfo, WsEvent } from '@/types/api';

export interface AlertItem {
  id: string;
  source: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  at: string;
}

const MAX_ALERTS = 30;

export const useSystemStore = defineStore('system', () => {
  const info = ref<SystemInfo | null>(null);
  const wsState = ref<WsConnectionState>('closed');
  const alerts = ref<AlertItem[]>([]);
  const now = ref<string>(new Date().toISOString());
  const lastSceneAction = ref<string>('');

  let nowTimer: number | undefined;

  const isWsOnline = computed(() => wsState.value === 'open');
  const unreadAlertCount = computed(() => alerts.value.length);
  const latestAlert = computed<AlertItem | null>(() => alerts.value[0] ?? null);

  async function fetchInfo(): Promise<void> {
    info.value = await deviceService.systemInfo();
  }

  function pushAlert(item: Omit<AlertItem, 'id'>): void {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;
    alerts.value = [{ id, ...item }, ...alerts.value].slice(0, MAX_ALERTS);
  }

  function clearAlerts(): void {
    alerts.value = [];
  }

  function handleWs(event: WsEvent): void {
    if (event.type === 'alarm') {
      pushAlert({
        source: event.source,
        level: event.level,
        message: event.message,
        at: event.at,
      });
    } else if (event.type === 'device_status') {
      // 设备从故障状态恢复成 online → 把这个 source 的旧 alarm 全清掉
      // (back-end registry 改 IP 后会广播 online, 旧的 0.7 报警就该消失)
      if (event.status === 'online') {
        alerts.value = alerts.value.filter((a) => a.source !== event.device);
      }
    } else if (event.type === 'device_online') {
      // Sprint-08 health service 的 online 事件也按 source 清告警
      alerts.value = alerts.value.filter((a) => a.source !== event.device);
    } else if (event.type === 'scene' && event.status === 'action' && event.step) {
      lastSceneAction.value = event.step;
    }
  }

  // 10 分钟过期的告警自动清掉, 避免老告警一直挂屏幕
  const ALERT_TTL_MS = 10 * 60 * 1000;
  let ttlTimer: number | undefined;
  function startAlertTtlSweep(): void {
    if (ttlTimer) return;
    ttlTimer = window.setInterval(() => {
      const now = Date.now();
      const before = alerts.value.length;
      alerts.value = alerts.value.filter((a) => {
        const at = a.at ? Date.parse(a.at) : now;
        return now - at < ALERT_TTL_MS;
      });
      if (alerts.value.length < before) {
        // 静默清, 不打 toast
      }
    }, 30_000);
  }
  function stopAlertTtlSweep(): void {
    if (ttlTimer) {
      window.clearInterval(ttlTimer);
      ttlTimer = undefined;
    }
  }

  function startClock(): void {
    if (nowTimer) return;
    nowTimer = window.setInterval(() => {
      now.value = new Date().toISOString();
    }, 1000);
  }

  function stopClock(): void {
    if (nowTimer) {
      window.clearInterval(nowTimer);
      nowTimer = undefined;
    }
  }

  function bindWsState(): void {
    wsClient.onState((s) => {
      wsState.value = s;
    });
  }

  return {
    info,
    wsState,
    alerts,
    now,
    lastSceneAction,
    isWsOnline,
    unreadAlertCount,
    latestAlert,
    fetchInfo,
    pushAlert,
    clearAlerts,
    handleWs,
    startClock,
    stopClock,
    startAlertTtlSweep,
    stopAlertTtlSweep,
    bindWsState,
  };
});
