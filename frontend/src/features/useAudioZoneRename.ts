import { onActivated, onDeactivated, onScopeDispose, ref, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { audioConfigService } from '@/services/audio-config.service';
import { captureIdentityGuard, onIdentityChange } from '@/services/identity-boundary';

type ZoneRow = { dbId: number; name: string; configRevision: number };
/** The backend synchronizes a stereo pair atomically; never send a second rename request. */
export function useAudioZoneRename<T extends ZoneRow>(rows: Ref<T[]>, ensureAdmin: (what?: string) => Promise<boolean>, isStereo: (row: T) => boolean) {
  const editingCh = ref<number | null>(null), editingChText = ref('');
  let active = true, disposed = false, saving = false, epoch = 0;
  const capture = () => { const expected = epoch; return captureIdentityGuard(() => active && !disposed && epoch === expected); };
  const reset = () => { epoch += 1; saving = false; editingCh.value = null; editingChText.value = ''; };
  const unsubscribe = onIdentityChange(reset);
  onDeactivated(() => { active = false; reset(); });
  onActivated(() => { active = true; });
  onScopeDispose(() => { disposed = true; reset(); unsubscribe(); });

  async function startRenameCh(row: T): Promise<void> {
    if (saving) return;
    epoch += 1;
    editingCh.value = null;
    const current = capture();
    if (!current() || !(await ensureAdmin('通道改名')) || !current()) return;
    try {
      const latest = await audioConfigService.listZones(true, true);
      if (!current()) return;
      const selected = latest.find(item => item.id === row.dbId);
      if (!selected || !Number.isSafeInteger(selected.configRevision) || selected.configRevision < 1) throw new Error('未取得有效版本，请先更新后端或重新加载');
      for (const item of latest) {
        const target = rows.value.find(value => value.dbId === item.id);
        if (target) { target.name = item.name; target.configRevision = item.configRevision; }
      }
      editingCh.value = row.dbId;
      editingChText.value = isStereo(row) ? row.name.slice(0, -2) : row.name;
    } catch (error) { if (current()) ElMessage.error(`读取通道失败: ${(error as Error).message}`); }
  }
  async function commitRenameCh(row: T): Promise<void> {
    if (saving || editingCh.value !== row.dbId) return;
    const raw = editingChText.value.trim(), current = capture();
    if (!current()) return;
    editingCh.value = null;
    if (!raw) return;
    saving = true;
    try {
      const saved = await audioConfigService.updateZone(row.dbId, { name: raw, expectedRevision: row.configRevision });
      if (!current()) return;
      for (const item of [saved, saved.pairedZone]) {
        if (!item) continue;
        const target = rows.value.find(value => value.dbId === item.id);
        if (target) { target.name = item.name; target.configRevision = item.configRevision; }
      }
      ElMessage.success(`已改名为「${raw}」${saved.pairedZone ? ' (左/右两路已同步)' : ''}`);
    } catch (error) {
      if (current()) ElMessage.error(`改名未确认，原名称保留；请重新打开编辑以核对最新版本: ${(error as Error).message}`);
    } finally { if (current()) saving = false; }
  }
  return { editingCh, editingChText, startRenameCh, commitRenameCh };
}
