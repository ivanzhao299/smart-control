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
import { isUploadActive } from '@/services/upload-keepalive';
import { installCrossTabIdentitySync } from '@/services/cross-tab-identity';
import PwaUpdateBanner from '@/components/PwaUpdateBanner.vue';

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

/** #28 冷启动首批清单失败补拉: scenes/devices 清单只在登录/启动时拉一次、本身无轮询,
 *  若该瞬间因弱网、429、超时或 token 竞争失败, 首页会永久空白(设备 0/0、场景卡空),
 *  只能手动刷新。用有限退避重试包首批清单; 仍失败由下方 app:bootstrap-backfill 轮询兜底。
 *  标记区分"从未成功"与"成功但为空"——真为空(合法)时不再补拉, 零多余请求。 */
const bootstrap = { scenesOk: false, devicesOk: false };
const bootstrapSleep = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));
async function bootstrapList(which: 'scenes' | 'devices', fn: () => Promise<unknown>, attempt = 0): Promise<void> {
  try {
    await fn();
    bootstrap[which === 'scenes' ? 'scenesOk' : 'devicesOk'] = true;
  } catch (e) {
    if (attempt >= 2) {
      console.warn(`[bootstrap] ${which} 首批拉取失败, 交由 backfill 补拉`, e);
      return;
    }
    await bootstrapSleep(900 * (attempt + 1)); // 0.9s, 1.8s
    await bootstrapList(which, fn, attempt + 1);
  }
}

/** 拉需要登录态的业务数据 (登录后 / 启动时已登录 / WS 重连时调). 公开数据 (系统信息/品牌)
 *  不在这里, 它们登录页也要、不需 token。 */
function fetchAuthedData(): void {
  void bootstrapList('scenes', () => sceneStore.fetchScenes());
  void bootstrapList('devices', () => deviceStore.fetchDevices());
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
  // 大文件上传进行中：并发非上传请求的 401（隧道忙/网络抖动）不立即踢，避免中断上传；
  // 上传请求自身 401 会先解除保活（计数清零）再触发本兜底。
  if (isUploadActive()) return;
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
  // #28 兜底: 已登录但清单"从未成功"时定期补拉; 成功(即使为空)即标记、停止补拉。
  // fixed: 这是冷启动失败的紧急自愈, 不随 WS 在线放大到 90s, 保持 15s 尽快补回。
  polling.subscribe('app:bootstrap-backfill', 15_000, async () => {
    if (!clientAuth.isAuthed) return;
    if (!bootstrap.scenesOk) {
      try { await sceneStore.fetchScenes(); bootstrap.scenesOk = true; } catch { /* 下轮再试 */ }
    }
    if (!bootstrap.devicesOk) {
      try { await deviceStore.fetchDevices(); bootstrap.devicesOk = true; } catch { /* 下轮再试 */ }
    }
  }, { fixed: true });

  // 登录态一旦变 true (登录成功 / 自动重登成功) → 立即补拉一次业务数据;
  // 变 false (登出/会话失效) → 复位首批标记, 为下次登录准备。
  watch(() => clientAuth.isAuthed, (authed) => {
    if (authed) fetchAuthedData();
    else { bootstrap.scenesOk = false; bootstrap.devicesOk = false; }
  });

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
  <PwaUpdateBanner />
</template>
