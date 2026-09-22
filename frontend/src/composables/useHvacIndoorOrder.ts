import { onScopeDispose, ref, type Ref } from 'vue';
import { ElMessage } from 'element-plus';
import { hvacService } from '@/services/hvac.service';
import { captureIdentityGuard } from '@/services/identity-boundary';
import type { IndoorRow } from '@/features/hvac-view-model';

export function useHvacIndoorOrder(indoors: Ref<IndoorRow[]>) {
  const dragIndoorIdx = ref<number | null>(null);
  const dragOverIndoorIdx = ref<number | null>(null);
  let disposed = false;
  let saveRevision = 0;

  function clearDrag(): void {
    dragIndoorIdx.value = null;
    dragOverIndoorIdx.value = null;
  }

  function onIndoorDragStart(row: IndoorRow, event: DragEvent): void {
    dragIndoorIdx.value = row.idx;
    event.dataTransfer?.setData('text/plain', String(row.idx));
    if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
  }

  function onIndoorDragOver(row: IndoorRow, event: DragEvent): void {
    if (dragIndoorIdx.value === null || dragIndoorIdx.value === row.idx) return;
    event.preventDefault();
    dragOverIndoorIdx.value = row.idx;
  }

  async function onIndoorDrop(target: IndoorRow): Promise<void> {
    const from = dragIndoorIdx.value;
    clearDrag();
    if (from === null || from === target.idx) return;
    const next = indoors.value.slice();
    const fromIndex = next.findIndex((row) => row.idx === from);
    const targetIndex = next.findIndex((row) => row.idx === target.idx);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [moved] = next.splice(fromIndex, 1);
    next.splice(targetIndex, 0, moved);

    const previous = indoors.value;
    const revision = ++saveRevision;
    const isCurrent = captureIdentityGuard(() => !disposed && revision === saveRevision);
    indoors.value = next;
    try {
      await hvacService.reorderIndoors(next.map((row) => row.idx));
    } catch (error) {
      if (!isCurrent()) return;
      indoors.value = previous;
      ElMessage.error(`排序保存失败: ${(error as Error).message}`);
    }
  }

  onScopeDispose(() => {
    disposed = true;
    saveRevision += 1;
    clearDrag();
  });

  return {
    dragIndoorIdx,
    dragOverIndoorIdx,
    onIndoorDragStart,
    onIndoorDragOver,
    onIndoorDrop,
    onIndoorDragEnd: clearDrag,
  };
}
