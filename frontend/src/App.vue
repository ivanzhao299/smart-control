<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch, ref } from 'vue';
import { identityGeneration, onIdentityChange } from '@/services/identity-boundary';
import { useRouter } from 'vue-router';
import { useSceneStore } from '@/stores/scene';
import { useDeviceStore } from '@/stores/device';
import { useSystemStore } from '@/stores/system';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { usePlaybackStore } from '@/stores/playback';
import { useClientAuthStore } from '@/stores/client-auth';
import { wsClient } from '@/services/websocket.service';
import { polling } from '@/services/polling.service';
import { markBootComplete } from '@/services/rum.service';
import { setUnauthorizedHandler, setClientToken, setAdminToken } from '@/services/http';
import { installCrossTabIdentitySync } from '@/services/cross-tab-identity';

const router = useRouter();
const sceneStore = useSceneStore();
const deviceStore = useDeviceStore();
const systemStore = useSystemStore();
const brandingStore = useSystemBrandingStore();
const playbackStore = usePlaybackStore();
const clientAuth = useClientAuthStore();
const unsubscribeCrossTab = installCrossTabIdentitySync(window, () => window.localStorage, () => {
  // Clear this tab only; never erase the other tab's freshly saved credentials.
  clientAuth.token = null;
  clientAuth.expiresAt = null;
  setClientToken(null);
  setAdminToken(null);
  try {
    sessionStorage.removeItem('sc.adminToken');
    sessionStorage.removeItem('sc.adminToken:exp');
    sessionStorage.removeItem('sc.adminAuthServer');
  } catch { /* Browser storage unavailable; in-memory credentials are already gone. */ }
}, () => window.location.reload());
const identityKey = ref(identityGeneration());
const unsubscribeIdentity = onIdentityChange(() => {
  playbackStore.clearIdentity();
  identityKey.value = identityGeneration();
});

let unsubscribeWs: (() => void) | null = null;
let unsubscribeWsState: (() => void) | null = null;
let wsWasOpen = false; // 区分首次连接 vs 重连, 只在重连时补对齐

/** 拉需要登录态的业务数据 (登录后 / 启动时已登录 / WS 重连时调). 公开数据 (系统信息/品牌)
 *  不在这里, 它们登录页也要、不需 token。 */
function fetchAuthedData(): void {
  void sceneStore.fetchScenes();
  void deviceStore.fetchDevices();
  void deviceStore.fetchRuntime();
  void deviceStore.fetchGateways();
  void sceneStore.refreshRunning();
  void playbackStore.load();
}

// 全局 401 兜底。签名 token 在部署/重启后仍有效；401 表示密码/签名密钥轮换、
// 账号停用或令牌本身失效，应清除会话并重新认证。
//   - 后台 /admin 路由 + kiosk /player: 各自处理, 不插手。
//   - 业主侧: markSessionExpired 清掉失效 token（isAuthed→false，业务轮询停止）并回登录页。
// 浏览器不保存明文密码；壳 App 的生物认证密码留在系统加密存储并由用户主动触发。
let reauthing = false;
setUnauthorizedHandler(() => {
  if (reauthing) return;
  const cur = router.currentRoute.value;
  if (cur.path.startsWith('/admin') || cur.path === '/player') return;
  reauthing = true;
  clientAuth.markSessionExpired();
  if (router.currentRoute.value.name !== 'client-login') {
    void router.push({ name: 'client-login', query: { redirect: cur.fullPath } });
  }
  window.setTimeout(() => { reauthing = false; }, 800);
});

onMounted(async () => {
  systemStore.startClock();
  systemStore.startAlertTtlSweep();
  systemStore.bindWsState();

  // 公开数据 (登录页也要, 走 @Public 端点): 系统信息 + 品牌 —— 不需 token
  void systemStore.fetchInfo();
  void brandingStore.load();
  // 业务数据 (scenes/devices/runtime/gateways/playback) 只在已登录时拉 ——
  // 未登录 (停在登录页) 时这些端点会 401, 不该打, 否则 401 风暴。登录后靠下面 watch 补拉。
  if (clientAuth.isAuthed) fetchAuthedData();

  // PERFORMANCE_AUDIT P3-#20: 首屏可用时刻
  markBootComplete();

  unsubscribeWs = wsClient.on((event) => {
    sceneStore.handleWs(event);
    deviceStore.handleWs(event);
    systemStore.handleWs(event);
    playbackStore.handleWs(event);
  });

  // WS 重连对齐 (2026-07-19 加固). 之前 WS 断线重连后, 全项目没有任何"重新拉一遍"
  // 的动作 —— 断线期间漏掉的事件永远补不回来, 而且 WS 连接快照根本不含 playback 通道,
  // 于是多个终端会无限期停在断线前的旧状态 (显示"播放中: 视频X", 大屏其实早换成 Y)。
  // 首次连接不用补 (onMounted 已 fetch); 只有重连 (wsWasOpen 已 true) 才 refetch 各 store。
  unsubscribeWsState = wsClient.onState((state) => {
    if (state !== 'open') return;
    if (wsWasOpen && clientAuth.isAuthed) fetchAuthedData(); // 重连补拉, 但要登录态
    wsWasOpen = true;
  });
  wsClient.connect();

  // PERFORMANCE_AUDIT P0-#3: 统一轮询调度器, 替代散落 setInterval
  // WS 在线时整体放大到 ≥30s, WS 断时回到 declared 间隔
  polling.start();
  // 轮询回调 gate 在登录态: 未登录不打业务接口, 避免停在登录页时的 401 风暴
  polling.subscribe('app:devices-runtime', 20_000, () => { if (clientAuth.isAuthed) void deviceStore.fetchRuntime(); });
  polling.subscribe('app:devices-gateways', 20_000, () => { if (clientAuth.isAuthed) void deviceStore.fetchGateways(); });
  polling.subscribe('app:scenes-running', 30_000, () => { if (clientAuth.isAuthed) void sceneStore.refreshRunning(); });

  // 登录态一旦变 true (登录成功 / 自动重登成功) → 立即补拉一次业务数据
  watch(() => clientAuth.isAuthed, (authed) => { if (authed) fetchAuthedData(); });

});

onBeforeUnmount(() => {
  unsubscribeCrossTab();
  unsubscribeIdentity();
  systemStore.stopClock();
  systemStore.stopAlertTtlSweep();
  polling.stop();
  if (unsubscribeWs) unsubscribeWs();
  if (unsubscribeWsState) unsubscribeWsState();
  wsClient.disconnect();
});
</script>

<template>
  <router-view :key="identityKey" />
</template>
