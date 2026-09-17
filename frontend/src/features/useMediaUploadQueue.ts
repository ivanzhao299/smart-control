import { computed, onScopeDispose, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { mediaService } from '@/services/media.service';
import { captureIdentityGuard, onIdentityChange } from '@/services/identity-boundary';
import { formatMediaSize, isAllowedMediaFile } from './media-file-intake';

const UPLOAD_MAX_GB = 10;

/** Owns the batch, progress and confirmation lifecycle; file input/drop UI stays in the page. */
export function useMediaUploadQueue(options: { canUpload: () => boolean; onUploaded: () => Promise<void> }) {
  const uploading = ref(false);
  const uploadPct = ref(0);
  const uploadName = ref('');
  const uploadStartAt = ref(0);
  const uploadBatchTotal = ref(0);
  const uploadBatchDone = ref(0);
  const queue: File[] = [];
  let disposed = false;
  let processing = false;
  let revision = 0;

  const uploadEta = computed(() => {
    if (!uploading.value || uploadPct.value === 0 || !uploadStartAt.value) return '';
    if (uploadPct.value >= 100) return '收尾...';
    const elapsed = Date.now() - uploadStartAt.value;
    const remaining = elapsed / uploadPct.value * 100 - elapsed;
    return remaining < 60_000 ? `剩约 ${Math.ceil(remaining / 1000)}秒` : `剩约 ${Math.ceil(remaining / 60_000)}分钟`;
  });

  function reset(): void {
    revision++;
    queue.length = 0;
    processing = false;
    uploading.value = false;
    uploadPct.value = 0;
    uploadName.value = '';
    uploadStartAt.value = 0;
    uploadBatchTotal.value = 0;
    uploadBatchDone.value = 0;
  }
  const unsubscribe = onIdentityChange(reset);
  onScopeDispose(() => { disposed = true; reset(); unsubscribe(); });

  async function drain(): Promise<void> {
    processing = true;
    const run = revision;
    const isCurrent = captureIdentityGuard(() => !disposed && run === revision && options.canUpload());
    try {
      while (isCurrent() && queue.length) {
        const file = queue[0];
        uploading.value = true;
        uploadPct.value = 0;
        uploadName.value = file.name;
        uploadStartAt.value = Date.now();
        try {
          await mediaService.upload(file, { onProgress: pct => { if (isCurrent()) uploadPct.value = pct; } });
          if (!isCurrent()) return;
          ElMessage.success(`上传成功: ${file.name}`);
          await options.onUploaded();
        } catch (error) {
          if (!isCurrent()) return;
          ElMessage.error(`上传失败 ${file.name}: ${(error as Error).message}`);
        }
        if (!isCurrent()) return;
        queue.shift();
        uploadBatchDone.value++;
      }
    } finally {
      // A prior account's late completion must not clear a new account's batch.
      if (run === revision) reset();
    }
  }

  async function queueFiles(rawFiles: File[]): Promise<void> {
    if (disposed || !options.canUpload()) return;
    const isCurrent = captureIdentityGuard(() => !disposed && options.canUpload());
    const valid: File[] = [];
    for (const file of rawFiles) {
      if (!isAllowedMediaFile(file)) {
        if (file.size > 0) ElMessage.warning(`已跳过: ${file.name} (类型不支持)`);
      } else if (file.size > UPLOAD_MAX_GB * 1024 ** 3) {
        ElMessage.error(`已跳过: ${file.name} (超过 ${UPLOAD_MAX_GB}GB 上限)`);
      } else valid.push(file);
    }
    if (!valid.length) return;
    if (valid.length === 1 && valid[0].size > 500 * 1024 ** 2) {
      const file = valid[0];
      const minutes = Math.ceil(file.size / (10 * 1024 ** 2) / 60);
      try {
        await ElMessageBox.confirm(
          `文件 ${file.name} (${formatMediaSize(file.size)}) 较大, 预估 ${minutes} 分钟. 上传期间请保持页面打开. 继续?`,
          '大文件上传', { type: 'info', confirmButtonText: '开始上传', cancelButtonText: '取消' },
        );
      } catch { return; }
    }
    if (!isCurrent()) return;
    queue.push(...valid);
    uploadBatchTotal.value += valid.length;
    if (!processing) void drain();
  }

  return { uploading, uploadPct, uploadName, uploadEta, uploadBatchTotal, uploadBatchDone, queueFiles };
}
