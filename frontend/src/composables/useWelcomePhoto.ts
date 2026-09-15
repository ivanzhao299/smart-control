import { ref } from 'vue';
import { mediaService } from '@/services/media.service';
import { getApiBaseURL, getAdminToken, getClientToken } from '@/services/http';
import { fetchSystemBranding, saveWelcomeConfig } from '@/services/system-branding.service';
import { useToastStore } from '@/stores/toast';

/**
 * 来访者拍照上墙 (2026-09-14; 2026-09-15 修复 PWA 拍照闪退)
 *
 * 流程: PWA 调系统相机 → 前端按原比例等比压缩出 LED 优化版(不裁切/不变形)
 *   → 上传媒体库 → 绑定欢迎页 welcomePhotoMediaId → 大屏立刻回第 1 页展示。
 * 原画: capture 拍摄时安卓通常已自动入相册; iOS 网页拍摄不入相册, 改为上墙成功后
 *   由用户点「保存原画」在自己的手势下调系统分享/下载 —— 绝不在相机返回 WebView 的
 *   脆弱时刻自动弹系统面板(连续前后台切换会让 standalone PWA 被系统回收, 表现为闪退)。
 * 只保留最新一张: 换新时可恢复删除上一张; 撤下则置空回默认欢迎布局。
 *
 * LED 点对点分辨率 3612x1462, 照片位长边 2200px 已足够清晰,
 * JPEG 0.82 单张约 300-500KB, 不增加网络与服务器负担。
 */
const LED_LONG_EDGE = 2200;
const JPEG_QUALITY = 0.82;

type AnyBitmap = ImageBitmap | (HTMLImageElement & { __objectUrl?: string });

export function useWelcomePhoto() {
  const toast = useToastStore();
  /** 绑定到模板里隐藏的 <input type="file" capture> */
  const fileInput = ref<HTMLInputElement | null>(null);
  const busy = ref(false);
  /** 当前是否已有上墙照片, 决定是否显示"撤下"按钮 */
  const hasPhoto = ref(false);
  /** 暂存本次原画, 供用户在自己手势下点「保存原画」; 不自动弹系统面板 */
  const pendingOriginal = ref<File | null>(null);

  async function loadCurrent(): Promise<void> {
    const cur = await fetchSystemBranding().catch(() => null);
    hasPhoto.value = !!(cur?.welcomePhotoMediaId);
  }

  function openCamera(): void {
    if (busy.value) return;
    fileInput.value?.click();
  }

  /**
   * 解码为可 drawImage 的位图, 并在解码阶段就降采样到长边 LED_LONG_EDGE。
   * 手机原图常为 4000px 级, 全尺寸解码 + canvas 峰值上百 MB, 是 standalone PWA
   * 被系统回收(闪退)的主要内存来源; createImageBitmap 的 resize* 选项可在解码期降采样。
   * 不支持 resize 或 createImageBitmap(如部分 WebView 对 HEIC) 时回退 HTMLImageElement。
   */
  async function decodeBitmap(source: File): Promise<AnyBitmap> {
    try {
      const probe = await createImageBitmap(source, { imageOrientation: 'from-image' });
      const long = Math.max(probe.width, probe.height);
      if (long <= LED_LONG_EDGE) return probe;
      const ratio = LED_LONG_EDGE / long;
      const resizeOpts = {
        imageOrientation: 'from-image' as ImageOrientation,
        resizeWidth: Math.max(1, Math.round(probe.width * ratio)),
        resizeHeight: Math.max(1, Math.round(probe.height * ratio)),
        resizeQuality: 'high' as ResizeQuality,
      };
      probe.close?.();
      try {
        return await createImageBitmap(source, resizeOpts);
      } catch {
        // 浏览器忽略/不支持 resize 选项: 普通解码后由 canvas 缩放
        return await createImageBitmap(source, { imageOrientation: 'from-image' });
      }
    } catch {
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

  /** 用户手势: 把本次原画保存到本机相册/下载。 */
  async function saveOriginal(): Promise<void> {
    const f = pendingOriginal.value;
    if (!f) return;
    try {
      await keepOriginal(f);
      pendingOriginal.value = null;
      toast.success('原画已保存到本机');
    } catch {
      // 用户取消分享/下载不算错误
      toast.info('未保存原画（不影响照片上墙）');
    }
  }

  /** 通过现有翻页通道让大屏立刻回到第 1 页(欢迎页)。 */
  async function gotoWelcomePage(): Promise<void> {
    try {
      await fetch('/api/park-ops-control/goto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 0 }),
      });
    } catch {
      /* 跳页失败不阻断照片上墙 */
    }
  }

  /**
   * 上墙小图走原生 fetch 上传(绕开 media.service 里 axios 的 adapter:'fetch' ——
   * 该流式 adapter 对 multipart 在部分 WebView / Chrome localhost 下会报
   * ERR_ALPN / Network Error, 而原生 fetch 正常)。小图无需上传进度回调。
   * 带一次"仅网络层/5xx"自动重试, 提升真机弱网成功率; 业务 4xx 不重试。
   */
  async function uploadLedPhoto(file: File): Promise<{ id: number }> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('remark', 'welcome-photo');
    const headers: Record<string, string> = { 'X-Upload-Size': String(file.size) };
    const adminToken = getAdminToken();
    const clientToken = getClientToken();
    if (adminToken) headers.Authorization = `Bearer ${adminToken}`;
    if (clientToken) headers['X-Client-Token'] = clientToken;
    const r = await fetch(`${getApiBaseURL()}/media/upload`, {
      method: 'POST', headers, body: fd, credentials: 'omit',
    });
    const j = await r.json().catch(() => null) as { success?: boolean; message?: string; data?: { id: number } } | null;
    if (!r.ok || !j?.data?.id) throw new Error(j?.message || `上传失败 (${r.status})`);
    return j.data;
  }

  async function uploadWithRetry(file: File, tries = 2): Promise<{ id: number }> {
    let last: unknown;
    for (let i = 0; i < tries; i += 1) {
      try {
        return await uploadLedPhoto(file);
      } catch (e) {
        last = e;
        const status = (e as { status?: number })?.status;
        if (typeof status === 'number' && status < 500) throw e;
        await new Promise((r) => setTimeout(r, 400));
      }
    }
    throw last;
  }

  async function onPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const original = input.files?.[0];
    input.value = ''; // 复位, 允许连续拍摄同一张图
    if (!original) return;
    busy.value = true;
    let oldId: number | null = null;
    try {
      // 1) 先在前台尽快把原图压成小图(尽早释放解码内存), 不在此处弹任何系统面板
      const led = await compressForLed(original);
      // 2) 上传 + 绑定 + 大屏回欢迎页
      const cur = await fetchSystemBranding().catch(() => null);
      oldId = cur?.welcomePhotoMediaId ?? null;
      const media = await uploadWithRetry(led);
      await saveWelcomeConfig({ welcomePhotoMediaId: media.id });
      await gotoWelcomePage();
      if (oldId && oldId !== media.id) {
        // 只保留最新一张: 删除走后端可恢复删除, 不是物理清除
        await mediaService.remove(oldId).catch(() => undefined);
      }
      // 3) 原画只暂存, 等用户点「保存原画」(用户手势), 不自动弹 share 以免 PWA 闪退
      pendingOriginal.value = original;
      hasPhoto.value = true;
      toast.success('照片已上墙，大屏已切到欢迎页');
    } catch (e) {
      console.error('welcome photo upload failed', e);
      pendingOriginal.value = null;
      toast.error('照片上墙失败，请重试');
    } finally {
      busy.value = false;
    }
  }

  /** 手动撤下, 恢复默认欢迎布局。 */
  async function takeDown(): Promise<void> {
    busy.value = true;
    try {
      const cur = await fetchSystemBranding().catch(() => null);
      const id = cur?.welcomePhotoMediaId ?? null;
      await saveWelcomeConfig({ welcomePhotoMediaId: null });
      if (id) await mediaService.remove(id).catch(() => undefined);
      pendingOriginal.value = null;
      toast.info('已撤下照片，恢复默认欢迎页');
      hasPhoto.value = false;
    } catch {
      toast.error('撤下失败，请重试');
    } finally {
      busy.value = false;
    }
  }

  return {
    fileInput, busy, hasPhoto, pendingOriginal,
    openCamera, onPick, takeDown, saveOriginal, loadCurrent,
  };
}
