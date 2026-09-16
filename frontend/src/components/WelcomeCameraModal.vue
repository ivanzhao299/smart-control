<script setup lang="ts">
/**
 * 来访者拍照上墙 — 页内相机 (2026-09-15)
 *
 * 背景: iOS「添加到主屏幕」的全屏 standalone PWA(WKWebView) 里, 只要网页走到
 *   "启动系统相机进程" 这一步 —— 无论是 <input capture> 直进, 还是文件菜单里选
 *   "拍照" —— 都会在原生边界直接闪退(连相机界面都不进), 且 JS 无法捕获; 而选
 *   "照片图库/文件" 不经过相机进程所以不崩。
 * 方案: 安全上下文(HTTPS/localhost)下改用 getUserMedia 在网页内取景, canvas 抓帧,
 *   全程不启动系统相机、不弹文件选择器, 从根上绕开该 WebKit 崩溃。非安全上下文、
 *   权限被拒或无摄像头时 emit('fallback'), 由外层回退到 <input type=file>(走图库)。
 *
 * 出图: original = 传感器抓帧原生分辨率(供"保存原画"); led = 长边 1920 等比缩放
 *   (不裁切、不变形, 跟随拍摄方向比例), 直接供上墙, 内存可控。
 */
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { X, SwitchCamera } from 'lucide-vue-next';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'capture', led: File, original: File): void;
  (e: 'fallback'): void;
}>();

const LED_LONG_EDGE = 1920;
const securePublicUrl = (import.meta.env.VITE_SECURE_PUBLIC_URL ?? 'https://park.cnjinhu.com/control/').trim();
const secureContext = window.isSecureContext;
type Phase = 'idle' | 'loading' | 'live' | 'capturing' | 'preview' | 'error';

const phase = ref<Phase>('idle');
const errMsg = ref('');
const facing = ref<'environment' | 'user'>('environment');
const previewUrl = ref('');
const videoEl = ref<HTMLVideoElement | null>(null);

let stream: MediaStream | null = null;
let capturedLed: File | null = null;
let capturedOrig: File | null = null;
let startGeneration = 0;

function stopStream(): void {
  if (stream) {
    stream.getTracks().forEach((t) => { try { t.stop(); } catch { /* noop */ } });
    stream = null;
  }
  if (videoEl.value) videoEl.value.srcObject = null;
}

async function start(): Promise<void> {
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
    errMsg.value = window.isSecureContext
      ? '当前浏览器不支持页内相机，请改用相册选择'
      : '当前入口使用 HTTP，iPhone 会阻止网页相机。请打开 HTTPS 安全版；首次使用需重新登录并重新添加到主屏幕。';
    phase.value = 'error';
    return;
  }
  const generation = ++startGeneration;
  stopStream();
  phase.value = 'loading';
  errMsg.value = '';
  try {
    const nextStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: facing.value },
        width: { ideal: 1920, max: 1920 },
        height: { ideal: 1080, max: 1920 },
      },
    });
    if (generation !== startGeneration || !props.open) {
      nextStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = nextStream;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.onended = () => {
        if (generation === startGeneration && props.open && phase.value === 'live') {
          stopStream();
          errMsg.value = '相机连接已中断，请重试';
          phase.value = 'error';
        }
      };
    }
    await nextTick();
    const v = videoEl.value;
    if (!v) throw new Error('video-element-missing');
    v.srcObject = stream;
    await v.play().catch(() => undefined);
    // iOS can resolve getUserMedia but never produce a playable frame. Fail over
    // instead of leaving the user on a permanently black preview.
    if (!v.videoWidth) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 5000);
        v.addEventListener('loadedmetadata', () => {
          window.clearTimeout(timer);
          resolve();
        }, { once: true });
      });
    }
    if (generation !== startGeneration || !props.open) return;
    if (!v.videoWidth || !v.videoHeight) throw new Error('camera-frame-timeout');
    phase.value = 'live';
  } catch (e) {
    if (generation !== startGeneration || !props.open) return;
    stopStream();
    phase.value = 'error';
    errMsg.value = e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'SecurityError')
      ? '相机权限被拒绝，请在浏览器/系统设置中允许摄像头后重试'
      : '无法启动相机，请改用相册选择';
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas-encode-failed'))), 'image/jpeg', quality);
  });
}

async function snap(): Promise<void> {
  const v = videoEl.value;
  if (phase.value !== 'live' || !v || !v.videoWidth || !v.videoHeight) return;
  phase.value = 'capturing';
  const vw = v.videoWidth;
  const vh = v.videoHeight;
  // 原画: 抓帧原生分辨率
  const c0 = document.createElement('canvas');
  c0.width = vw; c0.height = vh;
  const ctx0 = c0.getContext('2d');
  if (!ctx0) {
    stopStream();
    errMsg.value = '无法创建照片画布，请改用相册选择';
    phase.value = 'error';
    return;
  }
  ctx0.drawImage(v, 0, 0, vw, vh);
  // LED 版: 长边 1920 等比, 不裁切不变形
  const long = Math.max(vw, vh);
  const scale = long > LED_LONG_EDGE ? LED_LONG_EDGE / long : 1;
  const w = Math.max(1, Math.round(vw * scale));
  const h = Math.max(1, Math.round(vh * scale));
  const c1 = document.createElement('canvas');
  c1.width = w; c1.height = h;
  const ctx1 = c1.getContext('2d');
  if (!ctx1) {
    stopStream();
    c0.width = c0.height = 1;
    errMsg.value = '无法创建照片画布，请改用相册选择';
    phase.value = 'error';
    return;
  }
  ctx1.drawImage(c0, 0, 0, w, h);
  stopStream(); // Pixels are copied; release the camera before JPEG encoding.
  try {
    const origBlob = await canvasToBlob(c0, 0.92);
    const ledBlob = long <= LED_LONG_EDGE ? origBlob : await canvasToBlob(c1, 0.82);
    const ts = Date.now();
    capturedOrig = new File([origBlob], `welcome-original-${ts}.jpg`, { type: 'image/jpeg' });
    capturedLed = new File([ledBlob], `welcome-led-${ts}.jpg`, { type: 'image/jpeg' });
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
    previewUrl.value = URL.createObjectURL(capturedOrig);
    phase.value = 'preview';
  } catch {
    errMsg.value = '照片处理失败，请重拍或改用相册选择';
    phase.value = 'error';
  } finally {
    c0.width = c0.height = c1.width = c1.height = 1;
  }
}

async function retake(): Promise<void> {
  if (previewUrl.value) { URL.revokeObjectURL(previewUrl.value); previewUrl.value = ''; }
  capturedLed = null; capturedOrig = null;
  await start();
}

function flip(): void {
  facing.value = facing.value === 'environment' ? 'user' : 'environment';
  void start();
}

function confirmShot(): void {
  if (capturedLed && capturedOrig) {
    emit('capture', capturedLed, capturedOrig);
    close();
  }
}

/** 主动改用系统文件选择(图库不经过相机进程, 不闪退) */
function useAlbum(): void {
  emit('fallback');
  close();
}

function openSecureVersion(): void {
  if (!securePublicUrl) return;
  window.location.assign(securePublicUrl);
}

function close(): void {
  startGeneration += 1;
  stopStream();
  phase.value = 'idle';
  if (previewUrl.value) { URL.revokeObjectURL(previewUrl.value); previewUrl.value = ''; }
  capturedLed = null; capturedOrig = null;
  emit('update:open', false);
}

watch(() => props.open, (isOpen) => {
  if (isOpen) void start();
  else {
    startGeneration += 1;
    stopStream();
  }
});

function handleVisibilityChange(): void {
  if (document.hidden) {
    startGeneration += 1;
    stopStream();
    if (props.open) phase.value = 'idle';
  } else if (props.open && phase.value === 'idle') {
    void start();
  }
}

onMounted(() => document.addEventListener('visibilitychange', handleVisibilityChange));

onBeforeUnmount(() => {
  startGeneration += 1;
  stopStream();
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
});
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="wcm-overlay" @pointerdown.self="close">
      <div class="wcm-panel" role="dialog" aria-modal="true" aria-label="拍照上墙">
        <div class="wcm-top">
          <button type="button" class="wcm-iconbtn" aria-label="关闭" @click="close"><X :size="20" :stroke-width="2.2" /></button>
          <span class="wcm-title">拍照上墙</span>
          <button type="button" class="wcm-iconbtn" aria-label="切换前后摄像头" @click="flip"><SwitchCamera :size="20" :stroke-width="2.2" /></button>
        </div>

        <div class="wcm-stage">
          <video
            v-show="phase === 'live' || phase === 'loading' || phase === 'capturing'"
            ref="videoEl"
            class="wcm-video"
            autoplay
            playsinline
            muted
            disablepictureinpicture
          ></video>
          <img v-if="phase === 'preview' && previewUrl" :src="previewUrl" class="wcm-preview" alt="拍摄预览" />
          <div v-if="phase === 'loading'" class="wcm-mask-hint">正在启动相机…</div>
          <div v-if="phase === 'capturing'" class="wcm-mask-hint">正在生成照片…</div>
          <div v-if="phase === 'error'" class="wcm-error">
            <p class="wcm-err-text">{{ errMsg }}</p>
            <div class="wcm-error-btns">
              <button v-if="!secureContext && securePublicUrl" type="button" class="wcm-btn primary" @click="openSecureVersion">打开安全版并拍照</button>
              <button type="button" class="wcm-btn ghost" @click="start">重试</button>
              <button type="button" class="wcm-btn primary" @click="useAlbum">从相册选择（勿点拍照）</button>
            </div>
          </div>
        </div>

        <div class="wcm-bottom">
          <button v-if="phase === 'live'" type="button" class="wcm-shutter" aria-label="拍照" @click="snap">
            <span class="wcm-shutter-ring"></span>
          </button>
          <template v-else-if="phase === 'preview'">
            <button type="button" class="wcm-btn ghost" @click="retake">重拍</button>
            <button type="button" class="wcm-btn primary wide" @click="confirmShot">使用这张上墙</button>
          </template>
          <span v-else class="wcm-bottom-placeholder"></span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.wcm-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.92);
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-user-select: none;
  user-select: none;
}
.wcm-panel {
  width: min(100vw, 560px);
  height: 100%;
  max-height: 100dvh;
  display: flex;
  flex-direction: column;
  background: #0b0f16;
}
.wcm-top {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: calc(10px + env(safe-area-inset-top, 0px)) 14px 10px;
  color: #e6edf6;
}
.wcm-title { font-size: 16px; font-weight: 600; letter-spacing: 0.5px; }
.wcm-iconbtn {
  width: 40px; height: 40px;
  display: grid; place-items: center;
  border-radius: 50%;
  border: 1px solid rgba(255, 255, 255, 0.18);
  background: rgba(255, 255, 255, 0.08);
  color: #e6edf6;
  cursor: pointer;
}
.wcm-iconbtn:active { background: rgba(255, 255, 255, 0.18); }
.wcm-stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  margin: 0 12px;
  border-radius: 16px;
  overflow: hidden;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.wcm-video, .wcm-preview {
  width: 100%;
  height: 100%;
  /* contain: 跟随拍摄方向/比例, 不裁切、不变形 */
  object-fit: contain;
  background: #000;
}
.wcm-mask-hint {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #9fb2c8;
  font-size: 14px;
}
.wcm-error {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 18px;
  padding: 24px;
  text-align: center;
}
.wcm-err-text { color: #ffb4a8; font-size: 14px; line-height: 1.6; margin: 0; max-width: 320px; }
.wcm-error-btns { display: flex; gap: 12px; flex-wrap: wrap; justify-content: center; }
.wcm-bottom {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 22px;
  padding: 18px 16px calc(22px + env(safe-area-inset-bottom, 0px));
}
.wcm-bottom-placeholder { width: 1px; height: 1px; }
.wcm-shutter {
  width: 78px; height: 78px;
  border-radius: 50%;
  border: none;
  background: transparent;
  cursor: pointer;
  display: grid; place-items: center;
  padding: 0;
}
.wcm-shutter-ring {
  width: 68px; height: 68px;
  border-radius: 50%;
  background: #fff;
  border: 5px solid rgba(255, 255, 255, 0.35);
  box-shadow: 0 0 0 3px #fff inset;
  transition: transform 0.08s ease;
}
.wcm-shutter:active .wcm-shutter-ring { transform: scale(0.9); }
.wcm-btn {
  min-height: 46px;
  padding: 0 22px;
  border-radius: 23px;
  font-size: 15px;
  font-weight: 600;
  cursor: pointer;
  border: 1px solid transparent;
}
.wcm-btn.ghost {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.2);
  color: #e6edf6;
}
.wcm-btn.primary {
  background: linear-gradient(135deg, #2f7bff, #18b6ff);
  color: #fff;
}
.wcm-btn.wide { padding: 0 30px; }
.wcm-btn:active { opacity: 0.85; }
</style>
