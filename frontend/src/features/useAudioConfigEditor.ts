import { computed, onScopeDispose, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { captureIdentityGuard, createLatestIdentityRead, onIdentityChange } from '@/services/identity-boundary';
import { audioConfigService, parseSceneContent, type AudioOutputZone, type AudioInputSource, type AudioScene, type SceneContent } from '@/services/audio-config.service';

type CatalogRow = AudioOutputZone | AudioInputSource | AudioScene;
interface EditorRow { ch: number; name: string; inputs: number[]; volume: number; muted: boolean }
const hasRevision = (row: { configRevision?: number }) => Number.isSafeInteger(row.configRevision) && row.configRevision! >= 1;
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** Versioned drafts; never edit shared query-cache objects or replay old-identity saves. */
export function useAudioConfigEditor() {
  const zones = ref<AudioOutputZone[]>([]), inputs = ref<AudioInputSource[]>([]), scenes = ref<AudioScene[]>([]);
  const loading = ref(false), needsReload = ref(true), savingId = ref<string | null>(null);
  const editorVisible = ref(false), editingScene = ref<AudioScene | null>(null), editorRows = ref<EditorRow[]>([]);
  const applying = ref(false), savingContent = ref(false);
  const busy = computed(() => loading.value || savingId.value !== null || applying.value || savingContent.value);
  const enabledInputs = computed(() => inputs.value.filter(row => row.enabled).sort((a, b) => a.sortOrder - b.sortOrder || a.channel - b.channel));
  const originals = new Map<string, CatalogRow>();
  let disposed = false;
  const capture = () => captureIdentityGuard(() => !disposed);
  const beginRead = createLatestIdentityRead(() => !disposed);
  const canSave = (row: CatalogRow) => !disposed && !busy.value && !needsReload.value && hasRevision(row);
  const clear = () => {
    zones.value = []; inputs.value = []; scenes.value = []; originals.clear();
    editorVisible.value = false; editingScene.value = null; editorRows.value = [];
    needsReload.value = true; loading.value = false; savingId.value = null; applying.value = false; savingContent.value = false;
  };
  const unsubscribe = onIdentityChange(clear);
  onScopeDispose(() => { disposed = true; unsubscribe(); });

  async function refresh(confirm = true): Promise<void> {
    if (disposed || busy.value) return;
    const current = capture();
    if (confirm && (zones.value.length || inputs.value.length || scenes.value.length)) {
      try { await ElMessageBox.confirm('重新载入会丢弃尚未保存的编辑。请先复制需要保留的草稿。', '重新载入音响配置', { confirmButtonText: '重新载入', cancelButtonText: '取消', type: 'warning' }); }
      catch { return; }
      if (!current() || busy.value) return;
    }
    const latest = beginRead();
    loading.value = true; needsReload.value = true;
    try {
      const [nextZones, nextInputs, nextScenes] = await Promise.all([
        audioConfigService.listZones(true, true), audioConfigService.listInputs(true, true), audioConfigService.listScenes(true, true),
      ]);
      if (!latest()) return;
      if (![...nextZones, ...nextInputs, ...nextScenes].every(hasRevision)) throw new Error('服务端尚未提供有效版本，请先更新后端');
      zones.value = nextZones.map(row => ({ ...row })); inputs.value = nextInputs.map(row => ({ ...row })); scenes.value = nextScenes.map(row => ({ ...row }));
      originals.clear();
      for (const [prefix, rows] of [['z', zones.value], ['i', inputs.value], ['s', scenes.value]] as const) for (const row of rows) originals.set(prefix + row.id, { ...row });
      editorVisible.value = false; editingScene.value = null; editorRows.value = [];
      needsReload.value = false;
    } catch (error) { if (latest()) ElMessage.error(`读取失败，已暂停保存：${(error as Error).message}`); }
    finally { if (latest()) loading.value = false; }
  }

  function failed(error: unknown, operation: string): void {
    if ((error as { status?: number }).status === 409) {
      needsReload.value = true;
      ElMessage.error('其他管理员已更新配置；草稿已保留。请先复制需要保留的内容，再重新载入。');
    } else ElMessage.error(`${operation}失败: ${(error as Error).message}`);
  }

  /** Keep edits typed while awaiting a save; the returned revision is for the confirmed snapshot. */
  function mergeSaved<T extends CatalogRow>(key: string, row: T, sent: T, saved: T): void {
    if (!hasRevision(saved) || saved.configRevision < sent.configRevision) { needsReload.value = true; throw new Error('保存回执版本无效，请重新载入核实'); }
    for (const field of Object.keys(saved) as Array<keyof T>) {
      if (field === 'configRevision' || same(row[field], sent[field])) row[field] = saved[field];
    }
    originals.set(key, { ...saved });
  }

  async function saveZone(row: AudioOutputZone): Promise<void> {
    if (!canSave(row)) return;
    const current = capture(), sent = { ...row };
    savingId.value = 'z' + row.id;
    try {
      const { pairedZone, ...saved } = await audioConfigService.updateZone(row.id, { name: sent.name, floor: sent.floor, color: sent.color, enabled: sent.enabled, sortOrder: sent.sortOrder, expectedRevision: sent.configRevision });
      if (!current()) return;
      mergeSaved('z' + row.id, row, sent, saved);
      if (pairedZone) {
        const partner = zones.value.find(item => item.id === pairedZone.id);
        if (partner) {
          if (same(partner, originals.get('z' + partner.id))) {
            Object.assign(partner, pairedZone); originals.set('z' + partner.id, { ...pairedZone });
          } else { needsReload.value = true; ElMessage.info('另一声道已同步，未保存的对侧草稿仍保留；请重新载入后继续编辑。'); }
        }
      }
      ElMessage.success(`已保存 OUT${saved.channel + 1}: ${saved.name}`);
    } catch (error) { if (current()) failed(error, '保存'); }
    finally { if (current()) savingId.value = null; }
  }

  async function saveInput(row: AudioInputSource): Promise<void> {
    if (!canSave(row)) return;
    const current = capture(), sent = { ...row };
    savingId.value = 'i' + row.id;
    try {
      const saved = await audioConfigService.updateInput(row.id, { name: sent.name, color: sent.color, enabled: sent.enabled, sortOrder: sent.sortOrder, expectedRevision: sent.configRevision });
      if (!current()) return;
      mergeSaved('i' + row.id, row, sent, saved); ElMessage.success(`已保存 IN${saved.channel + 1}: ${saved.name}`);
    } catch (error) { if (current()) failed(error, '保存'); }
    finally { if (current()) savingId.value = null; }
  }

  async function saveScene(row: AudioScene): Promise<void> {
    if (!canSave(row)) return;
    const current = capture(), sent = { ...row };
    savingId.value = 's' + row.id;
    try {
      const saved = await audioConfigService.updateScene(row.id, { name: sent.name, hint: sent.hint, enabled: sent.enabled, sortOrder: sent.sortOrder, expectedRevision: sent.configRevision });
      if (!current()) return;
      mergeSaved('s' + row.id, row, sent, saved); ElMessage.success(`已保存 U${String(saved.presetNum).padStart(2, '0')}: ${saved.name}`);
    } catch (error) { if (current()) failed(error, '保存'); }
    finally { if (current()) savingId.value = null; }
  }

  function sceneRouteCount(scene: AudioScene): number {
    return parseSceneContent(scene)?.outputs.filter(row => (row.inputs?.length ?? 0) > 0 || typeof row.volume === 'number' || typeof row.muted === 'boolean').length ?? 0;
  }
  function openEditor(scene: AudioScene): void {
    if (!canSave(scene)) return;
    editingScene.value = { ...scene }; // Opening freezes the revision for this particular draft.
    const byChannel = new Map(parseSceneContent(scene)?.outputs.map(row => [row.ch, row]) ?? []);
    editorRows.value = zones.value.filter(row => row.enabled).sort((a, b) => a.sortOrder - b.sortOrder || a.channel - b.channel).map(zone => {
      const configured = byChannel.get(zone.channel);
      return { ch: zone.channel, name: zone.name, inputs: [...(configured?.inputs ?? [])], volume: configured?.volume ?? 80, muted: configured?.muted ?? false };
    });
    editorVisible.value = true;
  }
  function toggleCell(row: EditorRow, ch: number, checked: boolean): void {
    if (checked && !row.inputs.includes(ch)) row.inputs.push(ch);
    else if (!checked) row.inputs = row.inputs.filter(value => value !== ch);
  }
  function buildContent(): SceneContent {
    const visible = new Set(editorRows.value.map(row => row.ch));
    const preserved = editingScene.value ? parseSceneContent(editingScene.value)?.outputs.filter(row => !visible.has(row.ch)) ?? [] : [];
    return { outputs: [...preserved, ...editorRows.value.map(row => ({ ch: row.ch, inputs: [...row.inputs].sort((a, b) => a - b), volume: row.volume, muted: row.muted }))] };
  }
  async function persistContent(apply: boolean): Promise<void> {
    const draft = editingScene.value;
    if (!draft || !canSave(draft)) return;
    const current = capture(), sent = { ...draft }, content = buildContent();
    applying.value = apply; savingContent.value = !apply;
    try {
      const saved = await audioConfigService.updateScene(draft.id, { content, expectedRevision: draft.configRevision });
      if (!current()) return;
      mergeSaved('s' + draft.id, draft, sent, saved);
      const listRow = scenes.value.find(row => row.id === draft.id);
      if (listRow) {
        // Route saving does not discard a separately edited name/hint in the table.
        listRow.configRevision = saved.configRevision; listRow.content = saved.content;
        originals.set('s' + draft.id, { ...saved });
      }
      if (apply) {
        if (!editorVisible.value || editingScene.value !== draft) {
          ElMessage.info('配置已保存；编辑窗口已关闭，未继续下发设备。');
          return;
        }
        const result = await audioConfigService.applyScene(saved.presetNum, saved.configRevision);
        if (!current()) return;
        if (!result.ok) throw new Error('设备未确认，配置已保存但未确认下发');
        ElMessage.success('场景配置已保存并下发到矩阵');
      } else {
        ElMessage.success('场景路由已保存');
        // Do not close over edits made while saving; leave those as the next draft.
        if (same(buildContent(), content)) editorVisible.value = false;
      }
    } catch (error) { if (current()) failed(error, apply ? '下发' : '保存'); }
    finally { if (current()) { applying.value = false; savingContent.value = false; } }
  }
  return { zones, inputs, scenes, loading, needsReload, savingId, busy, enabledInputs, editorVisible, editingScene, editorRows, applying, savingContent,
    refresh, saveZone, saveInput, saveScene, sceneRouteCount, openEditor, toggleCell, saveContent: () => persistContent(false), applyNow: () => persistContent(true) };
}
