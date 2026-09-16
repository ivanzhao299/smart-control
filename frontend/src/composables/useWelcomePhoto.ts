import { ref } from 'vue';
import { mediaService } from '@/services/media.service';
import { getApiBaseURL, getAdminToken, getClientToken } from '@/services/http';
import { fetchSystemBranding, saveWelcomeConfig } from '@/services/system-branding.service';
import { useToastStore } from '@/stores/toast';
import { parkOpsControlService } from '@/services/park-ops-control.service';
import { publishWelcomePhoto } from '@/services/welcome-photo-publisher';

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

// ===== 原画本机暂存 (IndexedDB) =====
// standalone PWA 可能因系统回收而重载, 内存 ref 随之丢失 → "保存原画"按钮消失。
// 把最近一张原画存 IDB, 重载后按当前
// 绑定的 mediaId 恢复; 只保留最新一张, 撤下/换新即清。隐私模式 IDB 不可用时静默降级。
const IDB_NAME = 'smart-control';
const IDB_STORE = 'welcomePhoto';
const IDB_KEY = 'original';
interface StoredOriginal { mediaId: number; ts: number; file: File; }

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function idbSet(value: StoredOriginal): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).put(value, IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* IDB 不可用不阻断主流程 */ }
}
async function idbGet(): Promise<StoredOriginal | null> {
  try {
    const db = await openIdb();
    const v = await new Promise<StoredOriginal | undefined>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const r = tx.objectStore(IDB_STORE).get(IDB_KEY);
      r.onsuccess = () => resolve(r.result as StoredOriginal | undefined);
      r.onerror = () => reject(r.error);
    });
    db.close();
    return v ?? null;
  } catch { return null; }
}
async function idbDel(): Promise<void> {
  try {
    const db = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(IDB_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch { /* ignore */ }
}
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

  async function loadCurrent(): Promise<void> {
    const cur = await fetchSystemBranding().catch(() => null);
    const id = cur?.welcomePhotoMediaId ?? null;
    hasPhoto.value = !!id;
    // 相机返回若整页被回收重载, 内存原画已丢: 仅当 IDB 里正是当前上墙这张才恢复下载入口
    const saved = await idbGet();
    if (saved && id && saved.mediaId === id) {
      pendingOriginal.value = saved.file;
    } else if (saved) {
      pendingOriginal.value = null;
      void idbDel();
    }
  }

  function openAlbum(): void {
    if (busy.value) return;
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

  /** 用户手势: 把本次原画保存到本机相册/下载。内存没有时回退 IDB(整页重载后仍可下载)。 */
  async function saveOriginal(): Promise<void> {
    let f = pendingOriginal.value;
    if (!f) {
      const saved = await idbGet();
      f = saved?.file ?? null;
    }
    if (!f) {
      toast.info('原画已不在本机，请重新拍摄');
      return;
    }
    try {
      await keepOriginal(f);
      // 保留在 IDB 允许再次下载, 直到撤下/换新覆盖, 不在此清空
      toast.success('原画已保存到本机');
    } catch {
      // 用户取消分享/下载不算错误
      toast.info('未保存原画（不影响照片上墙）');
    }
  }

  /** 通过现有翻页通道让大屏立刻回到第 1 页(欢迎页)。 */
  async function gotoWelcomePage(): Promise<void> {
    try {
      await parkOpsControlService.goto(0);
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

  async function publishPhoto(led: File, original: File): Promise<void> {
    try {
      const published = await publishWelcomePhoto(led, {
        readCurrentMediaId: async () =>
          (await fetchSystemBranding()).welcomePhotoMediaId ?? null,
        uploadLedPhoto: uploadWithRetry,
        bindWelcomePhoto: async mediaId => {
          await saveWelcomeConfig({ welcomePhotoMediaId: mediaId });
        },
        showWelcomePage: gotoWelcomePage,
        // 删除走后端可恢复删除，不物理清除；失败不破坏当前绑定。
        removeMedia: async mediaId => {
          await mediaService.remove(mediaId);
        },
      });
      // 原画只保存在本机；分享/下载仍由用户稍后主动触发。
      pendingOriginal.value = original;
      hasPhoto.value = true;
      const idForIdb = published.mediaId;
      setTimeout(() => {
        void idbSet({ mediaId: idForIdb, ts: Date.now(), file: original });
      }, 0);
      toast.success('照片已上墙，大屏已切到欢迎页');
    } catch (e) {
      console.error('welcome photo upload failed', e);
      pendingOriginal.value = null;
      toast.error('照片上墙失败，请重试');
    }
  }

  /** 页内相机已经输出 LED 版，直接发布，避免再次解码和占用内存。 */
  async function onCaptured(led: File, original: File): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    try {
      await publishPhoto(led, original);
    } finally {
      busy.value = false;
    }
  }

  /** 相册兜底仍需在前端按比例生成 LED 版。 */
  async function onPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const original = input.files?.[0];
    input.value = '';
    if (!original || busy.value) return;
    busy.value = true;
    try {
      const led = await compressForLed(original);
      await publishPhoto(led, original);
    } catch (e) {
      console.error('welcome photo decode failed', e);
      toast.error('无法读取这张照片，请换一张重试');
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
      void idbDel();
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
    openAlbum, onPick, onCaptured, takeDown, saveOriginal, loadCurrent,
  };
}
