import { onScopeDispose, ref, type Ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { haptics } from '@/services/haptics';
import {
  hvacService,
  type HvacBatchResult,
  type HvacFan,
  type HvacMode,
} from '@/services/hvac.service';
import { captureIdentityGuard, onIdentityChange } from '@/services/identity-boundary';
import type {
  HvacFloorFilter,
  HvacZoneCard,
  IndoorRow,
  IndoorState,
} from '@/features/hvac-view-model';

type HvacControlService = Pick<
  typeof hvacService,
  'batchOn' | 'batchOff' | 'batchTemperature' | 'batchMode' | 'batchFanSpeed'
>;

interface HvacControlMessages {
  warning(message: string): void;
  error(message: string): void;
}

interface HvacControlsOptions {
  indoors: Ref<IndoorRow[]>;
  selectedRows: () => IndoorRow[];
  visibleIndoors: () => IndoorRow[];
  floor: () => HvacFloorFilter;
  markWrite: () => void;
  scheduleTruthRefresh: () => void;
  service?: HvacControlService;
  confirm?: typeof ElMessageBox.confirm;
  messages?: HvacControlMessages;
  tap?: () => void;
}

interface CommandOptions {
  zoneKey?: string;
  dispatching?: boolean;
  targets: () => IndoorRow[];
  apply: (state: IndoorState) => void;
  send: (idxs: number[]) => Promise<HvacBatchResult>;
  partialMessage: (result: HvacBatchResult) => string;
  errorMessage: (error: Error) => string;
  confirmAction?: () => Promise<unknown>;
  preflightIsCurrent?: () => boolean;
  markKnown?: boolean;
}

/**
 * 空调页的唯一设备写入边界。
 *
 * 选中内机、分区卡和楼层全开关共用同一把锁，避免同一条 485 链路同时收到两批
 * 指令。每次乐观写入都绑定当前身份和请求修订；页面停用、身份切换或后续请求发生
 * 后，迟到的成功/失败都不能提示、回滚或解除新请求的忙碌状态。
 */
export function useHvacControls(options: HvacControlsOptions) {
  const {
    indoors,
    selectedRows,
    visibleIndoors,
    floor,
    markWrite,
    scheduleTruthRefresh,
    service = hvacService,
    confirm = ElMessageBox.confirm,
    messages = ElMessage,
    tap = () => haptics.tap(),
  } = options;

  const busy = ref(false);
  const dispatching = ref(false);
  const zoneBusy = ref<string | null>(null);
  let disposed = false;
  let operationRevision = 0;

  function clearIndicators(): void {
    busy.value = false;
    dispatching.value = false;
    zoneBusy.value = null;
  }

  function stopControls(): void {
    operationRevision += 1;
    clearIndicators();
  }

  async function execute(command: CommandOptions): Promise<boolean> {
    if (busy.value) return false;
    const revision = ++operationRevision;
    const isCurrent = captureIdentityGuard(() => (
      !disposed
      && revision === operationRevision
    ));
    busy.value = true;
    zoneBusy.value = command.zoneKey ?? null;
    let wrote = false;
    let backup: Array<{ idx: number; state: IndoorState }> = [];

    try {
      if (command.confirmAction) {
        try {
          await command.confirmAction();
        } catch {
          return false;
        }
        if (!isCurrent() || !(command.preflightIsCurrent?.() ?? true)) return false;
      }

      const targets = [...command.targets()];
      if (!targets.length) return false;
      backup = targets.map((row) => ({ idx: row.idx, state: { ...row.state } }));
      for (const row of targets) {
        command.apply(row.state);
        if (command.markKnown) row.state.known = true;
      }
      wrote = true;
      if (command.dispatching) dispatching.value = true;
      markWrite();
      tap();

      const result = await command.send(targets.map((row) => row.idx));
      if (!isCurrent()) return false;
      if (result.okCount === 0 && result.failCount > 0) throw new Error('全部失败');
      if (result.failCount > 0) messages.warning(command.partialMessage(result));
      return true;
    } catch (error) {
      if (!isCurrent()) return false;
      const snapshots = new Map(backup.map((entry) => [entry.idx, entry.state]));
      for (const row of indoors.value) {
        const snapshot = snapshots.get(row.idx);
        if (snapshot) row.state = snapshot;
      }
      messages.error(command.errorMessage(error as Error));
      return false;
    } finally {
      if (revision === operationRevision && !disposed) {
        clearIndicators();
        if (wrote) scheduleTruthRefresh();
      }
    }
  }

  async function runSelected(
    label: string,
    apply: (state: IndoorState) => void,
    send: (idxs: number[]) => Promise<HvacBatchResult>,
    isDispatching = false,
  ): Promise<boolean> {
    if (!selectedRows().length) {
      messages.warning('请先选中内机');
      return false;
    }
    return execute({
      dispatching: isDispatching,
      targets: selectedRows,
      apply,
      send,
      partialMessage: (result) => `${label}: 部分成功 (${result.okCount}/${result.okCount + result.failCount})`,
      errorMessage: (error) => `${label} 失败: ${error.message}`,
    });
  }

  const turnOn = () => runSelected('开机', (state) => { state.on = true; }, service.batchOn, true);
  const turnOff = () => runSelected('关机', (state) => { state.on = false; }, service.batchOff, true);
  const setMode = (mode: HvacMode) => runSelected(
    '模式',
    (state) => { state.mode = mode; },
    (idxs) => service.batchMode(idxs, mode),
  );
  const setFan = (speed: HvacFan) => runSelected(
    '风速',
    (state) => { state.fan = speed; },
    (idxs) => service.batchFanSpeed(idxs, speed),
  );
  const setTemperature = (value: number) => runSelected(
    '温度',
    (state) => { state.temperature = value; },
    (idxs) => service.batchTemperature(idxs, value),
  );

  function runZone(
    card: HvacZoneCard,
    label: string,
    apply: (state: IndoorState) => void,
    send: (idxs: number[]) => Promise<HvacBatchResult>,
  ): Promise<boolean> {
    if (!card.members.length) return Promise.resolve(false);
    return execute({
      zoneKey: card.code ?? '__none__',
      targets: () => card.members,
      apply,
      send,
      markKnown: true,
      partialMessage: (result) => `「${card.name}」${label}: 部分成功 (${result.okCount}/${result.okCount + result.failCount})`,
      errorMessage: (error) => `「${card.name}」${label}失败: ${error.message}`,
    });
  }

  function zonePower(card: HvacZoneCard): Promise<boolean> {
    const on = card.onCount === 0;
    return runZone(
      card,
      on ? '开机' : '关机',
      (state) => { state.on = on; },
      on ? service.batchOn : service.batchOff,
    );
  }

  function zoneSetTemperature(card: HvacZoneCard, value: number): Promise<boolean> {
    return runZone(
      card,
      '温度',
      (state) => { state.temperature = value; },
      (idxs) => service.batchTemperature(idxs, value),
    );
  }

  function zoneSetMode(card: HvacZoneCard, mode: HvacMode): Promise<boolean> {
    return runZone(
      card,
      '模式',
      (state) => { state.mode = mode; },
      (idxs) => service.batchMode(idxs, mode),
    );
  }

  async function floorPower(on: boolean): Promise<boolean> {
    const capturedFloor = floor();
    const targets = [...visibleIndoors()];
    if (!targets.length) return false;
    const scope = capturedFloor === 'all' ? '全部楼层' : (capturedFloor === '1F' ? '一楼' : '二楼');
    return execute({
      dispatching: true,
      targets: () => targets,
      preflightIsCurrent: () => floor() === capturedFloor,
      confirmAction: () => confirm(
        `确定${on ? '开启' : '关闭'}${scope}共 ${targets.length} 台空调?\n将逐台错峰下发, 约需 ${Math.ceil(targets.length * 0.6) + 2} 秒。`,
        on ? '全开确认' : '全关确认',
        { type: 'warning', confirmButtonText: on ? '全开' : '全关', cancelButtonText: '取消' },
      ),
      apply: (state) => { state.on = on; },
      send: on ? service.batchOn : service.batchOff,
      partialMessage: (result) => `部分成功 (${result.okCount}/${result.total})`,
      errorMessage: (error) => `${on ? '全开' : '全关'} 失败: ${error.message}`,
    });
  }

  const stopIdentityListener = onIdentityChange(stopControls);
  onScopeDispose(() => {
    disposed = true;
    operationRevision += 1;
    stopIdentityListener();
    clearIndicators();
  });

  return {
    busy,
    dispatching,
    zoneBusy,
    turnOn,
    turnOff,
    setMode,
    setFan,
    setTemperature,
    zonePower,
    zoneSetTemperature,
    zoneSetMode,
    floorPower,
    stopControls,
  };
}
