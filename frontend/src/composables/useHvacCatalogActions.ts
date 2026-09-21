import { nextTick, onScopeDispose, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { hvacService, type HvacZone } from '@/services/hvac.service';
import { captureIdentityGuard, onIdentityChange } from '@/services/identity-boundary';
import type { HvacFloorFilter, IndoorRow } from '@/features/hvac-view-model';

type HvacCatalogService = Pick<
  typeof hvacService,
  'updateIndoor' | 'renameZone' | 'assignIndoors' | 'createZone' | 'deleteZone'
>;

interface HvacCatalogMessages {
  success(message: string): void;
  warning(message: string): void;
  error(message: string): void;
}

interface HvacCatalogActionsOptions {
  indoors: Ref<IndoorRow[]>;
  zones: Ref<HvacZone[]>;
  selectedIdxs: () => number[];
  floor: () => HvacFloorFilter;
  reload: () => Promise<boolean>;
  service?: HvacCatalogService;
  prompt?: typeof ElMessageBox.prompt;
  confirm?: typeof ElMessageBox.confirm;
  messages?: HvacCatalogMessages;
}

interface Operation {
  revision: number;
  isCurrent: () => boolean;
  sameIdentity: () => boolean;
}

/**
 * 空调目录的唯一写入边界。
 *
 * 内机/分区改名、归组、新建和删除共用一把锁。每个写入都绑定身份和请求修订，
 * 弹窗返回后重新核对作用域；页面停用或账号切换后，迟到响应不能回滚新目录、显示
 * 旧提示或解除后续操作的忙碌状态。服务器已接受写入但页面已经停用时，会静默回读
 * 当前身份的目录，避免下次激活仍展示旧数据。
 */
export function useHvacCatalogActions(options: HvacCatalogActionsOptions) {
  const {
    indoors,
    zones,
    selectedIdxs,
    floor,
    reload,
    service = hvacService,
    prompt = ElMessageBox.prompt,
    confirm = ElMessageBox.confirm,
    messages = ElMessage,
  } = options;

  const catalogBusy = ref(false);
  const editingIndoor = ref<number | null>(null);
  const editingZone = ref<string | null>(null);
  const editingText = ref('');
  const nameInput = ref<HTMLInputElement | null>(null);
  let disposed = false;
  let operationRevision = 0;
  let activeRollback: (() => void) | null = null;

  function bindNameInput(element: unknown): void {
    if (element) nameInput.value = element as HTMLInputElement;
  }

  function clearEditing(): void {
    editingIndoor.value = null;
    editingZone.value = null;
    editingText.value = '';
    nameInput.value = null;
  }

  function rollbackActive(): void {
    const rollback = activeRollback;
    activeRollback = null;
    rollback?.();
  }

  function stopCatalogActions(): void {
    rollbackActive();
    operationRevision += 1;
    catalogBusy.value = false;
    clearEditing();
  }

  function beginOperation(): Operation | null {
    if (catalogBusy.value || disposed) return null;
    const revision = ++operationRevision;
    const sameIdentity = captureIdentityGuard(() => !disposed);
    const isCurrent = captureIdentityGuard(() => (
      !disposed
      && revision === operationRevision
    ));
    catalogBusy.value = true;
    return { revision, isCurrent, sameIdentity };
  }

  function finishOperation(operation: Operation): void {
    if (operation.revision !== operationRevision || disposed) return;
    activeRollback = null;
    catalogBusy.value = false;
  }

  function rollbackIfCurrent(operation: Operation): void {
    if (!operation.isCurrent()) return;
    rollbackActive();
  }

  async function recoverCommittedStaleOperation(operation: Operation): Promise<void> {
    if (!operation.isCurrent() && operation.sameIdentity() && !disposed && !catalogBusy.value) {
      const recoveryRevision = operationRevision;
      catalogBusy.value = true;
      try {
        await reload();
      } finally {
        if (operationRevision === recoveryRevision && !disposed) catalogBusy.value = false;
      }
    }
  }

  async function confirmCatalogTruth(operation: Operation, successMessage: string): Promise<boolean> {
    activeRollback = null;
    const loaded = await reload();
    if (!operation.isCurrent()) return false;
    if (!loaded) {
      messages.warning('操作已提交，但目录回读失败，请刷新页面确认');
      return true;
    }
    messages.success(successMessage);
    return true;
  }

  function startRenameIndoor(row: IndoorRow): void {
    if (catalogBusy.value) return;
    editingZone.value = null;
    editingIndoor.value = row.idx;
    editingText.value = row.name;
    void nextTick(() => nameInput.value?.select());
  }

  async function commitRenameIndoor(row: IndoorRow): Promise<boolean> {
    if (editingIndoor.value !== row.idx) return false;
    const name = editingText.value.trim();
    editingIndoor.value = null;
    nameInput.value = null;
    const current = indoors.value.find((candidate) => candidate.idx === row.idx);
    if (!current || !name || name === current.name) return false;

    const operation = beginOperation();
    if (!operation) return false;
    const previousName = current.name;
    current.name = name;
    activeRollback = () => {
      const candidate = indoors.value.find((entry) => entry.idx === row.idx);
      if (candidate?.name === name) candidate.name = previousName;
    };

    try {
      const updated = await service.updateIndoor(row.idx, { name });
      if (!operation.isCurrent()) {
        await recoverCommittedStaleOperation(operation);
        return false;
      }
      activeRollback = null;
      const candidate = indoors.value.find((entry) => entry.idx === row.idx);
      if (candidate) candidate.name = updated.name;
      return true;
    } catch (error) {
      if (!operation.isCurrent()) return false;
      rollbackIfCurrent(operation);
      messages.error(`改名失败: ${(error as Error).message}`);
      return false;
    } finally {
      finishOperation(operation);
    }
  }

  function startRenameZone(zone: HvacZone): void {
    if (catalogBusy.value) return;
    editingIndoor.value = null;
    editingZone.value = zone.code;
    editingText.value = zone.name;
    void nextTick(() => nameInput.value?.select());
  }

  async function commitRenameZone(zone: HvacZone): Promise<boolean> {
    if (editingZone.value !== zone.code) return false;
    const name = editingText.value.trim();
    editingZone.value = null;
    nameInput.value = null;
    const current = zones.value.find((candidate) => candidate.code === zone.code);
    if (!current || !name || name === current.name) return false;

    const operation = beginOperation();
    if (!operation) return false;
    const previousName = current.name;
    current.name = name;
    activeRollback = () => {
      const candidate = zones.value.find((entry) => entry.code === zone.code);
      if (candidate?.name === name) candidate.name = previousName;
    };

    try {
      const updated = await service.renameZone(zone.code, name);
      if (!operation.isCurrent()) {
        await recoverCommittedStaleOperation(operation);
        return false;
      }
      activeRollback = null;
      const candidate = zones.value.find((entry) => entry.code === zone.code);
      if (candidate) candidate.name = updated.name;
      return true;
    } catch (error) {
      if (!operation.isCurrent()) return false;
      rollbackIfCurrent(operation);
      messages.error(`改名失败: ${(error as Error).message}`);
      return false;
    } finally {
      finishOperation(operation);
    }
  }

  async function assignTo(zoneCode: string | null): Promise<boolean> {
    const targets = [...new Set(selectedIdxs())];
    if (!targets.length) {
      messages.warning('请先选中内机');
      return false;
    }
    const zone = zoneCode === null ? null : zones.value.find((candidate) => candidate.code === zoneCode);
    if (zoneCode !== null && !zone) return false;
    const zoneName = zone?.name ?? null;
    const operation = beginOperation();
    if (!operation) return false;

    const targetSet = new Set(targets);
    const previous = indoors.value
      .filter((row) => targetSet.has(row.idx))
      .map((row) => ({ idx: row.idx, zoneCode: row.zoneCode }));
    for (const row of indoors.value) {
      if (targetSet.has(row.idx)) row.zoneCode = zoneCode;
    }
    activeRollback = () => {
      const byIdx = new Map(previous.map((entry) => [entry.idx, entry.zoneCode]));
      for (const row of indoors.value) {
        if (byIdx.has(row.idx)) row.zoneCode = byIdx.get(row.idx) ?? null;
      }
    };

    try {
      await service.assignIndoors(targets, zoneCode);
      if (!operation.isCurrent()) {
        await recoverCommittedStaleOperation(operation);
        return false;
      }
      return await confirmCatalogTruth(
        operation,
        zoneCode ? `已归入「${zoneName}」` : '已移出分组',
      );
    } catch (error) {
      if (!operation.isCurrent()) return false;
      rollbackIfCurrent(operation);
      messages.error(`归组失败: ${(error as Error).message}`);
      return false;
    } finally {
      finishOperation(operation);
    }
  }

  async function createZone(): Promise<boolean> {
    const capturedFloor = floor();
    const targetFloor = capturedFloor === 'all' ? '1F' : capturedFloor;
    const operation = beginOperation();
    if (!operation) return false;
    try {
      let result: Awaited<ReturnType<typeof prompt>>;
      try {
        result = await prompt(
          `新建功能区${capturedFloor === 'all' ? ' (默认归到一楼)' : ''}`,
          '新建分组',
          { inputPlaceholder: '例如: 会议室', inputPattern: /\S+/, inputErrorMessage: '名称不能为空' },
        );
      } catch (error) {
        if (error === 'cancel' || error === 'close') return false;
        throw error;
      }
      if (!operation.isCurrent() || floor() !== capturedFloor) return false;
      const name = String(result.value).trim();
      if (!name) return false;
      const created = await service.createZone(name, targetFloor);
      if (!operation.isCurrent()) {
        await recoverCommittedStaleOperation(operation);
        return false;
      }
      const existing = zones.value.findIndex((zone) => zone.code === created.code);
      if (existing >= 0) zones.value.splice(existing, 1, created);
      else zones.value.push(created);
      return await confirmCatalogTruth(
        operation,
        `已新建「${created.name}」, 选中内机后点它即可归入`,
      );
    } catch (error) {
      if (!operation.isCurrent()) return false;
      messages.error(`新建失败: ${(error as Error).message}`);
      return false;
    } finally {
      finishOperation(operation);
    }
  }

  async function removeZone(zone: HvacZone): Promise<boolean> {
    const current = zones.value.find((candidate) => candidate.code === zone.code);
    if (!current) return false;
    const name = current.name;
    const members = indoors.value.filter((row) => row.zoneCode === zone.code);
    const memberCount = members.length;
    const operation = beginOperation();
    if (!operation) return false;
    try {
      try {
        await confirm(
          memberCount > 0
            ? `删除「${name}」? 组里 ${memberCount} 台内机会变成"未分组", 内机本身不会被删。`
            : `删除「${name}」?`,
          '删除分组',
          { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' },
        );
      } catch (error) {
        if (error === 'cancel' || error === 'close') return false;
        throw error;
      }
      if (!operation.isCurrent() || !zones.value.some((candidate) => candidate.code === zone.code)) return false;

      const previousZones = zones.value.slice();
      const previousMembership = members.map((row) => ({ idx: row.idx, zoneCode: row.zoneCode }));
      zones.value = zones.value.filter((candidate) => candidate.code !== zone.code);
      for (const row of indoors.value) {
        if (row.zoneCode === zone.code) row.zoneCode = null;
      }
      activeRollback = () => {
        zones.value = previousZones;
        const byIdx = new Map(previousMembership.map((entry) => [entry.idx, entry.zoneCode]));
        for (const row of indoors.value) {
          if (byIdx.has(row.idx)) row.zoneCode = byIdx.get(row.idx) ?? null;
        }
      };

      await service.deleteZone(zone.code);
      if (!operation.isCurrent()) {
        await recoverCommittedStaleOperation(operation);
        return false;
      }
      return await confirmCatalogTruth(operation, '已删除');
    } catch (error) {
      if (!operation.isCurrent()) return false;
      rollbackIfCurrent(operation);
      messages.error(`删除失败: ${(error as Error).message}`);
      return false;
    } finally {
      finishOperation(operation);
    }
  }

  const stopIdentityListener = onIdentityChange(stopCatalogActions);
  onScopeDispose(() => {
    disposed = true;
    rollbackActive();
    operationRevision += 1;
    stopIdentityListener();
    clearEditing();
    catalogBusy.value = false;
  });

  return {
    catalogBusy,
    editingIndoor,
    editingZone,
    editingText,
    bindNameInput,
    startRenameIndoor,
    commitRenameIndoor,
    startRenameZone,
    commitRenameZone,
    assignTo,
    createZone,
    removeZone,
    stopCatalogActions,
  };
}
