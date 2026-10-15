import { computed, onScopeDispose, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import axios from 'axios';
import { mediaService } from '@/services/media.service';
import { isDirectLocalConnection, notifyUnauthorized } from '@/services/http';
import { beginUploadKeepAlive, endUploadKeepAlive } from '@/services/upload-keepalive';
import {
  collectFilesFromEntry,
  formatMediaSize,
  isAllowedMediaFile,
} from '@/features/media-file-intake';

interface MediaUploadQueueOptions {
  canOperate: Readonly<Ref<boolean>>;
  refresh: () => Promise<void>;
  isDisposed?: () => boolean;
}

const UPLOAD_MAX_GB = 10;
const LARGE_FILE_BYTES = 500 * 1024 * 1024;

export function useMediaUploadQueue(options: MediaUploadQueueOptions) {
  const uploading = ref(false);
  const uploadPct = ref(0);
  const uploadName = ref('');
  const uploadStartAt = ref(0);
  const uploadQueue = ref<File[]>([]);
  const uploadBatchTotal = ref(0);
  const uploadBatchDone = ref(0);
  const isDragging = ref(false);
  let processingQueue = false;
  let disposed = false;
  let uploadController: AbortController | null = null;

  const uploadEta = computed(() => {
    if (!uploading.value || uploadPct.value === 0 || !uploadStartAt.value) return '';
    const elapsedMs = Date.now() - uploadStartAt.value;
    const remainPct = 100 - uploadPct.value;
    if (remainPct <= 0) return '收尾...';
    const totalMs = elapsedMs / uploadPct.value * 100;
    const remainMs = totalMs - elapsedMs;
    if (remainMs < 60_000) return `剩约 ${Math.ceil(remainMs / 1000)}秒`;
    return `剩约 ${Math.ceil(remainMs / 60_000)}分钟`;
  });

  function active(): boolean {
    return !disposed && !options.isDisposed?.() && options.canOperate.value;
  }

  onScopeDispose(() => {
    disposed = true;
    isDragging.value = false;
    uploadQueue.value = [];
  });

  async function uploadOne(file: File): Promise<void> {
    uploading.value = true;
    uploadPct.value = 0;
    uploadName.value = file.name;
    uploadStartAt.value = Date.now();
    beginUploadKeepAlive(); // Wake Lock 防锁屏 + 标记上传活跃（全局 401 不立即踢）
    uploadController = new AbortController();
    try {
      await mediaService.upload(file, {
        signal: uploadController.signal,
        onProgress: (progress) => {
          if (active()) uploadPct.value = progress;
        },
      });
      if (!active()) return;
      ElMessage.success(`上传成功: ${file.name}`);
      await options.refresh();
    } catch (error) {
      // 用户主动取消: 不报错, 只提示。兼容 axios CanceledError、XHR abort 标记与原生 AbortError。
      const err = error as { name?: string; __CANCEL__?: boolean };
      const isAbort =
        axios.isCancel(error) ||
        err?.__CANCEL__ === true ||
        err?.name === 'CanceledError' ||
        err?.name === 'AbortError';
      if (isAbort) {
        if (active()) ElMessage.info(`已取消上传: ${file.name}`);
        return;
      }
      // 上传请求自身 401 = 令牌真失效：先解除保活（计数清零），再走全局兜底回登录页。
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        await endUploadKeepAlive();
        notifyUnauthorized();
        return;
      }
      if (active()) ElMessage.error(`上传失败 ${file.name}: ${(error as Error).message}`);
    } finally {
      await endUploadKeepAlive();
      uploadController = null;
      uploading.value = false;
      uploadPct.value = 0;
      uploadName.value = '';
      uploadStartAt.value = 0;
    }
  }

  /** 用户点"取消上传": 立即中止当前上传请求、清空剩余队列、即时复位进度 UI */
  function cancelUpload(): void {
    try { uploadController?.abort(); } catch { /* ignore */ }
    uploadQueue.value = [];
    // 立即给用户反馈, 不必等 XHR onabort 回调绕一圈; uploadOne 的 finally 会再次幂等复位。
    uploadPct.value = 0;
    uploadName.value = '';
    uploadStartAt.value = 0;
    uploading.value = false;
  }

  async function startQueue(): Promise<void> {
    if (processingQueue) return;
    processingQueue = true;
    try {
      while (active() && uploadQueue.value.length > 0) {
        const file = uploadQueue.value[0];
        await uploadOne(file);
        uploadQueue.value.shift();
        uploadBatchDone.value += 1;
      }
      if (!active()) uploadQueue.value = [];
    } finally {
      processingQueue = false;
      uploadBatchTotal.value = 0;
      uploadBatchDone.value = 0;
    }
  }

  async function queueFiles(rawFiles: File[]): Promise<void> {
    if (!active()) return;
    // 局域网/本机直连后端(5173->3200): 走局域网高速、不经 Nginx/隧道, 不限文件大小。
    // 公网(经 Nginx): 受 Nginx client_max_body_size 与后端 MEDIA_MAX_BYTES 约束, 保留 10GB 上限。
    const direct = isDirectLocalConnection();
    const valid: File[] = [];
    for (const file of rawFiles) {
      if (!isAllowedMediaFile(file)) {
        if (file.size > 0) ElMessage.warning(`已跳过: ${file.name} (类型不支持)`);
        continue;
      }
      if (!direct && file.size > UPLOAD_MAX_GB * 1024 * 1024 * 1024) {
        ElMessage.error(`已跳过: ${file.name} (超过 ${UPLOAD_MAX_GB}GB 上限)`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length === 0) return;

    if (valid.length === 1 && valid[0].size > LARGE_FILE_BYTES) {
      const file = valid[0];
      // 本地直连按局域网约 60MB/s 估算, 公网按隧道约 10MB/s 估算。
      const estBytesPerSec = direct ? 60 * 1024 * 1024 : 10 * 1024 * 1024;
      const estimatedMinutes = Math.ceil(file.size / estBytesPerSec / 60);
      try {
        await ElMessageBox.confirm(
          `文件 ${file.name} (${formatMediaSize(file.size)}) 较大, 预估 ${estimatedMinutes} 分钟. 上传期间请保持页面打开. 继续?`,
          '大文件上传',
          { type: 'info', confirmButtonText: '开始上传', cancelButtonText: '取消' },
        );
      } catch { return; }
    }

    if (!active()) return;
    const wasIdle = !processingQueue;
    uploadQueue.value.push(...valid);
    if (wasIdle) {
      uploadBatchTotal.value = valid.length;
      uploadBatchDone.value = 0;
      void startQueue();
    } else {
      uploadBatchTotal.value += valid.length;
    }
  }

  function onFileInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) void queueFiles(Array.from(target.files));
    target.value = '';
  }

  function onDragEnter(event: DragEvent): void {
    event.preventDefault();
    isDragging.value = true;
  }

  function onDragLeave(event: DragEvent): void {
    event.preventDefault();
    isDragging.value = false;
  }

  function onDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  async function onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    isDragging.value = false;
    const transferItems = event.dataTransfer?.items;
    if (transferItems && transferItems.length > 0) {
      const entries: FileSystemEntry[] = [];
      for (let index = 0; index < transferItems.length; index += 1) {
        const entry = transferItems[index].webkitGetAsEntry?.();
        if (entry) entries.push(entry);
      }
      if (entries.length > 0) {
        const files = (await Promise.all(entries.map(collectFilesFromEntry))).flat();
        if (files.length > 0) {
          await queueFiles(files);
          return;
        }
      }
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) await queueFiles(files);
  }

  return {
    uploading,
    uploadPct,
    uploadName,
    uploadStartAt,
    uploadQueue,
    uploadBatchTotal,
    uploadBatchDone,
    uploadEta,
    isDragging,
    queueFiles,
    onFileInput,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    cancelUpload,
  };
}
