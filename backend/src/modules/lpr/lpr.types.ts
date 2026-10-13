/** LPR 模块对外/对内类型。报文结构只声明用到的字段, 其余原样保留在 raw。 */

/** 相机识别结果报文 (AlarmInfoPlate.result.PlateResult 的宽松结构) */
export interface PlateResultPayload {
  license?: string;
  plateid?: string | number;
  serialno?: string;
  channel?: number;
  confidence?: number;
  type?: number;
  colorType?: number;
  carColor?: number;
  direction?: number;
  triggerType?: number;
  car_brand?: { brand?: string; year?: string; type?: number };
  is_fake_plate?: number;
  is_danger?: number;
  isoffline?: number;
  imageFile?: string;
  imageFragmentFile?: string;
  timeStamp?: { Timeval?: { sec?: number } };
  [k: string]: unknown;
}

export interface AlarmPlateBody {
  AlarmInfoPlate?: {
    result?: {
      PlateResult?: PlateResultPayload | PlateResultPayload[];
    };
    serialno?: string;
    channel?: number;
  };
}

/** 道闸状态通知报文 */
/**
 * 道闸状态通知报文 (cmd=barr_gate_status_notify)。
 * 协议规定 gate_status/connect_status/enable 都在 result 嵌套对象内;
 * 同时兼容个别固件把字段平铺在顶层的情况。
 */
export interface GateStatusResult {
  gate_status?: number | string;
  connect_status?: number | string;
  enable?: number | string;
  gate_ctrl_id?: number | string;
}
export interface GateStatusBody {
  cmd?: string;
  sn?: string;
  serialno?: string;
  channel?: number;
  result?: GateStatusResult;
  /** 兼容平铺在顶层的固件 */
  gate_status?: number | string;
  connect_status?: number | string;
  enable?: number | string;
}

/** 白名单增改 DTO */
export interface WhitelistUpsertDto {
  plate: string;
  groupName?: string;
  isBlack?: boolean;
  enable?: boolean;
  enableTime?: string | null;
  overdueTime?: string | null;
  remark?: string | null;
}

/** 设备(通道)配置 DTO */
export interface DeviceUpsertDto {
  deviceName?: string;
  model?: string | null;
  ip?: string | null;
  location?: string | null;
  channel?: number | null;
  gateIo?: number;
  /** 关闸(落杆) IO 编号; 传 null 表示清空/不配置远程关闸 */
  closeGateIo?: number | null;
  passDirection?: 'in' | 'out' | null;
  enabled?: boolean;
  webUser?: string | null;
  webPassword?: string | null;
  webUrl?: string | null;
}

/** 按序列号预登记相机 DTO (设备上线前手动录入, 序列号必填) */
export interface DeviceCreateDto {
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
}

/** 手动开闸 DTO */
export interface GateOpenDto {
  /** 设备 id 或 serialno 二选一 */
  deviceId?: number;
  serialno?: string;
  /** 开闸后保持/先通后断延时 ms, 可选 */
  delay?: number;
  /** 操作来源/操作人, 写审计 */
  operator?: string;
  reason?: string;
}

/** 手动关闸(落杆) DTO; 走 ivs_ioctrl 对关闸 IO 发先通后断脉冲 */
export interface GateCloseDto {
  deviceId?: number;
  serialno?: string;
  delay?: number;
  operator?: string;
  reason?: string;
}

export interface DeviceView {
  id: number;
  serialno: string;
  deviceName: string;
  model: string | null;
  ip: string | null;
  channel: number | null;
  location: string | null;
  gateIo: number;
  /** 显式配置的关闸(落杆) IO 编号; null=未单独配置, 此时按规律自动取开闸 IO+1 */
  closeGateIo: number | null;
  /** 实际生效的关闸 IO: 显式配置优先, 否则自动取开闸 IO 的下一路(gateIo+1) */
  closeGateIoEffective: number;
  /** 道闸是否已连接(connect_status=1); null=未收到状态上报 */
  gateConnected: boolean | null;
  passDirection: 'in' | 'out' | null;
  online: boolean;
  lastHeartbeat: string | null;
  enabled: boolean;
  gateStatus: number | null;
  gateStatusLabel: string | null;
  /** 软件指令态: 1=最近指令开闸 / 0=最近指令关闸 / null=从未远程操作 */
  commandedGate: number | null;
  /** 最近一次远程开/关指令时间 (ISO) */
  commandedGateAt: string | null;
  /**
   * 最终用于展示的道闸状态: 0=关 / 1=开 / 2=动作中(仅真实上报可能出现)。
   * 合成规则: 相机真实上报 gate_status 优先; 否则用指令态; 都没有则按安全常态默认关。
   * GPIO 开关量道闸无真实杆位反馈, 现场绝大多数情况走指令态。
   */
  gateState: number;
  /** 最终展示状态文案: 关 / 开 / 动作中 */
  gateStateLabel: string;
  /** 状态来源: device=相机真实上报, command=按最近指令推断, default=无任何信息默认关 */
  gateStateSource: 'device' | 'command' | 'default';
  lastPlate: string | null;
  lastEventTime: string | null;
  /** 相机 web 管理后台地址（按 ip/model 推导，仅园区内网可达；公开可给） */
  webUrl: string | null;
}

/** 管理员视图：在公开视图基础上额外返回 web 后台账号/口令（公开接口不返回） */
export interface DeviceAdminView extends DeviceView {
  webUser: string | null;
  webPassword: string | null;
}

/** 平台接入配置（相机 web 后台应配置成的标准参数） */
export interface PlatformConfigView {
  host: string;
  httpPort: number;
  httpsPort: number;
  cometPath: string;
  platePath: string;
  gioPath: string;
  serialPath: string;
  gateStatusPath: string;
  note: string | null;
  /** 能力边界：HTTP 协议不支持远程改相机内的推送地址 */
  remoteChangeSupported: boolean;
  updatedAt: string | null;
}

/** 平台接入配置更新 DTO（仅管理员） */
export interface PlatformConfigUpdateDto {
  host?: string;
  httpPort?: number;
  httpsPort?: number;
  cometPath?: string;
  platePath?: string;
  gioPath?: string;
  serialPath?: string;
  gateStatusPath?: string;
  note?: string | null;
}

export interface PassRecordView {
  id: number;
  plateId: string;
  serialno: string;
  channel: number | null;
  license: string;
  plateType: number | null;
  plateTypeLabel: string | null;
  plateColor: number | null;
  plateColorLabel: string | null;
  carColor: number | null;
  carColorLabel: string | null;
  carType: number | null;
  carTypeLabel: string | null;
  brand: string | null;
  direction: number | null;
  directionLabel: string | null;
  confidence: number | null;
  triggerType: number | null;
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

export interface LprStats {
  todayIn: number;
  todayOut: number;
  onsite: number;
  visitor: number;
  abnormal: number;
  autoReleased: number;
  totalToday: number;
}
