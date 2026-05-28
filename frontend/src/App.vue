<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useSceneStore } from '@/stores/scene';
import { useDeviceStore } from '@/stores/device';
import { useSystemStore } from '@/stores/system';
import { wsClient } from '@/services/websocket.service';

const sceneStore = useSceneStore();
const deviceStore = useDeviceStore();
const systemStore = useSystemStore();

let unsubscribeWs: (() => void) | null = null;
let pollTimer: number | undefined;

onMounted(async () => {
  systemStore.startClock();
  systemStore.startAlertTtlSweep();
  systemStore.bindWsState();

  try {
    await Promise.all([
      systemStore.fetchInfo(),
      sceneStore.fetchScenes(),
      deviceStore.refreshAll(),
      sceneStore.refreshRunning(),
    ]);
  } catch (err) {
    // 启动期任一接口失败不阻塞 UI
    // eslint-disable-next-line no-console
    console.warn('bootstrap fetch failed:', (err as Error).message);
  }

  unsubscribeWs = wsClient.on((event) => {
    sceneStore.handleWs(event);
    deviceStore.handleWs(event);
    systemStore.handleWs(event);
  });
  wsClient.connect();

  // 兜底轮询: 即使 WS 暂时断开也定期刷新一次
  pollTimer = window.setInterval(() => {
    void deviceStore.fetchRuntime();
    void deviceStore.fetchGateways();
    void sceneStore.refreshRunning();
  }, 20000);
});

onBeforeUnmount(() => {
  systemStore.stopClock();
  systemStore.stopAlertTtlSweep();
  if (pollTimer) window.clearInterval(pollTimer);
  if (unsubscribeWs) unsubscribeWs();
  wsClient.disconnect();
});
</script>

<template>
  <router-view />
</template>
