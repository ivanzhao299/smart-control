<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import { useSceneStore } from '@/stores/scene';
import { useDeviceStore } from '@/stores/device';
import { useSystemStore } from '@/stores/system';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { usePlaybackStore } from '@/stores/playback';
import { wsClient } from '@/services/websocket.service';
import { polling } from '@/services/polling.service';
import { markBootComplete } from '@/services/rum.service';

const sceneStore = useSceneStore();
const deviceStore = useDeviceStore();
const systemStore = useSystemStore();
const brandingStore = useSystemBrandingStore();
const playbackStore = usePlaybackStore();

let unsubscribeWs: (() => void) | null = null;

onMounted(async () => {
  systemStore.startClock();
  systemStore.startAlertTtlSweep();
  systemStore.bindWsState();

  // PERFORMANCE_AUDIT P0-#2:
  // 启动期 fetch 拆关键路径 (await) + 非关键 (fire-and-forget):
  //   关键 = system info + devices 列表 + scenes 元数据 → 影响 Dashboard 首屏
  //   非关键 = runtime gateways + running scenes → 显示在后台/状态页, 不必同步等
  try {
    await Promise.all([
      systemStore.fetchInfo(),
      sceneStore.fetchScenes(),
      deviceStore.fetchDevices(),
      brandingStore.load(),
    ]);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('bootstrap critical fetch failed:', (err as Error).message);
  }
  // 非关键: fire-and-forget, 不阻塞首屏渲染
  void deviceStore.fetchRuntime();
  void deviceStore.fetchGateways();
  void sceneStore.refreshRunning();
  void playbackStore.load();  // 播控通道初始状态, 不卡首屏

  // PERFORMANCE_AUDIT P3-#20: 首屏可用时刻
  markBootComplete();

  unsubscribeWs = wsClient.on((event) => {
    sceneStore.handleWs(event);
    deviceStore.handleWs(event);
    systemStore.handleWs(event);
    playbackStore.handleWs(event);
  });
  wsClient.connect();

  // PERFORMANCE_AUDIT P0-#3: 统一轮询调度器, 替代散落 setInterval
  // WS 在线时整体放大到 ≥30s, WS 断时回到 declared 间隔
  polling.start();
  polling.subscribe('app:devices-runtime', 20_000, () => deviceStore.fetchRuntime());
  polling.subscribe('app:devices-gateways', 20_000, () => deviceStore.fetchGateways());
  polling.subscribe('app:scenes-running', 30_000, () => sceneStore.refreshRunning());

  // PERFORMANCE_AUDIT P1-#8: idle 时预取所有主菜单 chunk, 切页瞬开
  const ric =
    (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ??
    ((cb: () => void) => window.setTimeout(cb, 1500));
  ric(() => {
    void import('@/pages/LightingPage.vue');
    void import('@/pages/LedPage.vue');
    void import('@/pages/AudioPage.vue');
    void import('@/pages/HvacPage.vue');
    void import('@/pages/MediaPage.vue');
    void import('@/pages/StatusPage.vue');
  });
});

onBeforeUnmount(() => {
  systemStore.stopClock();
  systemStore.stopAlertTtlSweep();
  polling.stop();
  if (unsubscribeWs) unsubscribeWs();
  wsClient.disconnect();
});
</script>

<template>
  <router-view />
</template>
