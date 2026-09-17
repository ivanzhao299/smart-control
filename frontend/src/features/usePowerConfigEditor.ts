import { computed, onScopeDispose, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { captureIdentityGuard, onIdentityChange } from '@/services/identity-boundary';
import { powerCircuitsService as service, type PowerCircuitConfigView, type PowerCircuitUpsertDto } from '@/services/power-circuits.service';

const defaults = (): PowerCircuitUpsertDto => ({ code: '', name: '', floor: '1F', category: 'misc',
  gatewayCode: null, relayChannel: null, meterAddress: null, ratedVoltage: 220, ratedCurrent: 16,
  ratedPower: 0, sortOrder: 100, icon: 'Zap', description: null, enabled: true });
const validVersion = (row: PowerCircuitConfigView) => Number.isSafeInteger(row?.configRevision) && row.configRevision > 0;
const draftOf = (row: PowerCircuitConfigView) => Object.fromEntries(Object.keys(defaults()).map(key =>
  [key, row[key as keyof PowerCircuitConfigView]])) as unknown as PowerCircuitUpsertDto;

/** Metadata editor; no configuration operation reads or operates physical switches. */
export function usePowerConfigEditor() {
  const list = ref<PowerCircuitConfigView[]>([]), loading = ref(false), saving = ref(false), needsReload = ref(true);
  const editVisible = ref(false), editingId = ref<number | null>(null), expectedRevision = ref<number | null>(null);
  const form = reactive(defaults()), editMode = computed(() => editingId.value === null ? 'create' : 'edit');
  let disposed = false, epoch = 0;
  const current = () => { const value = epoch; return captureIdentityGuard(() => !disposed && epoch === value); };
  const blocked = () => disposed || loading.value || saving.value || needsReload.value;
  const replace = (row: PowerCircuitConfigView) => {
    const index = list.value.findIndex(item => item.id === row.id);
    if (index < 0) list.value.push(row); else list.value[index] = row;
  };
  const unsubscribe = onIdentityChange(() => {
    epoch++; list.value = []; editVisible.value = false; expectedRevision.value = null;
    needsReload.value = true; loading.value = false; saving.value = false; Object.assign(form, defaults());
  });
  onScopeDispose(() => { disposed = true; epoch++; unsubscribe(); });

  async function refresh(): Promise<void> {
    if (disposed || saving.value || loading.value) return;
    const live = current();
    if (editVisible.value) {
      try { await ElMessageBox.confirm('重新读取会替换当前未保存的配置草稿，确定继续？', '重新读取', { confirmButtonText: '重新读取', cancelButtonText: '取消' }); }
      catch { return; }
      if (!live() || saving.value || loading.value) return;
    }
    const draft = JSON.stringify(form), id = editingId.value;
    loading.value = true; needsReload.value = true;
    try {
      const rows = await service.configurationList();
      if (!live()) return;
      if (!Array.isArray(rows) || rows.some(row => !validVersion(row))) throw new Error('配置版本无效，请先更新后端');
      if (editVisible.value && JSON.stringify(form) !== draft) throw new Error('读取期间继续编辑，草稿已保留，请再次重新读取');
      list.value = rows; needsReload.value = false;
      if (editVisible.value) {
        const row = rows.find(item => item.id === id);
        if (row) { Object.assign(form, draftOf(row)); expectedRevision.value = row.configRevision; }
        else { editVisible.value = false; expectedRevision.value = null; }
      }
    } catch (error) { if (live()) ElMessage.error(`读取失败，草稿已保留并暂停保存: ${(error as Error).message}`); }
    finally { if (live()) loading.value = false; }
  }

  function openCreate(floor = '1F') {
    if (blocked()) return;
    epoch++; editingId.value = null; expectedRevision.value = null;
    Object.assign(form, defaults(), { floor }); editVisible.value = true;
  }
  function openEdit(row: PowerCircuitConfigView) {
    if (blocked() || !validVersion(row)) return;
    epoch++; editingId.value = row.id; expectedRevision.value = row.configRevision;
    Object.assign(form, draftOf(row)); editVisible.value = true;
  }
  async function submit(): Promise<void> {
    if (blocked() || !editVisible.value) return;
    const live = current(), id = editingId.value, version = expectedRevision.value;
    if (id !== null && version === null) return;
    const draft = JSON.stringify(form), payload = JSON.parse(draft) as PowerCircuitUpsertDto;
    saving.value = true;
    try {
      const saved = id === null ? await service.create(payload) : await service.update(id, { ...payload, expectedRevision: version! });
      if (!live()) return;
      if (!validVersion(saved) || (id !== null && (saved.id !== id || saved.configRevision < version!))) throw new Error('保存回执无效，请重新读取核实');
      replace(saved);
      if (!editVisible.value) return;
      editingId.value = saved.id; expectedRevision.value = saved.configRevision;
      if (JSON.stringify(form) === draft) {
        editVisible.value = false; ElMessage.success('电源配置已保存，未下发通断电命令');
      } else ElMessage.success('本次提交已保存；继续输入的内容仍为未保存草稿');
    } catch (error) {
      if (live()) { needsReload.value = true; ElMessage.error(`保存未确认，草稿已保留，请重新读取: ${(error as Error).message}`); }
    } finally { if (live()) saving.value = false; }
  }

  async function mutateRow(row: PowerCircuitConfigView, remove: boolean): Promise<void> {
    if (blocked() || !validVersion(row)) return;
    const live = current(), version = row.configRevision, id = row.id;
    if (remove) {
      try { await ElMessageBox.confirm(`删除电源配置“${row.name}”(${row.code})？不会发送断电指令。`, '确认删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }); }
      catch { return; }
      if (!live() || blocked()) return;
    }
    saving.value = true;
    try {
      if (remove) {
        await service.remove(id, version);
        if (live()) list.value = list.value.filter(item => item.id !== id);
      } else {
        const saved = await service.update(id, { enabled: !row.enabled, expectedRevision: version });
        if (live()) {
          if (!validVersion(saved) || saved.id !== id) throw new Error('保存回执无效');
          replace(saved);
        }
      }
      if (live()) ElMessage.success(remove ? '配置已删除' : '启用配置已更新，未下发设备命令');
    } catch (error) {
      if (live()) { needsReload.value = true; ElMessage.error(`修改未确认，请重新读取: ${(error as Error).message}`); }
    } finally { if (live()) saving.value = false; }
  }
  return { list, loading, saving, needsReload, editVisible, editMode, form, refresh, openCreate, openEdit, submit,
    remove: (row: PowerCircuitConfigView) => mutateRow(row, true), toggleEnabled: (row: PowerCircuitConfigView) => mutateRow(row, false) };
}
