<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { wsClient } from '@/services/websocket.service';
import { getChannel, channelHeartbeat } from '@/services/playback.service';
import { useSystemBrandingStore } from '@/stores/system-branding';
import { absUrl } from '@/services/http';
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
  return Number.isFinite(n) && (n === 1 || n === 2) ? n : 1;
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
  await brandingStore.load();
  await fetchChannel();

  unsubscribeWs = wsClient.on(handleWs);
  wsClient.connect();

  // 立刻一次心跳, 然后每 30s 一次
  void sendHeartbeat();
  heartbeatTimer = window.setInterval(() => void sendHeartbeat(), 30_000);

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
  if (unsubscribeWs) unsubscribeWs();
});

// 视频元素引用 — 用来在 ended 时根据 loopMode 决定循环或回待机
const videoEl = ref<HTMLVideoElement | null>(null);
watch(() => channel.value?.currentMediaUrl, (url, oldUrl) => {
  // url 变了就强制 reload <video>, 防止浏览器缓存上一段
  if (url !== oldUrl && videoEl.value) {
    videoEl.value.load();
    void videoEl.value.play().catch(() => { /* 用户没交互可能被拒 */ });
  }
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
const isIdle = computed<boolean>(() => !channel.value?.currentMediaUrl);
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
      muted
      playsinline
      :loop="channel.loopMode === 'loop'"
      @ended="onVideoEnded"
    />

    <!-- 播放图片 -->
    <img
      v-else-if="isImage && channel?.currentMediaUrl"
      class="media-el"
      :src="absUrl(channel.currentMediaUrl)"
      :alt="channel.currentMediaName || ''"
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
.idle {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 24px;
  background:
    radial-gradient(ellipse 60% 50% at 50% 30%, rgba(6, 182, 212, 0.15) 0%, transparent 60%),
    radial-gradient(ellipse 50% 40% at 50% 80%, rgba(245, 158, 11, 0.10) 0%, transparent 55%),
    linear-gradient(180deg, #070B17 0%, #0C1124 100%);
  color: white;
}
.idle-logo {
  width: 200px;
  height: 200px;
  border-radius: 36px;
  background: linear-gradient(135deg, #06b6d4 0%, #3b82f6 100%);
  display: grid;
  place-items: center;
  font-size: 100px;
  font-weight: 700;
  box-shadow: 0 20px 60px -10px rgba(6, 182, 212, 0.5);
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
  background: rgba(239, 68, 68, 0.85);
  color: white;
  font-size: 13px;
  border-radius: 6px;
}
</style>
