import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { deviceService } from '@/services/device.service';
import type { Device, DeviceRuntimeSnapshot, DeviceStatus, GatewayInfo, WsEvent } from '@/types/api';

const RUNTIME_CATEGORY = (name: string): string => {
  if (name.includes('light') || name.startsWith('lighting-')) return 'lighting';
  if (name.includes('led')) return 'led';
  if (name.includes('audio')) return 'audio';
  if (name.includes('hvac')) return 'hvac';
  return 'system';
};

export const useDeviceStore = defineStore('device', () => {
  const devices = ref<Device[]>([]);
  const runtime = ref<Map<string, DeviceRuntimeSnapshot>>(new Map());
  const gateways = ref<GatewayInfo[]>([]);

  const onlineCount = computed(() => {
    let n = 0;
    for (const d of devices.value) {
      const rt = runtime.value.get(d.name);
      if (rt && (rt.status === 'online' || rt.status === 'running')) n += 1;
      else if (!rt && d.status === 'online') n += 1;
    }
    return n;
  });

  const totalCount = computed(() => devices.value.length);

  const offlineDevices = computed(() =>
    devices.value.filter((d) => {
      const rt = runtime.value.get(d.name);
      return rt ? rt.status === 'offline' || rt.status === 'error' : d.status === 'offline';
    }),
  );

  const errorDevices = computed(() =>
    devices.value.filter((d) => {
      const rt = runtime.value.get(d.name);
      return rt?.status === 'error' || (!rt && d.status === 'error');
    }),
  );

  const lightingDevices = computed(() => devices.value.filter((d) => d.category === 'lighting'));
  const ledDevices = computed(() => devices.value.filter((d) => d.category === 'led'));
  const audioDevices = computed(() => devices.value.filter((d) => d.category === 'audio'));
  const hvacDevices = computed(() => devices.value.filter((d) => d.category === 'hvac'));

  const gatewayBySource = computed(() => {
    const m = new Map<string, GatewayInfo>();
    for (const g of gateways.value) m.set(RUNTIME_CATEGORY(g.gateway), g);
    return m;
  });

  async function fetchDevices(): Promise<void> {
    const p = await deviceService.list();
    devices.value = p.list;
  }

  async function fetchRuntime(): Promise<void> {
    const list = await deviceService.runtimeDevices();
    const map = new Map<string, DeviceRuntimeSnapshot>();
    for (const r of list) map.set(r.device, r);
    runtime.value = map;
  }

  async function fetchGateways(): Promise<void> {
    gateways.value = await deviceService.runtimeGateways();
  }

  async function refreshAll(): Promise<void> {
    await Promise.all([fetchDevices(), fetchRuntime(), fetchGateways()]);
  }

  function statusOf(deviceName: string): DeviceStatus {
    const rt = runtime.value.get(deviceName);
    if (rt) return rt.status;
    const dev = devices.value.find((d) => d.name === deviceName);
    return dev?.status ?? 'offline';
  }

  function handleWs(event: WsEvent): void {
    if (event.type !== 'device_status') return;
    const cur = runtime.value.get(event.device);
    runtime.value.set(event.device, {
      device: event.device,
      status: event.status as DeviceStatus,
      state: event.state ?? cur?.state ?? {},
      updatedAt: event.at,
    });
    // 触发响应式
    runtime.value = new Map(runtime.value);

    // 同步 gateway 状态 (gateway 走 device_status 事件传递)
    const gw = gateways.value.find((g) => g.gateway === event.device);
    if (gw) {
      gw.state = (event.status as GatewayInfo['state']) ?? gw.state;
      gw.updatedAt = event.at;
      if (event.state && 'lastError' in event.state) {
        gw.lastError = (event.state.lastError as string) ?? undefined;
      }
      gateways.value = [...gateways.value];
    }
  }

  return {
    devices,
    runtime,
    gateways,
    onlineCount,
    totalCount,
    offlineDevices,
    errorDevices,
    lightingDevices,
    ledDevices,
    audioDevices,
    hvacDevices,
    gatewayBySource,
    fetchDevices,
    fetchRuntime,
    fetchGateways,
    refreshAll,
    statusOf,
    handleWs,
  };
});
