<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { wsClient } from '@/services/websocket.service';
import { getChannel, channelHeartbeat } from '@/services/playback.service';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { absUrl, setApiBaseURL } from '@/services/http';
import type { PlaybackChannelView, WsEvent } from '@/types/api';

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
 * 没鉴权 — kiosk 浏览器本来就在受控环境里, 公开 GET 也接受.
 */

const route = useRoute();
const brandingStore = useSystemBrandingStore();

const slot = computed<number>(() => {
  const q = Array.isArray(route.query.slot) ? route.query.slot[0] : route.query.slot;
  const n = Number(q);
  return Number.isFinite(n) && (n === 1 || n === 2 || n === 3) ? n : 1;
});

const channel = ref<PlaybackChannelView | null>(null);
const errorMsg = ref<string>('');
let unsubscribeWs: (() => void) | null = null;
let heartbeatTimer: number | undefined;

async function fetchChannel(): Promise<void> {
  try {
    channel.value = await getChannel(slot.value);
    errorMsg.value = '';
  } catch (e) {
    errorMsg.value = (e as Error).message || '拉取通道失败';
  }
}

function handleWs(event: WsEvent): void {
  if (event.type === 'playback_channel_changed' && event.slot === slot.value) {
    channel.value = event.view;
  }
}

async function sendHeartbeat(): Promise<void> {
  try { await channelHeartbeat(slot.value); } catch { /* ignore */ }
}

onMounted(async () => {
  // kiosk 始终在本机运行: 强制 API 指向本机后端, 防止 localStorage 残留旧 IP 导致超时
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    setApiBaseURL('http://localhost:3200');
  }

  await brandingStore.load();
  await fetchChannel();

  unsubscribeWs = wsClient.on(handleWs);
  wsClient.connect();

  // 立刻一次心跳, 然后每 30s 一次。顺带每轮 fetchChannel 兜底: WS 是零延迟切素材
  // 的主路径, 但 WS 万一长时间断线 (网络抖动 / 后端重启后重连失败), 光靠 WS 就再也
  // 收不到切换事件, 大屏会卡在旧素材上。加一条 30s 轮询 —— WS 通时它拉到的跟 WS
  // 推的一样 (幂等无害), WS 断时它就是唯一能把新素材切上来的兜底。
  void sendHeartbeat();
  heartbeatTimer = window.setInterval(() => { void sendHeartbeat(); void fetchChannel(); }, 30_000);

  // HDMI 音频路由重试: 只有 slot1/2 (视频) 需要, routeVideoAudio 内部已经检查过
  // slot, 这里无脑每 5s 试一次, 成功了自己会清掉这个定时器, 便宜且没有副作用
  audioRouteRetryTimer = window.setInterval(() => void routeVideoAudio(), 5_000);

  // 自动进入浏览器全屏 (kiosk 模式本来就 borderless 但有些环境 fullscreen API 还要单独触发)
  try {
    const el = document.documentElement;
    if (el.requestFullscreen && !document.fullscreenElement) {
      await el.requestFullscreen().catch(() => { /* 用户没交互过浏览器会拒, 忽略 */ });
    }
  } catch { /* ignore */ }
});

onBeforeUnmount(() => {
  if (heartbeatTimer) clearInterval(heartbeatTimer);
  if (audioRouteRetryTimer !== undefined) clearInterval(audioRouteRetryTimer);
  if (unsubscribeWs) unsubscribeWs();
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
    const hdmi = outs.find((d) => /HDMI|显示器音频|Display Audio/i.test(d.label));
    if (hdmi) cachedHdmiDeviceId = hdmi.deviceId;
  } catch { /* 这次没解析出来, 等下一轮重试 */ }
  return cachedHdmiDeviceId;
}
async function routeVideoAudio(): Promise<void> {
  if (slot.value !== 1 && slot.value !== 2) return;  // slot3 是 BGM, 必须留在默认设备
  const el = videoEl.value as (HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> }) | null;
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
  if (channel.value?.loopMode === 'loop' && audioEl.value) {
    audioEl.value.currentTime = 0;
    void audioEl.value.play();
  }
}
</script>

<template>
  <div class="player">
    <!-- 播放视频 -->
    <video
      v-if="isVideo && channel?.currentMediaUrl"
      ref="videoEl"
      class="media-el"
      :src="absUrl(channel.currentMediaUrl)"
      autoplay
      playsinline
      :loop="channel.loopMode === 'loop'"
      @ended="onVideoEnded"
      @loadedmetadata="routeVideoAudio"
    />

    <!-- 播放图片 -->
    <img
      v-else-if="isImage && channel?.currentMediaUrl"
      class="media-el"
      :src="absUrl(channel.currentMediaUrl)"
      :alt="channel.currentMediaName || ''"
    />

    <!-- 播放音频 (背景音乐) — audio 元素出声 + 可视化"正在播放"卡 -->
    <div v-else-if="isAudio && channel?.currentMediaUrl" class="audio-now">
      <audio
        ref="audioEl"
        :src="absUrl(channel.currentMediaUrl)"
        autoplay
        :loop="channel.loopMode === 'loop'"
        @ended="onAudioEnded"
      />
      <div class="audio-icon">🎵</div>
      <div class="audio-title">{{ channel.currentMediaName }}</div>
      <div class="audio-sub">{{ channel.loopMode === 'loop' ? '循环播放' : '单曲播放' }} · 背景音乐</div>
      <div class="audio-wave"><span></span><span></span><span></span><span></span><span></span></div>
    </div>

    <!-- 播放网页 (iframe 全屏渲染外部 URL) -->
    <iframe
      v-else-if="isWebpage && channel?.currentMediaUrl"
      class="media-el web-frame"
      :src="channel.currentMediaUrl"
      referrerpolicy="no-referrer"
    />

    <!-- 待机: branding logo + 系统名 -->
    <div v-else-if="isIdle" class="idle">
      <div class="idle-logo">
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
.web-frame { object-fit: unset; border: 0; background: #fff; }

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
  background: linear-gradient(180deg, #4C9AFF, #9BA1A9);
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
.idle-logo img {
  width: 100%;
  height: 100%;
  object-fit: cover;
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
</style>
