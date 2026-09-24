import { computed, type Ref } from 'vue';
import type { HvacZone } from '@/services/hvac.service';
import {
  averageSelectedTemperature,
  buildGroupedSections,
  buildZoneCards,
  commonKnownState,
  filterIndoorsByFloor,
  filterZonesByFloor,
  invertVisibleSelection,
  isSelectionComplete,
  summarizeHvacOverview,
  toggleSelection,
  type HvacFloorFilter,
  type IndoorRow,
} from '@/features/hvac-view-model';

interface HvacSelectionOptions {
  indoors: Ref<IndoorRow[]>;
  zones: Ref<HvacZone[]>;
  floor: Ref<HvacFloorFilter>;
  selected: Ref<Set<number>>;
}

/**
 * 暖通页的只读投影与选择边界。
 *
 * 楼层切换只改变当前可见范围，不会静默清掉其他楼层已经选中的内机；全选、反选和
 * 分区选择也只作用于当前可见范围。设备状态读取、写入和目录保存由各自的 composable
 * 负责，这里不发请求。
 */
export function useHvacSelection(options: HvacSelectionOptions) {
  const { indoors, zones, floor, selected } = options;

  const visibleIndoors = computed(() => filterIndoorsByFloor(indoors.value, floor.value));
  const visibleZones = computed(() => filterZonesByFloor(zones.value, floor.value));
  const ungroupedCount = computed(() => visibleIndoors.value.filter((row) => !row.zoneCode).length);
  const groupedSections = computed(() => buildGroupedSections(visibleIndoors.value, visibleZones.value));
  const zoneCards = computed(() => buildZoneCards(visibleIndoors.value, visibleZones.value));

  const zoneNames = computed(() => new Map(zones.value.map((zone) => [zone.code, zone.name])));
  function zoneNameOf(code: string | null): string {
    return code ? zoneNames.value.get(code) ?? '?' : '未分组';
  }

  const selectedRows = computed(() => indoors.value.filter((row) => selected.value.has(row.idx)));
  const selectedIdxs = computed(() => selectedRows.value.map((row) => row.idx));
  const overview = computed(() => summarizeHvacOverview(visibleIndoors.value, visibleZones.value.length));
  const selectedMode = computed(() => commonKnownState(selectedRows.value, 'mode'));
  const selectedFan = computed(() => commonKnownState(selectedRows.value, 'fan'));
  const selectedPower = computed(() => commonKnownState(selectedRows.value, 'on'));
  const selectedTemperature = computed(() => averageSelectedTemperature(selectedRows.value));

  function visibleIndexes(): number[] {
    return visibleIndoors.value.map((row) => row.idx);
  }

  function zoneIndexes(code: string | null): number[] {
    return visibleIndoors.value
      .filter((row) => row.zoneCode === code)
      .map((row) => row.idx);
  }

  function toggleMany(indexes: number[]): void {
    if (!indexes.length) return;
    selected.value = toggleSelection(selected.value, indexes);
  }

  function toggleOne(index: number): void {
    toggleMany([index]);
  }

  function selectAll(): void {
    toggleMany(visibleIndexes());
  }

  function selectNone(): void {
    selected.value = new Set();
  }

  function invertSelection(): void {
    selected.value = invertVisibleSelection(selected.value, visibleIndexes());
  }

  function selectZone(code: string | null): void {
    toggleMany(zoneIndexes(code));
  }

  function isZoneSelected(code: string | null): boolean {
    return isSelectionComplete(selected.value, zoneIndexes(code));
  }

  const allSelected = computed(() => isSelectionComplete(selected.value, visibleIndexes()));
  const zoneKey = (code: string | null): string => code ?? '__none__';

  return {
    visibleIndoors,
    visibleZones,
    ungroupedCount,
    groupedSections,
    zoneCards,
    zoneNameOf,
    selectedRows,
    selectedIdxs,
    overview,
    selectedMode,
    selectedFan,
    selectedPower,
    selectedTemperature,
    toggleOne,
    selectAll,
    selectNone,
    invertSelection,
    selectZone,
    isZoneSelected,
    allSelected,
    zoneKey,
  };
}
