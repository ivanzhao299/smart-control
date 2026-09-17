import { onActivated, onDeactivated, onScopeDispose, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { captureIdentityGuard, onIdentityChange } from '@/services/identity-boundary';
import { powerCircuitsService as service, type PowerCircuitView } from '@/services/power-circuits.service';

export function usePowerCircuitRename(rows: Ref<PowerCircuitView[]>, ensureAdmin: (what?: string) => Promise<boolean>) {
  const renamingId = ref<number | null>(null), renameDraft = ref(''), renameNeedsReload = ref(false);
  let revision: number | null = null, active = true, disposed = false, busy = false, epoch = 0;
  const guard = () => { const value = epoch; return captureIdentityGuard(() => active && !disposed && epoch === value); };
  const reset = () => { epoch++; busy = false; renamingId.value = null; revision = null; renameDraft.value = ''; renameNeedsReload.value = false; };
  const unsubscribe = onIdentityChange(reset);
  onDeactivated(() => { active = false; reset(); }); onActivated(() => { active = true; });
  onScopeDispose(() => { disposed = true; reset(); unsubscribe(); });
  async function startRename(row: PowerCircuitView): Promise<void> {
    if (busy) return;
    const confirmGuard = guard();
    if (renamingId.value !== null) {
      try { await ElMessageBox.confirm('重新编辑会替换当前改名草稿，确定继续？', '重新读取名称'); } catch { return; }
      if (!confirmGuard()) return;
    }
    epoch++; const live = guard();
    if (!live() || !(await ensureAdmin('电源配置改名')) || !live()) return;
    busy = true;
    try {
      const current = await service.configuration(row.id);
      if (!live()) return;
      if (!Number.isSafeInteger(current.configRevision) || current.configRevision < 1) throw new Error('未取得配置版本');
      const target = rows.value.find(item => item.id === row.id);
      if (target && !(target.configRevision > current.configRevision)) Object.assign(target, current); // Metadata only; retain the current reading.
      revision = current.configRevision; renamingId.value = row.id; renameDraft.value = current.name; renameNeedsReload.value = false;
    } catch (error) { if (live()) { renameNeedsReload.value = true; ElMessage.error(`读取名称失败: ${(error as Error).message}`); } }
    finally { if (live()) busy = false; }
  }
  async function commitRename(row: PowerCircuitView): Promise<void> {
    if (busy || renameNeedsReload.value || renamingId.value !== row.id || revision === null) return;
    const live = guard(), name = renameDraft.value.trim(), expectedRevision = revision;
    if (!live() || !name) return;
    busy = true;
    try {
      const saved = await service.rename(row.id, name, expectedRevision);
      if (!live()) return;
      if (saved.id !== row.id || !Number.isSafeInteger(saved.configRevision) || saved.configRevision < expectedRevision) throw new Error('保存版本无效');
      const target = rows.value.find(item => item.id === row.id);
      if (target && !(target.configRevision > saved.configRevision)) Object.assign(target, saved);
      revision = saved.configRevision;
      if (renameDraft.value.trim() === name) renamingId.value = null;
      ElMessage.success('名称已保存，未改变通断状态');
    } catch (error) {
      if (live()) { renameNeedsReload.value = true; ElMessage.error(`改名未确认，草稿已保留，请重新读取: ${(error as Error).message}`); }
    } finally { if (live()) busy = false; }
  }
  return { renamingId, renameDraft, renameNeedsReload, startRename, commitRename, cancelRename: reset };
}
