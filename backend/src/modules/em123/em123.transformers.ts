/**
 * 园区变压器台账与「表-变」归属映射（静态、可维护配置；不写死前端）。
 *
 * 来源：现场《园区变压器智能表.xlsx》+ 业主现场确认（2026-10-15）。
 *
 * 采集约束（已确认）：
 *  - 9 台均为油浸式变压器，低压进线柜无多功能仪表；
 *  - 电力监控后台隶属供电公司、有铅封，无法取数；
 *  - 因此走纯 em123 路线：用已上云的贝林三相总表逐小时有功加总，
 *    给出「已接入回路」的下限负载率；缺失回路表以后补，不编造。
 *
 * mode（接入状态，决定面板展示）：
 *  - calc    已接入回路足以代表本台负荷，给出逐小时真实负载率（当前仅 #6）。
 *  - partial 仅接入部分回路，只标注「部分回路」，不把加总当整体负载率展示（下限会误读）。
 *  - none    出线回路表均未上云，待接入。
 *  - off     未投运（#3/#4）。
 *
 * 负载率口径：kW / kVA（未计无功），PF0.9 时约偏低 +10%（前端给 PF0.9 参考值）。
 */

export type TransformerMode = 'calc' | 'partial' | 'none' | 'off';

export interface TransformerProfile {
  /** 变压器编号「#1」…「#9」 */
  id: string;
  /** 额定容量 kVA */
  capacityKva: number;
  /** 安装位置 */
  location: string;
  /** 变压器类型（箱式油变 / 油变） */
  tfType: string;
  /** 是否投运 */
  active: boolean;
  /** 接入状态 */
  mode: TransformerMode;
  /** 已上云并归入本变压器的三相总表 meterNo（逐小时同时刻加总） */
  meterNos: string[];
  /** 接入情况短文案（partial/none/off 面板右侧展示；calc 由负载率动态生成） */
  statusText: string;
  /** 备注（缺回路、待核对等） */
  note: string;
}

/** 9 台变压器台账（按编号顺序）。 */
export const TRANSFORMERS: TransformerProfile[] = [
  {
    id: '#1', capacityKva: 500, location: 'D3大棚北', tfType: '箱式油变', active: true,
    mode: 'partial',
    meterNos: ['202505030249'], // C4-1楼电表（疑似归入，待现场核对）
    statusText: '部分回路',
    note: '仅 C4-1 疑似归入；缺 F1/F2 空调、伙房茶炉、无纺布宿舍回路。',
  },
  {
    id: '#2', capacityKva: 800, location: 'E5~E6 内', tfType: '箱式油变', active: true,
    mode: 'none',
    meterNos: [],
    statusText: '待接入',
    note: '出线回路表尚未上云。',
  },
  {
    id: '#3', capacityKva: 800, location: '老配电室', tfType: '油变', active: false,
    mode: 'off',
    meterNos: [],
    statusText: '未投运',
    note: '未投运。',
  },
  {
    id: '#4', capacityKva: 800, location: '研发楼地下室', tfType: '油变', active: false,
    mode: 'off',
    meterNos: [],
    statusText: '未投运',
    note: '未投运。',
  },
  {
    id: '#5', capacityKva: 1000, location: 'D5北', tfType: '箱式油变', active: true,
    mode: 'none',
    meterNos: [],
    statusText: '待接入',
    note: '出线回路表尚未上云。',
  },
  {
    id: '#6', capacityKva: 1000, location: 'E3北', tfType: '箱式油变', active: true,
    mode: 'calc',
    // B3-1 / A4-1 / B2-2 / E2-1 / C1大总 / A5栋-2楼 / A5栋-3层 / C1栋总(离线)
    meterNos: [
      '202503072005', '202508290084', '202508290079', '202508290083',
      '202502280487', '202306260028', '202307040027', '202505030252',
    ],
    statusText: '',
    note: '已接入 7 块在线回路（C1栋总离线）；逐小时同时刻加总；缺 E1/消防，仅为已接入回路下限。',
  },
  {
    id: '#7', capacityKva: 1250, location: 'A2北', tfType: '箱式油变', active: true,
    mode: 'partial',
    meterNos: [],
    statusText: '充电桩待接',
    note: '充电桩回路表待接入。',
  },
  {
    id: '#8', capacityKva: 2000, location: 'E7南配电室', tfType: '油变', active: true,
    mode: 'partial',
    meterNos: [],
    statusText: 'E4待接',
    note: 'E4 回路表待接入。',
  },
  {
    id: '#9', capacityKva: 1000, location: 'E7北配电室', tfType: '油变', active: true,
    mode: 'none',
    meterNos: [],
    statusText: '待接入',
    note: '出线回路表尚未上云。',
  },
];

/** 贝林三相总表总数（27 块），其中已上云 12 块（DTZY），另 15 块未上云。 */
export const THREE_PHASE_TOTAL = 27;

/** 假设功率因数（用于把 kW/kVA 负载率折算为约 +10% 的参考值）。 */
export const ASSUMED_POWER_FACTOR = 0.9;
