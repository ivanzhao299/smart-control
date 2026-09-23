<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch , nextTick } from 'vue';
import { useRoute } from 'vue-router';
import { useActivePolling } from '@/composables/useActivePolling';
import { WsClient, type WsConnectionState } from '@/services/websocket.service';
import { getPlayerState, playerHeartbeat, playerAdvance, configurePlayer, hasPlayerCredential, playerSocketAuthentication, type PlayerDeviceState } from '@/services/player-device.service';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { absUrl, api, setApiBaseURL } from '@/services/http';
import { webpageSandbox } from '@/services/webpage-sandbox';
import { forceThemeWithoutPersist, restoreStoredTheme } from '@/services/theme.service';
import type { WsEvent } from '@/types/api';

/**
 * PlayerPage — GK9000 上的 Chromium kiosk 全屏播放器.
 *
 * 启动: 两个浏览器实例分别加载 ?slot=1 (HDMI1 → V2460 → LED) 和 ?slot=2
 *   (HDMI2 → 投影仪). 由 scripts/start-players.ps1 boot 时拉起.
 *
 * 行为:
 *   1) onMounted 拉当前 channel state (REST), 拿到 currentMediaUrl 渲染.
 *   2) WS 收到 playback_channel_changed{slot=N} 就切素材, 零延迟.
 *   3) 视频播完默认回待机 (loopMode='once') 或循环 (loopMode='loop').
 *   4) 每 30s 调 /api/playback/channels/:slot/heartbeat, backend 知道 kiosk 活着.
 *   5) 待机画面 = 居中显示 logo + 系统名 (来自 system-branding).
 *
 * 设备凭据与用户账户分离；状态轮询失败清空私人播放内容。
 */

const route = useRoute();
const brandingStore = useSystemBrandingStore();

const slot = computed<number>(() => {
  const q = Array.isArray(route.query.slot) ? route.query.slot[0] : route.query.slot;
  const n = Number(q);
  return Number.isFinite(n) && (n === 1 || n === 2 || n === 3) ? n : 1;
});

const channel = ref<PlayerDeviceState | null>(null);
const currentWebpageSandbox = computed(() => webpageSandbox(
  channel.value?.currentMediaUrl,
  window.location.href,
));
// Separate connection/identity from the control app's personal-account socket.
const playerWs = new WsClient({ authentication: () => playerSocketAuthentication(slot.value) });
const credential = ref('');
const rememberDevice = ref(false);
const needsCredential = ref(false);
let requestRevision = 0;
async function saveCredential(): Promise<void> {
  try {
    configurePlayer(slot.value, credential.value, rememberDevice.value);
    credential.value = '';
    needsCredential.value = false;
    playerWs.reconnect();
    await fetchChannel();
  } catch (e) { errorMsg.value = (e as Error).message; }
}
const errorMsg = ref<string>('');
let unsubscribeWs: (() => void) | null = null;
let unsubscribeWsState: (() => void) | null = null;
let heartbeatTimer: number | undefined;
let disconnectedReconcileTimer: number | undefined;
let playerWsState: WsConnectionState = 'closed';
let channelRequest: Promise<void> | null = null;
let channelRefreshQueued = false;
// keep-alive 生命周期: start/stop 幂等配对, 切走(deactivated)即停后台任务, 回页重建
let started = false;
let fullscreenCheckTimer: number | undefined;
let userInteractionHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;
let resizeHandler: (() => void) | null = null;

async function fetchChannel(): Promise<void> {
  // WS 重连与兜底轮询可能同时触发。同一时刻只执行一次读取，但不能直接
  // 丢弃在途期间到达的播放变更，否则较早的 idle 响应会覆盖最新推送并让屏幕
  // 保持待机直到下一轮 30 秒轮询。记下一次补读，当前请求完成后立刻收敛到最新状态。
  if (channelRequest) {
    channelRefreshQueued = true;
    await channelRequest;
    return;
  }
  do {
    channelRefreshQueued = false;
    const current = fetchChannelOnce();
    channelRequest = current;
    try { await current; } finally {
      if (channelRequest === current) channelRequest = null;
    }
  } while (channelRefreshQueued);
}

async function fetchChannelOnce(): Promise<void> {
  const revision = ++requestRevision;
  try {
    const state = await getPlayerState(slot.value);
    if (revision !== requestRevision) return;
    channel.value = state;
    needsCredential.value = false;
    errorMsg.value = '';
  } catch (e) {
    if (revision !== requestRevision) return;
    channel.value = null;
    errorMsg.value = (e as Error).message || '拉取通道失败';
    needsCredential.value = true;
  }
}

function handleWs(event: WsEvent): void {
  if (event.type === 'playback_channel_changed' && event.slot === slot.value) {
    void fetchChannel();
  }
}

async function sendHeartbeat(): Promise<void> {
  try { await playerHeartbeat(slot.value); } catch { /* state request clears playback on failure */ }
}

/**
 * 全屏保障 (2026-09-11): 立即请求一次 + 每 5s 检测补请求 + 用户交互/可见性/resize 兜底。
 * 提升为可配对的 start/stop —— keep-alive 切走时必须停掉定时器与 document/window 监听,
 * 否则页面被缓存后这些回调在后台永续运行 (每 5s 抢全屏 + 全局 click/keydown 监听), 拖卡整机。
 */
function startFullscreenGuard(): void {
  async function ensureFullscreen(): Promise<void> {
    try {
      const el = document.documentElement;
      if (el.requestFullscreen && !document.fullscreenElement) {
        await el.requestFullscreen().catch(() => { /* 无用户交互会被拒, 下次再试 */ });
      }
    } catch { /* ignore */ }
  }
  void ensureFullscreen();
  fullscreenCheckTimer = window.setInterval(() => { void ensureFullscreen(); }, 5000);
  userInteractionHandler = () => { void ensureFullscreen(); };
  visibilityHandler = () => { if (document.visibilityState === 'visible') void ensureFullscreen(); };
  resizeHandler = () => { void ensureFullscreen(); };
  document.addEventListener('click', userInteractionHandler);
  document.addEventListener('keydown', userInteractionHandler);
  document.addEventListener('visibilitychange', visibilityHandler);
  window.addEventListener('resize', resizeHandler);
}
function stopFullscreenGuard(): void {
  if (fullscreenCheckTimer !== undefined) { clearInterval(fullscreenCheckTimer); fullscreenCheckTimer = undefined; }
  if (userInteractionHandler) { document.removeEventListener('click', userInteractionHandler); userInteractionHandler = null; }
  if (visibilityHandler) { document.removeEventListener('visibilitychange', visibilityHandler); visibilityHandler = null; }
  if (resizeHandler) { window.removeEventListener('resize', resizeHandler); resizeHandler = null; }
}

/** 进入页面(首次 mount / 从 keep-alive 缓存激活)时启动; 幂等, mounted+activated 双触发只初始化一次。 */
async function startPlayer(): Promise<void> {
  if (started) return;
  started = true;

  // 大屏永远深色: 展厅是暗环境, 业主就算把控制端切成浅色, 大屏也不该刷一块白。
  // 不落盘, 不污染业主自己选的主题。
  forceThemeWithoutPersist('dark');

  // kiosk 始终在本机运行: 强制 API 指向本机后端, 防止 localStorage 残留旧 IP 导致超时
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    setApiBaseURL('http://localhost:3200');
  }

  needsCredential.value = !hasPlayerCredential(slot.value);
  await brandingStore.load().catch(() => { /* branding failure must not prevent device initialization */ });
  await fetchChannel();

  unsubscribeWs = playerWs.on(handleWs);
  // Also closes the startup/reconnect gap: events missed while offline are
  // reconciled immediately after authenticated hello, not 30 seconds later.
  unsubscribeWsState = playerWs.onState(state => {
    playerWsState = state;
    if (state === 'open') void fetchChannel();
  });
  playerWs.connect();

  // 立刻一次心跳, 然后每 30s 一次。顺带每轮 fetchChannel 兜底 (WS 断线时唯一兜底通道)。
  void sendHeartbeat();
  heartbeatTimer = window.setInterval(() => { void sendHeartbeat(); void fetchChannel(); }, 30_000);
  // 断线期间 2s 轻量状态对账, 把断线切换上限压到 2s; WS 正常时只判断不发请求。
  disconnectedReconcileTimer = window.setInterval(() => {
    if (playerWsState !== 'open') void fetchChannel();
  }, 2_000);

  // HDMI 音频路由重试: 只有 slot1/2 (视频) 需要, routeVideoAudio 内部已检查 slot,
  // 成功后会自清。5s 一次, 便宜且无副作用。
  audioRouteRetryTimer = window.setInterval(() => void routeVideoAudio(), 5_000);

  startFullscreenGuard();
}

/** 切走(deactivated)/销毁前停止全部后台任务: 定时器、WS、全局监听, 并恢复业主主题。 */
function stopPlayer(): void {
  if (!started) return;
  started = false;
  ++requestRevision;
  channel.value = null;
  if (heartbeatTimer !== undefined) { clearInterval(heartbeatTimer); heartbeatTimer = undefined; }
  if (disconnectedReconcileTimer !== undefined) { clearInterval(disconnectedReconcileTimer); disconnectedReconcileTimer = undefined; }
  if (audioRouteRetryTimer !== undefined) { clearInterval(audioRouteRetryTimer); audioRouteRetryTimer = undefined; }
  if (unsubscribeWs) { unsubscribeWs(); unsubscribeWs = null; }
  if (unsubscribeWsState) { unsubscribeWsState(); unsubscribeWsState = null; }
  playerWs.disconnect();
  stopFullscreenGuard();
  restoreStoredTheme(); // 离开大屏页(含切走缓存), 回到业主自己选的主题
}

// keep-alive 生命周期配对: 进入启动 / 切走或被挤出缓存时停止, 杜绝后台定时器+WS+监听空跑拖卡切换
useActivePolling(() => { void startPlayer(); }, stopPlayer);

onBeforeUnmount(() => {
  stopPlayer();
});

// 视频元素引用 — 用来在 ended 时根据 loopMode 决定循环或回待机
const videoEl = ref<HTMLVideoElement | null>(null);

/**
 * 把视频声音送到 HDMI 音频端点 (slot 1/2), 而不是 Windows 默认设备.
 *
 * 现场接线 (2026-07-16 机柜标签):
 *   GK9000 HDMI ──> 分离器 ──┬─> 视频 ──> 诺瓦 ──> LED 大屏
 *                            └─> 音频 ──> 矩阵 IN4 ──> OUT5 ──> 大屏功放
 *   GK9000 USB 声卡 3.5mm ─────────────> 矩阵 IN1 ──> OUT1/2/3/4/7/8 (各区)
 *
 * 但 Windows 默认播放设备是那块 USB 声卡, 所以视频声音全跑去了 IN1, 而 OUT5
 * 只吃 IN2/IN3/IN4 —— 大屏永远没声。2026-07-16 实测坐实: 放视频时 IN4 电平
 * 纹丝不动 (-66dB 噪声底), 跳动的是 IN1 上的背景音乐。
 *
 * 不能改 Windows 默认设备: 背景音乐 (bgm-player.ps1, 无窗口 MCI) 只会走默认
 * 设备, 把默认改成 HDMI 会让各区丢掉 BGM。所以只把**播放器这一路**用
 * setSinkId 指到 HDMI, 两条路各走各的 —— 这正是接 HDMI 音频分离器的本意。
 *
 * 拿设备标签需要麦克风权限, 由 start-players.ps1 的
 * --use-fake-ui-for-media-stream 自动放行 (它只自动同意授权, 用的仍是真设备)。
 *
 * 2026-07-18 现场复现两次"大屏没声音", 矩阵/功放机都是好的, 根子在这个函数:
 * 只在 @loadedmetadata 时试一次, 没找到 HDMI 设备或 setSinkId 抛错就永久放弃 ——
 * loop 模式下同一个视频反复播放不会重新触发 loadedmetadata (onVideoEnded 只是
 * currentTime=0 再 play, 不叫 .load()), 所以一旦某次没试成功, 只能等下一次真的
 * 换素材, 或者整个浏览器窗口重启 (这个页面在 GK9000 的 session 2 里, SSH 摸不到,
 * 只能物理重启整机, 代价很大)。改成失败了就每隔几秒自己重试, 不用再赌"下一次
 * 会不会自己好"。
 *
 * 2026-07-18 晚间二次复现, 且是稳定可复现的: "重启后第一段视频有声音, PWA 一
 * 切换播放内容就没声音" —— 根子是上面那版重试逻辑用一个全局 audioRouted 标志
 * 一劳永逸地"指过一次就不再指". <video> 元素在切换素材时是**同一个 DOM 节点**
 * (currentMediaUrl 变化只是改 src 再调 .load(), 没有重新挂载), 但 .load() 会把
 * 元素内部状态(含 sinkId 的输出路由)冲回默认设备 —— 第一段视频指过一次之后,
 * audioRouted 永远是 true, 后面每次 .load() 触发的 loadedmetadata 都被这一行
 * 直接挡掉, 新素材静静地退回 USB 声卡, 大屏再次没声音。
 * 改法: HDMI 设备 id 只需要解析一次并缓存 (标签不会变), 但 setSinkId 本身**每次
 * loadedmetadata 都要重新指一遍**, 不能用"成功过一次"当挡箭牌。
 */
let cachedHdmiDeviceId: string | null = null;
let audioRouteRetryTimer: number | undefined;
async function resolveHdmiDeviceId(): Promise<string | null> {
  if (cachedHdmiDeviceId) return cachedHdmiDeviceId;
  try {
    // 先取一次权限, 否则 enumerateDevices 拿不到 label, 认不出哪个是 HDMI
    await navigator.mediaDevices.getUserMedia({ audio: true })
      .then((s) => s.getTracks().forEach((t) => t.stop()))
      .catch(() => { /* 没授权也继续试, 有的环境本来就给 label */ });
    const outs = (await navigator.mediaDevices.enumerateDevices())
      .filter((d) => d.kind === 'audiooutput');
    // slot1(LED) 与 slot2(投影) 是两个独立浏览器窗口, 但共用这段代码。必须按 slot
    // 各自指到**不同**的显示音频端点, 否则两路声音会挤到同一个端点、从同一个分区出来。
    // 关键: 端点名字会随接线/EDID 变。现场见过两代命名 (2026-07-23 实测):
    //   LED  端点: "HDMI1.3"      后被现场手工重命名为 "LED_PLAYER_*"
    //   投影 端点: "lontium semi" (融合器直连) 或 "HDMI2.0" (中间加了 HDMI 音频分离器)
    // 所以不能只靠 /HDMI/ 正则 (它认不出 "LED_PLAYER_*", 会让 slot1 退而抓到投影的
    // "HDMI2.0" -> 两路撞一起串音)。改成按**稳定语义锚点**分路:
    //   - LED  专属端点被命名成 LED_PLAYER_*, 用 /LED[_ ]?PLAYER/ 认;
    //   - 投影 是 HDMI2 / 融合器(lontium) 那个显示端点, 且明确排除 LED。
    // 兜底都保证 "不是对方那个端点", 认不出就返回 null (留默认设备, 不污染对方分区)。
    // 2026-07-23 关键订正: 两个分离器都正常时, Windows 里就有两个活动显示音频端点,
    // 一个 LED、一个投影。现场实测活动端点 = "LED_PLAYER_ST"(LED, 已确认) +
    // "HDMI1.3"。**"HDMI1.3" 其实是投影(HDMI2)那口** —— Intel 驱动按自己的口序命名,
    // 名字里的 "1" 不代表物理 HDMI1。之前 slot2 兜底写了 !/HDMI1/ 想排除 LED 的旧名,
    // 结果把投影这个真端点也排除了 -> 投影声音退回 USB 声卡。这就是那个"程序问题"。
    // 订正: 投影 = "**不是 LED 的那个显示音频端点**"(不管它叫 HDMI1.3 / HDMI2.0 /
    // lontium), 不再按 HDMI 口序号排除。
    const isLed = (l: string) => /LED[_ ]?PLAYER|NOVA/i.test(l);
    const isDisplayAudio = (l: string) => /HDMI|显示器音频|Display Audio|lontium/i.test(l);
    const pick = slot.value === 1
      // LED: 优先专属命名端点 LED_PLAYER_*; 兜底取任意显示端点(单 LED 场景)。
      ? (outs.find((d) => isLed(d.label))
          ?? outs.find((d) => isDisplayAudio(d.label)))
      // 投影: 取一个"不是 LED"的显示音频端点(HDMI1.3 / HDMI2.0 / lontium 都算)。
      : outs.find((d) => isDisplayAudio(d.label) && !isLed(d.label));
    if (pick) cachedHdmiDeviceId = pick.deviceId;
    // 临时调试 (2026-07-24): 上报浏览器实际枚举到的设备标签 + 本 slot 挑中的那个,
    // 落进后端日志 (winston app-*.log), 定位投影(slot2) setSinkId 指哪。定位完删。
    // ⚠️ 必须走 http.ts 的 api (带 baseURL) —— 之前用相对路径 fetch('/api/..') 打到
    // 5173 (vite preview 无代理) 404 被静默吞掉, 后端从没收到过上报。
    void api.post('/playback/audio-debug', {
      slot: slot.value,
      labels: outs.map((d) => d.label),
      picked: pick?.label ?? null,
    }).catch(() => { /* 调试用, 失败无所谓 */ });
  } catch { /* 这次没解析出来, 等下一轮重试 */ }
  return cachedHdmiDeviceId;
}
// ============ 文档投屏 (2026-07-25): Word=PDF 逐页渲染; PPT 由 PowerPoint 原生放映
// (放映窗口盖在本页之上, 这里只留占位)。翻页: channel.docPage 经 WS 实时到达。 ============
const docCanvas = ref<HTMLCanvasElement | null>(null);
// 上移: 下方 renderDocPage 与 watch(320) 在 setup 期就引用 isDoc, 必须先声明, 否则 TDZ 报错
const isDoc = computed(() => channel.value?.currentMediaKind === 'doc');
let docPdf: { numPages: number; getPage: (n: number) => Promise<unknown> } | null = null;
let docPdfUrl = '';
let docRenderSeq = 0;
async function renderDocPage(): Promise<void> {
  const url = channel.value?.currentMediaUrl;
  if (!isDoc.value || !url || !docCanvas.value) return;
  const seq = ++docRenderSeq;
  try {
    const pdfjs = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const full = absUrl(url);
    if (!docPdf || docPdfUrl !== full) {
      docPdf = await pdfjs.getDocument(full).promise as never;
      docPdfUrl = full;
    }
    if (seq !== docRenderSeq || !docPdf) return; // 已被更新的渲染取代
    const pageNo = Math.max(1, Math.min(channel.value?.docPage ?? 1, docPdf.numPages));
    const page = await docPdf.getPage(pageNo) as never as {
      getViewport: (o: { scale: number }) => { width: number; height: number };
      render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
    };
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(window.innerWidth / vp1.width, window.innerHeight / vp1.height);
    const vp = page.getViewport({ scale });
    const canvas = docCanvas.value;
    canvas.width = vp.width; canvas.height = vp.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
  } catch { /* 渲染失败留黑屏, 下一次 docPage/URL 变化重试 */ }
}
watch(() => [channel.value?.currentMediaUrl, channel.value?.docPage, isDoc.value], () => {
  void nextTick(() => { void renderDocPage(); });
});

async function routeVideoAudio(): Promise<void> {
  if (slot.value !== 1 && slot.value !== 2) return;  // slot3 是 BGM, 必须留在默认设备
  // 2026-07-24: 不只 <video> —— slot1/2 也能推**音频文件**(业主: "播放器都应该支持
  // 播放音频文件"), <audio> 的声音同样必须 setSinkId 到本 slot 的显示音频端点,
  // 否则掉进默认设备(USB 声卡) → 从 BGM 通道出来, 大屏/投影分区没声。
  // 取当前活跃的媒体元素: 视频在放取 video, 音频在放取 audio (v-if 互斥, 只会有一个)。
  const el = (videoEl.value ?? audioEl.value) as (HTMLMediaElement & { setSinkId?: (id: string) => Promise<void> }) | null;
  if (!el?.setSinkId) return;                    // 浏览器不支持就算了, 至少声音还在默认设备
  const hdmiId = await resolveHdmiDeviceId();
  if (!hdmiId) return;                           // 这次没找到, 等下一轮定时重试
  try {
    // 每次 loadedmetadata 都要重新指: .load() 会把上次指过的 sinkId 冲回默认设备
    await el.setSinkId(hdmiId);
    if (audioRouteRetryTimer !== undefined) { window.clearInterval(audioRouteRetryTimer); audioRouteRetryTimer = undefined; }
  } catch { /* 这次没指上, 等下一轮定时重试, 不能因此让视频不播 */ }
}
watch(() => channel.value?.currentMediaUrl, (url, oldUrl) => {
  // url 变了就强制 reload <video>, 防止浏览器缓存上一段
  if (url !== oldUrl && videoEl.value) {
    videoEl.value.load();
    void videoEl.value.play().catch(() => { /* 用户没交互可能被拒 */ });
  }
});

/**
 * 控制台的暂停按钮之前只改了 channel.paused 这个数据库字段, 从没接到这个
 * <video> 元素本身 —— 业主点暂停, 大屏画面照样在走, 按钮形同虚设。
 * 2026-07-18 业主: "加一个暂停键, 确保可以随时暂停定格画面"。
 */
watch(() => channel.value?.paused, (paused) => {
  if (!videoEl.value || !channel.value?.currentMediaId) return;
  if (paused) videoEl.value.pause();
  else void videoEl.value.play().catch(() => { /* 用户没交互可能被拒 */ });
});

function onVideoEnded(): void {
  if (channel.value?.loopMode === 'loop' && videoEl.value) {
    videoEl.value.currentTime = 0;
    void videoEl.value.play();
  }
  // 'once' 模式: 视频自然停在最后一帧, 不主动回 idle, 等下一次 publish / stop
}

const isVideo = computed<boolean>(() => channel.value?.currentMediaKind === 'video');
const isImage = computed<boolean>(() => channel.value?.currentMediaKind === 'image');
const isAudio = computed<boolean>(() => channel.value?.currentMediaKind === 'audio');
const isWebpage = computed<boolean>(() => channel.value?.currentMediaKind === 'webpage');
const isIdle = computed<boolean>(() => !channel.value?.currentMediaUrl);

// 音频元素 — slot=3 (背景音乐 → GK9000 声卡 → EKX). 不静音!
// 注意: Chromium kiosk 需 --autoplay-policy=no-user-gesture-required 才能自动出声,
// 见 scripts/start-players.ps1 的 slot=3 启动参数.
const audioEl = ref<HTMLAudioElement | null>(null);
watch(() => channel.value?.currentMediaUrl, (url, oldUrl) => {
  if (url !== oldUrl && audioEl.value) {
    audioEl.value.load();
    void audioEl.value.play().catch(() => { /* 自动播放被拦, 靠 kiosk flag 兜 */ });
  }
});
function onAudioEnded(): void {
  const session = channel.value?.playbackSession;
  if (session) void playerAdvance(slot.value, session).then(() => fetchChannel()).catch(() => fetchChannel());
}
</script>

<template>
  <div class="player">
    <form v-if="needsCredential" class="device-setup" @submit.prevent="saveCredential">
      <label>通道 {{ slot }} 设备凭据<input v-model="credential" type="password" autocomplete="off" /></label>
      <label><input v-model="rememberDevice" type="checkbox" />记住此展厅专用播放器（重启后自动连接）</label>
      <button type="submit">连接播放器</button>
      <p>默认仅本次会话有效。仅在展厅专用电脑勾选记住设备；凭据不使用个人账户密码。</p>
    </form>
    <!-- 播放视频 -->
    <video
      v-if="isVideo && channel?.currentMediaUrl"
      ref="videoEl"
      class="media-el"
      :style="{ objectFit: channel.displayFit || 'fill' }"
      :src="absUrl(channel.currentMediaUrl)"
      autoplay
      playsinline
      :loop="channel.loopMode === 'loop'"
      @ended="onVideoEnded"
      @loadedmetadata="routeVideoAudio"
    />

    <!-- 播放图片 -->
    <!-- 画面铺放模式跟随通道设置 (fill=铺满拉伸(默认)/contain=保持比例/cover=裁切铺满),
         播放页下拉可改, WS 推过来即时生效; 图片和视频同款。-->
    <img
      v-else-if="isImage && channel?.currentMediaUrl"
      class="media-el"
      :style="{ objectFit: channel.displayFit || 'fill' }"
      :src="absUrl(channel.currentMediaUrl)"
      :alt="channel.currentMediaName || ''"
    />

    <!-- 播放音频 (背景音乐) — audio 元素出声 + 可视化"正在播放"卡 -->
    <div v-else-if="isAudio && channel?.currentMediaUrl" class="audio-now">
      <audio
        ref="audioEl"
        :src="absUrl(channel.currentMediaUrl)"
        autoplay
        @ended="onAudioEnded"
        @loadedmetadata="routeVideoAudio"
      />
      <div class="audio-icon">🎵</div>
      <div class="audio-title">{{ channel.currentMediaName }}</div>
      <div class="audio-sub">{{ channel.loopMode === 'loop' ? '循环播放' : '单曲播放' }} · {{ channel?.name || '播放器' }}</div>
      <div class="audio-wave"><span></span><span></span><span></span><span></span><span></span></div>
    </div>

    <!-- 文档: Word=PDF 逐页画布; PPT=原生放映占位 (放映窗口盖在上面)。
         docZoom (2026-07-29): 手机端缩放按钮 → CSS scale 跟随, 100=铺满 -->
    <canvas
      v-else-if="isDoc && channel?.currentMediaUrl"
      ref="docCanvas"
      class="media-el doc-canvas"
      :style="{ transform: `scale(${(channel?.docZoom ?? 100) / 100})`, transformOrigin: 'center center' }"
    ></canvas>
    <div v-else-if="isDoc" class="audio-now">
      <div class="audio-icon">📽️</div>
      <div class="audio-title">{{ channel?.currentMediaName }}</div>
      <div class="audio-sub">演示放映中 · 手机端可翻页</div>
    </div>

    <!-- 播放网页 (iframe 全屏渲染外部 URL) -->
    <iframe
      v-else-if="isWebpage && channel?.currentMediaUrl"
      :key="channel.playbackSession"
      class="media-el web-frame"
      :sandbox="currentWebpageSandbox"
      :src="channel.currentMediaUrl"
      referrerpolicy="no-referrer"
    />

    <!-- 待机: branding logo + 系统名 -->
    <div v-else-if="isIdle" class="idle">
      <div class="idle-logo" :class="{ 'has-img': brandingStore.branding.logoUrl }">
        <img v-if="brandingStore.branding.logoUrl" :src="brandingStore.branding.logoUrl" alt="logo" />
        <template v-else>{{ brandingStore.branding.logoText }}</template>
      </div>
      <div class="idle-title">{{ brandingStore.branding.systemName }}</div>
      <div class="idle-sub">{{ channel?.name || (slot === 1 ? 'LED 大屏' : '投影仪') }} · 待机中</div>
    </div>

    <!-- 错误兜底 -->
    <div v-if="errorMsg" class="err">{{ errorMsg }}</div>
  </div>
</template>

<style scoped>
.device-setup { position: fixed; inset: 25% 15% auto; padding: 24px; z-index: 100; background: #20232b; color: white; cursor: auto; }
.device-setup input { display: block; width: 100%; margin: 12px 0; }
.device-setup input[type="checkbox"] { display: inline-block; width: auto; margin: 12px 8px 12px 0; }
.player {
  position: fixed;
  inset: 0;
  background: #000;
  overflow: hidden;
  cursor: none;
}
.media-el {
  width: 100vw;
  height: 100vh;
  object-fit: contain;
  background: #000;
  display: block;
}
.web-frame { object-fit: unset; border: 0; background: #000; }


/* 音频播放可视化 (slot=3 背景音乐 — 这个 kiosk 窗口可见时显示) */
.audio-now {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 22px;
  background:
    radial-gradient(ellipse 60% 50% at 50% 35%, rgba(255, 255, 255, 0.08) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 50% 75%, rgba(76, 154, 255, 0.12) 0%, transparent 55%),
    linear-gradient(180deg, #070B17 0%, #0C1124 100%);
  color: #fff;
}
.audio-icon { font-size: 90px; filter: drop-shadow(0 0 24px rgba(255, 255, 255, 0.08)); }
.audio-title { font-size: 44px; font-weight: 600; letter-spacing: 0.03em; max-width: 80vw; text-align: center; }
.audio-sub { font-size: 20px; color: rgba(255, 255, 255, 0.55); letter-spacing: 0.06em; }
.audio-wave { display: flex; gap: 8px; align-items: flex-end; height: 60px; margin-top: 10px; }
.audio-wave span {
  width: 10px; border-radius: 5px;
  background: var(--v2-accent-vertical);
  animation: audio-bar 1s ease-in-out infinite;
}
.audio-wave span:nth-child(1) { height: 30%; animation-delay: 0s; }
.audio-wave span:nth-child(2) { height: 70%; animation-delay: 0.15s; }
.audio-wave span:nth-child(3) { height: 100%; animation-delay: 0.3s; }
.audio-wave span:nth-child(4) { height: 60%; animation-delay: 0.45s; }
.audio-wave span:nth-child(5) { height: 40%; animation-delay: 0.6s; }
@keyframes audio-bar { 0%, 100% { transform: scaleY(0.4); } 50% { transform: scaleY(1); } }

.idle {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  background:
    radial-gradient(ellipse 60% 50% at 50% 30%, rgba(76, 154, 255, 0.15) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 50% 80%, rgba(224, 160, 48, 0.10) 0%, transparent 55%),
    linear-gradient(180deg, #070B17 0%, #0C1124 100%);
  color: white;
}
.idle-logo {
  width: 200px;
  height: 200px;
  border-radius: 36px;
  background: linear-gradient(135deg, #06b6d4 0%, #4C9AFF 100%);
  display: grid;
  place-items: center;
  font-size: 100px;
  font-weight: 700;
  box-shadow: 0 20px 60px -10px rgba(76, 154, 255, 0.5);
  overflow: hidden;
}
/* 有自定义 logo 图时去掉写死的蓝渐变底与光晕 (透明底 logo 直接悬浮在待机深色背景上) */
.idle-logo.has-img {
  background: transparent;
  box-shadow: none;
}
.idle-logo img {
  /* 2026-07-26 业主 (带照片): "外面圆角里面方角图片非常丑"。logo 已割接成
     透明底 (system-branding heal), 这里配套改 contain + 留白 —— logo 悬浮在
     蓝色渐变磁贴中央, 而不是一张图铺满把白底怼出来。 */
  width: 78%;
  height: 78%;
  object-fit: contain;
  /* 深蓝 logo 落在蓝色渐变上, 一点柔和落影拉开层次 */
  filter: drop-shadow(0 4px 14px rgba(0, 20, 40, 0.35));
}
.idle-title {
  font-size: 56px;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.idle-sub {
  font-size: 22px;
  color: rgba(255, 255, 255, 0.55);
  letter-spacing: 0.06em;
}
.err {
  position: absolute;
  top: 16px;
  right: 16px;
  padding: 8px 14px;
  background: rgba(229, 100, 93, 0.85);
  color: white;
  font-size: 13px;
  border-radius: 6px;
}

.doc-canvas { object-fit: contain; background: #000; display: block; margin: 0 auto; }
</style>
