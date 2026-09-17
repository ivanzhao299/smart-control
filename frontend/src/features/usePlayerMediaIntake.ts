import { ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { mediaService } from '@/services/media.service';
import { addToPlaylist } from '@/services/playback.service';

/** Upload and webpage creation never implicitly start playback or switch target screens. */
export function usePlayerMediaIntake(options: {
  slot: () => 1 | 2;
  captureAction: () => (() => boolean);
  reload: () => Promise<void>;
}) {
  const fileInput = ref<HTMLInputElement | null>(null);
  const uploading = ref(false);
  const uploadPct = ref(0);
  const webpageDialog = ref(false);
  const webpageBusy = ref(false);
  const webpageForm = ref({ name: '', url: '' });

  function pickFile(): void { fileInput.value?.click(); }
  function openWebpageDialog(): void {
    if (webpageBusy.value) return;
    webpageForm.value = { name: '', url: '' };
    webpageDialog.value = true;
  }

  async function onFilePicked(event: Event): Promise<void> {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    target.value = '';
    if (!file || uploading.value) return;
    const isCurrent = options.captureAction();
    const slot = options.slot();
    if (!isCurrent()) return;
    uploading.value = true;
    uploadPct.value = 0;
    try {
      const item = await mediaService.upload(file, { onProgress: value => { if (isCurrent()) uploadPct.value = value; } });
      if (!isCurrent()) return;
      try {
        await ElMessageBox.confirm(`「${item.originalName}」已上传到媒体库。要现在加入播放列表吗?`, '上传完成',
          { confirmButtonText: '加入播放列表', cancelButtonText: '只放媒体库', type: 'success' });
      } catch {
        if (isCurrent()) ElMessage.info('已保存到媒体库 (未加入播放列表)');
        return;
      }
      if (!isCurrent()) return;
      try {
        await addToPlaylist(slot, item.id);
      } catch (error) {
        if (isCurrent()) ElMessage.error(`媒体已保存，但加入播放列表失败: ${(error as Error).message}`);
        return;
      }
      if (!isCurrent()) return;
      await options.reload();
      if (isCurrent()) ElMessage.success('已加入播放列表');
    } catch (error) {
      if (isCurrent()) ElMessage.error(`上传失败: ${(error as Error).message}`);
    } finally { uploading.value = false; }
  }

  async function submitWebpage(): Promise<void> {
    if (webpageBusy.value) return;
    const url = webpageForm.value.url.trim();
    if (!/^https?:\/\//i.test(url)) { ElMessage.warning('网址要以 http:// 或 https:// 开头'); return; }
    const isCurrent = options.captureAction();
    const slot = options.slot();
    if (!isCurrent()) return;
    webpageBusy.value = true;
    try {
      const item = await mediaService.createWebpage(webpageForm.value.name.trim() || url, url);
      if (!isCurrent()) return;
      await addToPlaylist(slot, item.id);
      if (!isCurrent()) return;
      await options.reload();
      if (!isCurrent()) return;
      webpageDialog.value = false;
      ElMessage.success(`「${item.originalName}」已加入播放列表`);
    } catch (error) {
      if (isCurrent()) ElMessage.error(`添加失败: ${(error as Error).message}`);
    } finally { webpageBusy.value = false; }
  }

  return { fileInput, uploading, uploadPct, pickFile, onFilePicked,
    webpageDialog, webpageForm, webpageBusy, openWebpageDialog, submitWebpage };
}
