import { computed, onScopeDispose, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { captureIdentityGuard, onIdentityChange } from '@/services/identity-boundary';
import { brandService as service, type Brand, type BrandUpsertPayload } from '@/services/brand.service';

const defaults = (): BrandUpsertPayload => ({ name: '', displayName: null, logoUrl: null, country: null,
  website: null, salesContact: null, techContact: null, remark: null, enabled: true });
const valid = (row: Brand) => Number.isSafeInteger(row?.id) && row.id > 0 && Number.isSafeInteger(row?.configRevision) && row.configRevision > 0;
const draftOf = (row: Brand) => Object.fromEntries(Object.keys(defaults()).map(key => [key, row[key as keyof Brand]])) as unknown as BrandUpsertPayload;

/** Brand metadata only: no hardware commands, no automatic retries after uncertain writes. */
export function useBrandConfigEditor() {
  const list = ref<Brand[]>([]), loading = ref(false), saving = ref(false), needsReload = ref(true);
  const editVisible = ref(false), editingId = ref<number | null>(null), expectedRevision = ref<number | null>(null);
  const form = reactive(defaults()), editMode = computed(() => editingId.value === null ? 'create' : 'edit');
  let disposed = false, epoch = 0;
  const current = () => { const captured = epoch; return captureIdentityGuard(() => !disposed && captured === epoch); };
  const blocked = () => disposed || loading.value || saving.value || needsReload.value;
  const replace = (row: Brand) => { const index = list.value.findIndex(item => item.id === row.id); if (index < 0) list.value.push(row); else list.value[index] = row; };
  const stopIdentity = onIdentityChange(() => {
    epoch++; list.value = []; editVisible.value = false; editingId.value = null; expectedRevision.value = null;
    loading.value = false; saving.value = false; needsReload.value = true; Object.assign(form, defaults());
  });
  onScopeDispose(() => { disposed = true; epoch++; stopIdentity(); });

  async function refresh() {
    if (disposed || loading.value || saving.value) return;
    const live = current();
    if (editVisible.value) {
      try { await ElMessageBox.confirm('重新读取会替换未保存的品牌草稿，确定继续？', '重新读取', { confirmButtonText: '重新读取', cancelButtonText: '取消' }); }
      catch { return; }
      if (!live() || loading.value || saving.value) return;
    }
    const draft = JSON.stringify(form), id = editingId.value;
    loading.value = true; needsReload.value = true;
    try {
      const rows = await service.list();
      if (!live()) return;
      if (!Array.isArray(rows) || rows.some(row => !valid(row))) throw new Error('品牌版本无效，请先更新后端');
      if (editVisible.value && JSON.stringify(form) !== draft) throw new Error('读取期间继续编辑，草稿已保留');
      list.value = rows;
      if (editVisible.value && id !== null) {
        const row = rows.find(item => item.id === id);
        if (!row) throw new Error('品牌已删除，草稿保留供核对；请关闭编辑后重新读取');
        Object.assign(form, draftOf(row)); expectedRevision.value = row.configRevision;
      } else if (editVisible.value) { Object.assign(form, defaults()); editVisible.value = false; }
      needsReload.value = false;
    } catch (error) { if (live()) ElMessage.error(`读取失败，暂停保存: ${(error as Error).message}`); }
    finally { if (live()) loading.value = false; }
  }
  function openCreate() {
    if (blocked() || editVisible.value) return;
    epoch++; editingId.value = null; expectedRevision.value = null; Object.assign(form, defaults()); editVisible.value = true;
  }
  function openEdit(row: Brand) {
    if (blocked() || editVisible.value || !valid(row)) return;
    epoch++; editingId.value = row.id; expectedRevision.value = row.configRevision; Object.assign(form, draftOf(row)); editVisible.value = true;
  }
  async function submit() {
    if (blocked() || !editVisible.value) return;
    if (!form.name?.trim()) { ElMessage.error('品牌标识不能为空'); return; }
    const live = current(), id = editingId.value, version = expectedRevision.value;
    if (id !== null && version === null) return;
    const draft = JSON.stringify(form), payload = JSON.parse(draft) as BrandUpsertPayload;
    saving.value = true;
    try {
      const saved = id === null ? await service.create(payload) : await service.update(id, { ...payload, expectedRevision: version! });
      if (!live()) return;
      if (!valid(saved) || (id !== null && (saved.id !== id || saved.configRevision < version!))) throw new Error('保存回执无效，请重新读取核实');
      replace(saved);
      if (!editVisible.value) return;
      editingId.value = saved.id; expectedRevision.value = saved.configRevision;
      if (JSON.stringify(form) === draft) { editVisible.value = false; ElMessage.success('品牌配置已保存'); }
      else ElMessage.success('本次提交已保存；继续输入的内容仍为未保存草稿');
    } catch (error) { if (live()) { needsReload.value = true; ElMessage.error(`保存未确认，草稿已保留，请重新读取: ${(error as Error).message}`); } }
    finally { if (live()) saving.value = false; }
  }
  async function mutateRow(row: Brand, remove: boolean) {
    if (blocked() || editVisible.value || !valid(row)) return;
    const live = current(), id = row.id, version = row.configRevision, enabled = !row.enabled;
    if (remove) {
      try { await ElMessageBox.confirm(`删除品牌“${row.name}”？引用中的品牌会被拒绝删除。`, '确认删除', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }); }
      catch { return; }
      if (!live() || blocked() || editVisible.value) return;
    }
    saving.value = true;
    try {
      if (remove) { await service.remove(id, version); if (live()) list.value = list.value.filter(item => item.id !== id); }
      else {
        const saved = await service.update(id, { enabled, expectedRevision: version });
        if (live()) { if (!valid(saved) || saved.id !== id || saved.configRevision < version) throw new Error('保存回执无效'); replace(saved); }
      }
      if (live()) ElMessage.success(remove ? '品牌已删除' : '品牌状态已更新');
    } catch (error) { if (live()) { needsReload.value = true; ElMessage.error(`修改未确认，请重新读取: ${(error as Error).message}`); } }
    finally { if (live()) saving.value = false; }
  }
  return { list, loading, saving, needsReload, editVisible, editMode, expectedRevision, form, refresh, openCreate, openEdit, submit,
    remove: (row: Brand) => mutateRow(row, true), toggleEnabled: (row: Brand) => mutateRow(row, false) };
}
