import { api, absUrl } from './http';

/** 道闸通道(相机) */
export interface LprDevice {
  id: number;
  serialno: string;
  deviceName: string;
  model: string | null;
  ip: string | null;
  channel: number | null;
  location: string | null;
  gateIo: number;
  /** 显式配置的关闸(落杆) IO 编号; null=未单独配置(自动取开闸 IO+1) */
  closeGateIo: number | null;
  /** 实际生效的关闸 IO: 显式优先, 否则自动取开闸 IO 下一路 */
  closeGateIoEffective: number;
  /** 道闸是否已连接(connect_status=1); null=未收到状态上报 */
  gateConnected: boolean | null;
  passDirection: 'in' | 'out' | null;
  online: boolean;
  lastHeartbeat: string | null;
  enabled: boolean;
  gateStatus: number | null;
  gateStatusLabel: string | null;
  /** 软件指令态: 1=最近指令开闸 / 0=最近指令关闸 / null=从未操作 */
  commandedGate: number | null;
  /** 最近一次远程开/关指令时间 (ISO) */
  commandedGateAt: string | null;
  /** 最终展示态: 0=关 / 1=开 / 2=动作中(仅真实上报) */
  gateState: number;
  /** 最终展示文案: 关 / 开 / 动作中 */
  gateStateLabel: string;
  /** 状态来源: device=相机真实上报 / command=按最近指令推断 / default=无信息默认关 */
  gateStateSource: 'device' | 'command' | 'default';
  lastPlate: string | null;
  lastEventTime: string | null;
  /** 相机 web 后台地址（仅园区内网可达） */
  webUrl: string | null;
}

/** 管理员视图：额外含 web 后台账号/口令 */
export interface LprDeviceAdmin extends LprDevice {
  webUser: string | null;
  webPassword: string | null;
}

/** 平台接入配置（相机 web 后台应配置成的标准参数） */
export interface LprPlatformConfig {
  host: string;
  httpPort: number;
  httpsPort: number;
  cometPath: string;
  platePath: string;
  gioPath: string;
  serialPath: string;
  gateStatusPath: string;
  note: string | null;
  /** HTTP 协议不支持远程改相机内推送地址，恒为 false */
  remoteChangeSupported: boolean;
  updatedAt: string | null;
}

/** 过车记录 */
export interface LprPassRecord {
  id: number;
  plateId: string;
  serialno: string;
  license: string;
  plateTypeLabel: string | null;
  plateColorLabel: string | null;
  carColorLabel: string | null;
  carTypeLabel: string | null;
  brand: string | null;
  directionLabel: string | null;
  confidence: number | null;
  triggerTypeLabel: string | null;
  isFake: number | null;
  isDanger: number | null;
  isOffline: number;
  passDirection: 'in' | 'out' | null;
  releaseResult: string;
  picSmallUrl: string | null;
  picBigUrl: string | null;
  eventTime: string | null;
}

export interface LprWhitelist {
  id: number;
  plate: string;
  groupName: string;
  isBlack: boolean;
  enable: boolean;
  enableTime: string | null;
  overdueTime: string | null;
  remark: string | null;
  syncState: string;
}

export interface LprStats {
  todayIn: number;
  todayOut: number;
  onsite: number;
  visitor: number;
  abnormal: number;
  autoReleased: number;
  totalToday: number;
}

export interface GateOpenResult {
  delivered: boolean;
  queued: boolean;
  serialno: string;
  deviceName: string;
}

export const LPR_GROUPS = [
  { value: 'staff', label: '员工' },
  { value: 'visitor', label: '访客' },
  { value: 'freight', label: '货运' },
  { value: 'black', label: '黑名单' },
] as const;

export const lprService = {
  devices: () => api.get<LprDevice[]>('/lpr/devices'),
  /** 管理员设备列表（含 web 后台账号/口令） */
  adminDevices: () => api.get<LprDeviceAdmin[]>('/lpr/admin/devices'),
  /** 平台接入配置（公开只读） */
  platformConfig: () => api.get<LprPlatformConfig>('/lpr/platform-config'),
  /** 更新平台接入配置（仅管理员） */
  savePlatformConfig: (body: Partial<Omit<LprPlatformConfig, 'remoteChangeSupported' | 'updatedAt'>>) =>
    api.put<LprPlatformConfig>('/lpr/platform-config', body),
  /** 按序列号预登记相机 (上线前手动录入, 已存在则幂等更新) */
  createDevice: (body: {
    serialno: string;
    deviceName?: string;
    model?: string | null;
    ip?: string | null;
    location?: string | null;
    channel?: number | null;
    gateIo?: number;
    closeGateIo?: number | null;
    passDirection?: 'in' | 'out' | null;
    enabled?: boolean;
    webUser?: string | null;
    webPassword?: string | null;
    webUrl?: string | null;
  }) => api.post<LprDevice>('/lpr/devices', body),
  recent: (limit = 20) => api.get<LprPassRecord[]>('/lpr/recent', { params: { limit } }),
  records: (params: { plate?: string; date?: string; limit?: number; offset?: number }) =>
    api.get<{ list: LprPassRecord[]; total: number }>('/lpr/records', { params }),
  stats: () => api.get<LprStats>('/lpr/stats', { refresh: true }),
  whitelist: () => api.get<LprWhitelist[]>('/lpr/whitelist'),
  saveWhitelist: (body: {
    plate: string;
    groupName?: string;
    isBlack?: boolean;
    enable?: boolean;
    remark?: string | null;
    overdueTime?: string | null;
  }) => api.post<LprWhitelist>('/lpr/whitelist', body),
  removeWhitelist: (id: number) => api.del<null>(`/lpr/whitelist/${id}`),
  /** 删除相机/通道（仅管理员；仅删设备，保留过车/状态历史） */
  deleteDevice: (id: number) => api.del<null>(`/lpr/devices/${id}`),
  updateDevice: (
    id: number,
    body: {
      deviceName?: string;
      location?: string | null;
      gateIo?: number;
      closeGateIo?: number | null;
      passDirection?: 'in' | 'out' | null;
      webUser?: string | null;
      webPassword?: string | null;
      webUrl?: string | null;
    },
  ) => api.put<LprDevice>(`/lpr/devices/${id}`, body),
  openGate: (body: { deviceId?: number; serialno?: string; reason?: string }) =>
    api.post<GateOpenResult>('/lpr/gate/open', body),
  /** 远程关闸(落杆): 对关闸 IO 发先通后断脉冲; 关闸 IO 默认与开闸 IO 自动配对(开闸+1) */
  closeGate: (body: { deviceId?: number; serialno?: string; reason?: string }) =>
    api.post<GateOpenResult>('/lpr/gate/close', body),
  snapUrl: (url: string | null): string => absUrl(url),
};
