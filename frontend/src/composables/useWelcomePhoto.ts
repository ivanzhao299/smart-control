import { ref, onScopeDispose, onDeactivated, onActivated } from 'vue';
import { mediaService } from '@/services/media.service';
import { getApiBaseURL, getAdminToken, getClientToken } from '@/services/http';
import { fetchSystemBranding, saveWelcomeConfigVersioned } from '@/services/system-branding.service';
import { captureIdentityGuard, onIdentityChange } from '@/services/identity-boundary';
import { useToastStore } from '@/stores/toast';
import { parkOpsControlService } from '@/services/park-ops-control.service';
import { publishWelcomePhoto, takeDownWelcomePhoto, WelcomePhotoBindingUnconfirmedError, type WelcomePhotoSnapshot } from '@/services/welcome-photo-publisher';
import { welcomeOriginalScope, readWelcomeOriginal, writeWelcomeOriginal, removeWelcomeOriginal } from '@/services/welcome-photo-original';

/**
 * 来访者拍照上墙 (2026-09-14; 2026-09-15 修复 PWA 拍照闪退)
 *
 * 流程: PWA 页内相机(getUserMedia)抓帧，或从相册选择 → 生成 LED 优化版
 *   → 上传媒体库 → 绑定欢迎页 welcomePhotoMediaId → 大屏立刻回第 1 页展示。
 * 原画: 页内相机拍摄不自动进入系统相册, 改为上墙成功后
 *   由用户点「保存原画」在自己的手势下调系统分享/下载 —— 绝不在相机返回 WebView 的
 *   脆弱时刻自动弹系统面板(连续前后台切换会让 standalone PWA 被系统回收, 表现为闪退)。
 * 只保留最新一张: 换新时可恢复删除上一张; 撤下则置空回默认欢迎布局。
 *
 * LED 点对点分辨率 3612x1462, 照片位并非整屏宽, 上墙小图长边 1920px 已足够清晰,
 * JPEG 0.82 单张约 250-400KB, 不增加网络与服务器负担; 同时压低解码内存峰值防 iOS 闪退。
 */
const LED_LONG_EDGE = 1920;
const JPEG_QUALITY = 0.82;

type AnyBitmap = ImageBitmap | (HTMLImageElement & { __objectUrl?: string });

/**
 * 仅解析 JPEG 标记段读取宽高, 不解码任何像素(只读取文件前 512KB), 内存开销可忽略。
 * 用途: 拿到原始宽高后让 createImageBitmap 的 resizeWidth/Height 一次降采样到位,
 * 避免"先全尺寸解码探尺寸 → 再二次降采样"造成的上百 MB 瞬时峰值(iOS 拍照闪退主因)。
 * 非 JPEG(如 HEIC/PNG) reject, 由调用方走 HTMLImageElement 回退。
 */
function readJpegSize(file: File): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const dv = new DataView(fr.result as ArrayBuffer);
        if (dv.getUint16(0) !== 0xffd8) { reject(new Error('not-jpeg')); return; }
        let off = 2;
        while (off + 9 < dv.byteLength) {
          if (dv.getUint8(off++) !== 0xff) continue;
          const marker = dv.getUint8(off++);
          // SOF0..SOF15，排除 DHT(C4)/JPG(C8)/DAC(CC)
          if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
            const h = dv.getUint16(off + 3);
            const w = dv.getUint16(off + 5);
            if (w > 0 && h > 0) { resolve({ w, h }); return; }
            reject(new Error('bad-sof')); return;
          }
          off += dv.getUint16(off);
        }
        reject(new Error('sof-not-found'));
      } catch (e) { reject(e); }
    };
    fr.onerror = () => reject(fr.error);
    fr.readAsArrayBuffer(file.slice(0, 512 * 1024));
  });
}

async function decodeViaImage(source: File): Promise<AnyBitmap> {
  const url = URL.createObjectURL(source);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error('图片解码失败'));
    el.src = url;
  });
  (img as HTMLImageElement & { __objectUrl?: string }).__objectUrl = url;
  return img;
}

export function useWelcomePhoto() {
  const toast = useToastStore();
  /** 绑定到模板里仅用于相册兜底的 <input type="file"> */
  const fileInput = ref<HTMLInputElement | null>(null);
  const busy = ref(false);
  /** 当前是否已有上墙照片, 决定是否显示"撤下"按钮 */
  const hasPhoto = ref(false);
  /** 暂存本次原画, 供用户在自己手势下点「保存原画」; 不自动弹系统面板 */
  const pendingOriginal = ref<File | null>(null);
  const needsReload = ref(true);
  let baseline: WelcomePhotoSnapshot | null = null;
  let alive = true;
  let pageEpoch = 0;
  let operation = 0;
  let read = 0;
  let captureActive: (() => boolean) | null = null;
  const uploads = new Set<AbortController>();
  const current = () => {
    const epoch = pageEpoch;
    return captureIdentityGuard(() => alive && epoch === pageEpoch);
  };
  const scope = () => welcomeOriginalScope(getApiBaseURL(), getAdminToken(), getClientToken());
  const requireActive = (active: () => boolean) => {
    if (!active()) throw new DOMException('账号、服务器或页面已切换', 'AbortError');
  };
  const reset = () => {
    pageEpoch += 1;
    operation += 1; read += 1; captureActive = null; baseline = null;
    pendingOriginal.value = null; hasPhoto.value = false; busy.value = false; needsReload.value = true;
    for (const controller of uploads) controller.abort();
  };
  const unsubscribe = onIdentityChange(reset);
  onScopeDispose(() => { alive = false; reset(); unsubscribe(); });
  onDeactivated(() => { alive = false; reset(); });
  onActivated(() => { if (!alive) { alive = true; void loadCurrent(); } });

  async function readSnapshot(): Promise<WelcomePhotoSnapshot> {
    const config = await fetchSystemBranding();
    if (!Number.isSafeInteger(config.configRevision) || (config.configRevision ?? 0) < 1) {
      throw new Error('欢迎页配置版本不可用');
    }
    return { mediaId: config.welcomePhotoMediaId ?? null, revision: config.configRevision };
  }

  async function loadCurrent(): Promise<void> {
    if (busy.value || !alive) return;
    const ticket = ++read;
    const identity = current();
    const active = () => identity() && ticket === read;
    needsReload.value = true;
    try {
      const snapshot = await readSnapshot();
      if (!active()) return;
      const key = await scope();
      const saved = await readWelcomeOriginal(key, active);
      if (!active()) return;
      baseline = snapshot;
      hasPhoto.value = !!snapshot.mediaId;
      pendingOriginal.value = saved?.mediaId === snapshot.mediaId ? saved.file : null;
      needsReload.value = false;
    } catch {
      if (!active()) return;
      baseline = null; pendingOriginal.value = null;
      toast.error('欢迎页读取失败，请刷新核对后再操作');
    }
  }

  function beginCapture(): boolean {
    if (busy.value || needsReload.value || !alive) return false;
    captureActive = current();
    return true;
  }

  function openAlbum(): void {
    if (!beginCapture()) return;
    fileInput.value?.click();
  }

  /**
   * 解码为可 drawImage 的位图，并在解码阶段就降采样到长边 LED_LONG_EDGE。
   * 关键：先用 readJpegSize 只读 JPEG 头拿原始宽高(不解码像素)，再让 createImageBitmap
   * 一次性按比例 resize 到位 —— 全程只解码一次、且直接是小图，把内存峰值压到最低
   * (旧实现先全尺寸解码探尺寸、再二次解码，是 iPhone 相机返回瞬间闪退的主因)。
   * JPEG 头解析失败(HEIC/PNG)或不支持 resize 时，回退 HTMLImageElement 单次解码。
   */
  async function decodeBitmap(source: File): Promise<AnyBitmap> {
    if (typeof createImageBitmap === 'function') {
      const head = await readJpegSize(source).catch(() => null);
      if (head) {
        const long = Math.max(head.w, head.h);
        const base = { imageOrientation: 'from-image' as ImageOrientation };
        if (long <= LED_LONG_EDGE) {
          try { return await createImageBitmap(source, base); } catch { /* 回退 */ }
        } else {
          const ratio = LED_LONG_EDGE / long;
          try {
            return await createImageBitmap(source, {
              ...base,
              resizeWidth: Math.max(1, Math.round(head.w * ratio)),
              resizeHeight: Math.max(1, Math.round(head.h * ratio)),
              resizeQuality: 'high' as ResizeQuality,
            });
          } catch { /* 不支持 resize，回退 */ }
        }
      }
    }
    return decodeViaImage(source);
  }

  function releaseBitmap(bmp: AnyBitmap): void {
    if ('close' in bmp && typeof (bmp as ImageBitmap).close === 'function') {
      (bmp as ImageBitmap).close();
    } else if ((bmp as { __objectUrl?: string }).__objectUrl) {
      URL.revokeObjectURL((bmp as { __objectUrl?: string }).__objectUrl as string);
    }
  }

  /** 等比压缩到长边 LED_LONG_EDGE, 保持原始方向/比例, 不裁切不变形; 按 EXIF 自动转正。 */
  async function compressForLed(source: File): Promise<File> {
    const bmp = await decodeBitmap(source);
    try {
      const long = Math.max(bmp.width, bmp.height);
      const scale = long > LED_LONG_EDGE ? LED_LONG_EDGE / long : 1;
      const w = Math.max(1, Math.round(bmp.width * scale));
      const h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('无法创建画布');
      ctx.drawImage(bmp, 0, 0, w, h);
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', JPEG_QUALITY));
      return new File([blob], `welcome-led-${Date.now()}.jpg`, { type: 'image/jpeg' });
    } finally {
      releaseBitmap(bmp);
    }
  }

  /**
   * 相机原画留在本机、绝不上传。必须由用户手势主动调用(点「保存原画」):
   * iOS standalone PWA 在相机返回瞬间自动弹 share 会触发前后台切换而被系统回收。
   */
  async function keepOriginal(file: File): Promise<void> {
    const nav = navigator as Navigator & { canShare?: (data: { files: File[] }) => boolean };
    if (nav.canShare && nav.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: '保存相机原画到相册' });
    } else {
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url;
      a.download = `welcome-original-${Date.now()}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
  }

  /** 原画仅由已核对的当前会话缓存恢复；用户手势直接分享，不临时读取无归属原画。 */
  async function saveOriginal(): Promise<void> {
    if (busy.value || needsReload.value || !alive) return;
    const active = current();
    const f = pendingOriginal.value;
    if (!f) {
      toast.info('原画已不在本机，请重新拍摄');
      return;
    }
    try {
      await keepOriginal(f);
      // 保留在 IDB 允许再次下载, 直到撤下/换新覆盖, 不在此清空
      if (active()) toast.success('已完成原画分享或下载操作');
    } catch {
      // 用户取消分享/下载不算错误
      if (active()) toast.info('未保存原画（不影响照片上墙）');
    }
  }

  /** 通过现有翻页通道让大屏立刻回到第 1 页(欢迎页)。 */
  async function gotoWelcomePage(): Promise<void> {
    await parkOpsControlService.goto(0);
  }

  /**
   * 上墙小图走原生 fetch 上传(绕开 media.service 里 axios 的 adapter:'fetch' ——
   * 该流式 adapter 对 multipart 在部分 WebView / Chrome localhost 下会报
   * ERR_ALPN / Network Error, 而原生 fetch 正常)。小图无需上传进度回调。
   * 未有服务端幂等键前不自动重试：网络断开不代表上传未成功。
   */
  async function uploadLedPhoto(file: File, active: () => boolean): Promise<{ id: number }> {
    requireActive(active);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('remark', 'welcome-photo');
    const headers: Record<string, string> = { 'X-Upload-Size': String(file.size) };
    const adminToken = getAdminToken();
    const clientToken = getClientToken();
    if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
    if (clientToken) headers['X-Client-Token'] = clientToken;
    const controller = new AbortController();
    uploads.add(controller);
    const timer = setTimeout(() => controller.abort(), 60_000);
    try {
      const r = await fetch(`${getApiBaseURL()}/media/upload`, {
        method: 'POST', headers, body: fd, credentials: 'omit', redirect: 'error', signal: controller.signal,
      });
      requireActive(active);
      const j = await r.json().catch(() => null) as { success?: boolean; message?: string; data?: { id: number } } | null;
      requireActive(active);
      if (!r.ok || !Number.isSafeInteger(j?.data?.id) || (j?.data?.id ?? 0) < 1) throw new Error(j?.message || `上传失败 (${r.status})`);
      return j!.data!;
    } finally {
      clearTimeout(timer);
      uploads.delete(controller);
    }
  }

  async function publishPhoto(led: File, original: File, active: () => boolean): Promise<void> {
    try {
      requireActive(active);
      const originalScope = await scope();
      requireActive(active);
      const published = await publishWelcomePhoto(led, {
        assertActive: () => requireActive(active),
        readCurrent: readSnapshot,
        uploadLedPhoto: file => uploadLedPhoto(file, active),
        bindWelcomePhoto: async (mediaId, expectedRevision) => {
          const confirmed = await saveWelcomeConfigVersioned({ welcomePhotoMediaId: mediaId }, expectedRevision);
          return { mediaId: confirmed.welcomePhotoMediaId ?? null, revision: confirmed.configRevision };
        },
        showWelcomePage: gotoWelcomePage,
        // 删除走后端可恢复删除，不物理清除；失败不破坏当前绑定。
        removeMedia: async mediaId => {
          await mediaService.remove(mediaId);
        },
      });
      requireActive(active);
      // 原画只保存在本机；分享/下载仍由用户稍后主动触发。
      pendingOriginal.value = original;
      hasPhoto.value = true;
      baseline = { mediaId: published.mediaId, revision: published.revision };
      needsReload.value = false;
      if (originalScope) await writeWelcomeOriginal({ scope: originalScope, mediaId: published.mediaId, ts: Date.now(), file: original }, active);
      requireActive(active);
      if (published.shown) toast.success('照片已上墙，已发送切到欢迎页指令');
      else toast.info('照片已绑定，但切页指令未确认，请手动切到欢迎页');
    } catch (e) {
      if (!active()) return;
      needsReload.value = true;
      console.error('welcome photo upload failed', e);
      if (e instanceof WelcomePhotoBindingUnconfirmedError) toast.error(e.message);
      else toast.error('照片发布未确认，请先刷新核对，不要重复上传');
    }
  }

  /** 页内相机已经输出 LED 版，直接发布，避免再次解码和占用内存。 */
  async function onCaptured(led: File, original: File): Promise<void> {
    const active = captureActive;
    captureActive = null;
    if (busy.value || needsReload.value || !active?.()) return;
    const ticket = ++operation;
    read += 1;
    busy.value = true;
    try {
      await publishPhoto(led, original, active);
    } finally {
      if (ticket === operation) busy.value = false;
    }
  }

  /** 相册兜底仍需在前端按比例生成 LED 版。 */
  async function onPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const original = input.files?.[0];
    input.value = '';
    const active = captureActive;
    captureActive = null;
    if (!original || busy.value || needsReload.value || !active?.()) return;
    const ticket = ++operation;
    read += 1;
    busy.value = true;
    try {
      const led = await compressForLed(original);
      await publishPhoto(led, original, active);
    } catch (e) {
      if (!active()) return;
      console.error('welcome photo decode failed', e);
      toast.error('无法读取这张照片，请换一张重试');
    } finally {
      if (ticket === operation) busy.value = false;
    }
  }

  /** 手动撤下, 恢复默认欢迎布局。 */
  async function takeDown(): Promise<void> {
    if (busy.value || needsReload.value || !baseline?.mediaId || !alive) return;
    const ticket = ++operation;
    read += 1;
    const active = current();
    const before = { ...baseline };
    busy.value = true;
    try {
      const key = await scope();
      requireActive(active);
      const confirmed = await takeDownWelcomePhoto(before, {
        assertActive: () => requireActive(active),
        readCurrent: readSnapshot,
        bindWelcomePhoto: async (mediaId, revision) => {
          const config = await saveWelcomeConfigVersioned({ welcomePhotoMediaId: mediaId }, revision);
          return { mediaId: config.welcomePhotoMediaId ?? null, revision: config.configRevision };
        },
        removeMedia: id => mediaService.remove(id),
      });
      requireActive(active);
      baseline = confirmed;
      pendingOriginal.value = null;
      hasPhoto.value = false;
      await removeWelcomeOriginal(key, before.mediaId!, active);
      if (active()) toast.info('已撤下照片，恢复默认欢迎页');
    } catch {
      if (!active()) return;
      needsReload.value = true;
      toast.error('撤下结果未确认，请刷新核对后再操作');
    } finally {
      if (ticket === operation) busy.value = false;
    }
  }

  return {
    fileInput, busy, hasPhoto, pendingOriginal, needsReload,
    beginCapture, openAlbum, onPick, onCaptured, takeDown, saveOriginal, loadCurrent,
  };
}
