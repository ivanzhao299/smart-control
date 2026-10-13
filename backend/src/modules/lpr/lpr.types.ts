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
export interface GateStatusBody {
  cmd?: string;
  sn?: string;
  serialno?: string;
  gate_status?: number | string;
  connect_status?: number | string;
  enable?: number | string;
  channel?: number;
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
  passDirection?: 'in' | 'out' | null;
  enabled?: boolean;
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
  passDirection?: 'in' | 'out' | null;
  enabled?: boolean;
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

export interface DeviceView {
  id: number;
  serialno: string;
  deviceName: string;
  model: string | null;
  ip: string | null;
  channel: number | null;
  location: string | null;
  gateIo: number;
  passDirection: 'in' | 'out' | null;
  online: boolean;
  lastHeartbeat: string | null;
  enabled: boolean;
  gateStatus: number | null;
  gateStatusLabel: string | null;
  lastPlate: string | null;
  lastEventTime: string | null;
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
