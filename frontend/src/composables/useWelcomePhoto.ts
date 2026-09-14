import { ref } from 'vue';
import { mediaService } from '@/services/media.service';
import { fetchSystemBranding, saveWelcomeConfig } from '@/services/system-branding.service';
import { useToastStore } from '@/stores/toast';

/**
 * 来访者拍照上墙 (2026-09-14)
 *
 * 流程: PWA 调系统相机 → 原画留在本机相册(iOS 弹一步保存, 不上传)
 *   → 前端按原比例等比压缩出 LED 优化版(不裁切/不变形) → 上传媒体库
 *   → 绑定到欢迎页 welcomePhotoMediaId → 大屏立刻回第 1 页展示。
 * 只保留最新一张: 换新时可恢复删除上一张; 撤下则置空回默认欢迎布局。
 *
 * LED 点对点分辨率 3612x1462, 照片位长边 2200px 已足够清晰,
 * JPEG 0.82 单张约 300-500KB, 不增加网络与服务器负担。
 */
const LED_LONG_EDGE = 2200;
const JPEG_QUALITY = 0.82;

export function useWelcomePhoto() {
  const toast = useToastStore();
  /** 绑定到模板里隐藏的 <input type="file" capture> */
  const fileInput = ref<HTMLInputElement | null>(null);
  const busy = ref(false);
  /** 当前是否已有上墙照片, 决定是否显示"撤下"按钮 */
  const hasPhoto = ref(false);

  async function loadCurrent(): Promise<void> {
    const cur = await fetchSystemBranding().catch(() => null);
    hasPhoto.value = !!(cur?.welcomePhotoMediaId);
  }

  function openCamera(): void {
    if (busy.value) return;
    fileInput.value?.click();
  }

  /** 等比压缩到长边 LED_LONG_EDGE, 保持原始方向/比例, 不裁切不变形; 按 EXIF 自动转正。 */
  async function compressForLed(source: File): Promise<File> {
    const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image' });
    const { width, height } = bitmap;
    const long = Math.max(width, height);
    const scale = long > LED_LONG_EDGE ? LED_LONG_EDGE / long : 1;
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布');
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('图片压缩失败'))), 'image/jpeg', JPEG_QUALITY));
    return new File([blob], `welcome-led-${Date.now()}.jpg`, { type: 'image/jpeg' });
  }

  /**
   * 相机原画留在本机、绝不上传。
   * 安卓调系统相机拍摄时原画通常已由相机应用入库;iOS 网页内拍摄默认不进相册,
   * 这里弹一步系统分享/存储(用户已确认接受), 不支持分享时退化为下载保存。
   */
  async function keepOriginal(file: File): Promise<void> {
    try {
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
    } catch {
      /* 用户取消分享/保存不算错误, 不阻断上墙 */
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

  async function onPick(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const original = input.files?.[0];
    input.value = ''; // 复位, 允许连续拍摄同一张图
    if (!original) return;
    busy.value = true;
    let oldId: number | null = null;
    try {
      await keepOriginal(original);
      const led = await compressForLed(original);
      const cur = await fetchSystemBranding().catch(() => null);
      oldId = cur?.welcomePhotoMediaId ?? null;
      const media = await mediaService.upload(led, { remark: 'welcome-photo' });
      await saveWelcomeConfig({ welcomePhotoMediaId: media.id });
      await gotoWelcomePage();
      if (oldId && oldId !== media.id) {
        // 只保留最新一张: 删除走后端可恢复删除, 不是物理清除
        await mediaService.remove(oldId).catch(() => undefined);
      }
      toast.success('照片已上墙，大屏已切到欢迎页');
      hasPhoto.value = true;
    } catch (e) {
      console.error('welcome photo upload failed', e);
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
      toast.info('已撤下照片，恢复默认欢迎页');
      hasPhoto.value = false;
    } catch {
      toast.error('撤下失败，请重试');
    } finally {
      busy.value = false;
    }
  }

  return { fileInput, busy, hasPhoto, openCamera, onPick, takeDown, loadCurrent };
}
