import { onScopeDispose, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { captureIdentityGuard, createLatestIdentityRead, onIdentityChange } from '@/services/identity-boundary';
import { buildDefaultDoc, fetchParkOpsMetricsSnapshot, saveParkOpsMetrics,
  type ParkOpsMetricsDoc } from '@/services/park-ops-metrics.service';

/** Owns the editor's read/write version. Never manufacture revision 0 after a network failure. */
export function useParkOpsMetricsEditor(options: {
  fill: (document: ParkOpsMetricsDoc) => void;
  collect: () => ParkOpsMetricsDoc;
  clear: () => void;
}) {
  const loading = ref(true);
  const saving = ref(false);
  const revision = ref<number | null>(null);
  const needsReload = ref(false);
  let disposed = false;
  const beginRead = createLatestIdentityRead(() => !disposed);
  const unsubscribe = onIdentityChange(() => {
    revision.value = null; needsReload.value = true; loading.value = false; saving.value = false;
    options.clear();
  });
  onScopeDispose(() => { disposed = true; unsubscribe(); });

  async function load(): Promise<void> {
    if (disposed || saving.value) return;
    const isCurrent = beginRead();
    loading.value = true;
    revision.value = null;
    try {
      const snapshot = await fetchParkOpsMetricsSnapshot();
      if (!isCurrent()) return;
      if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) throw new Error('服务端版本信息无效');
      options.fill(snapshot.document ?? buildDefaultDoc());
      revision.value = snapshot.revision;
      needsReload.value = false;
      if (!snapshot.document) ElMessage.info('尚未发布过运营数据，已载入出厂默认值，修改后点「保存并发布」。');
    } catch (error) {
      if (isCurrent()) {
        needsReload.value = true;
        ElMessage.error(`读取失败，已禁止发布以保护服务端数据：${(error as Error).message}`);
      }
    } finally { if (isCurrent()) loading.value = false; }
  }

  async function save(): Promise<void> {
    if (disposed || loading.value || saving.value || revision.value === null || needsReload.value) return;
    const isCurrent = captureIdentityGuard(() => !disposed);
    const expectedRevision = revision.value;
    let document: ParkOpsMetricsDoc;
    try { document = options.collect(); }
    catch (error) { ElMessage.error((error as Error).message); return; }
    saving.value = true;
    try {
      const saved = await saveParkOpsMetrics(document, expectedRevision);
      if (!isCurrent()) return;
      if (!Number.isSafeInteger(saved.revision) || saved.revision < expectedRevision) {
        needsReload.value = true;
        throw new Error('保存结果版本无效，请重新载入核实');
      }
      revision.value = saved.revision;
      ElMessage.success('已发布，运营大屏约 15 秒内自动更新（或点强制刷新立即生效）。');
    } catch (error) {
      if (!isCurrent()) return;
      if ((error as { status?: number }).status === 409) {
        needsReload.value = true;
        ElMessage.error('其他管理员已更新数据；当前表单已保留。请先复制需要保留的内容，再重新载入最新版本。');
      } else ElMessage.error(`发布失败：${(error as Error).message || '请检查管理员登录状态'}`);
    } finally { if (isCurrent()) saving.value = false; }
  }
  return { loading, saving, revision, needsReload, load, save };
}
