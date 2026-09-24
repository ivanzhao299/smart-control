import { computed, onScopeDispose, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { mediaService } from '@/services/media.service';
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
    try {
      await mediaService.upload(file, {
        onProgress: (progress) => {
          if (active()) uploadPct.value = progress;
        },
      });
      if (!active()) return;
      ElMessage.success(`上传成功: ${file.name}`);
      await options.refresh();
    } catch (error) {
      if (active()) ElMessage.error(`上传失败 ${file.name}: ${(error as Error).message}`);
    } finally {
      uploading.value = false;
      uploadPct.value = 0;
      uploadName.value = '';
      uploadStartAt.value = 0;
    }
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
    const valid: File[] = [];
    for (const file of rawFiles) {
      if (!isAllowedMediaFile(file)) {
        if (file.size > 0) ElMessage.warning(`已跳过: ${file.name} (类型不支持)`);
        continue;
      }
      if (file.size > UPLOAD_MAX_GB * 1024 * 1024 * 1024) {
        ElMessage.error(`已跳过: ${file.name} (超过 ${UPLOAD_MAX_GB}GB 上限)`);
        continue;
      }
      valid.push(file);
    }
    if (valid.length === 0) return;

    if (valid.length === 1 && valid[0].size > LARGE_FILE_BYTES) {
      const file = valid[0];
      const estimatedMinutes = Math.ceil(file.size / (10 * 1024 * 1024) / 60);
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
  };
}
