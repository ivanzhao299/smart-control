/**
 * 中央空调功能区分组 (HVAC Zones)
 *
 * 把 22 台物理内机按"功能区"组织, 一个区可包含 1-N 台内机.
 * 场景配置和前端 UI 都按区操作 (区内所有内机同步动作).
 *
 * 数据来源: 《F1楼-一层二层空调位置明细》2026-05-21
 *
 * 物理内机的 indoorIdx 见:
 *   - backend/src/seed/seed.service.ts (设备表)
 *   - docs/HVAC_FIELD_INSTALL.md (§3 内机地址规划)
 */

export interface HvacZoneConfig {
  /** 区代号 (英文小写下划线, URL 安全, 场景 deviceId 用) */
  code: string;
  /** 区显示名 */
  name: string;
  /** 楼层 */
  floor: '1F' | '2F';
  /** 区内成员内机 (indoorIdx 1-22) */
  indoors: number[];
  /** 可选: 区描述 / 备注 */
  desc?: string;
}

export const HVAC_ZONES: HvacZoneConfig[] = [
  // ============ 1F (10 内机 → 6 个功能区) ============
  {
    code: 'enterprise_booth',
    name: '企业展位',
    floor: '1F',
    indoors: [1, 2, 3],
    desc: '3 个独立展位单元, DLR-63F × 3',
  },
  {
    code: 'livestream',
    name: '直播间',
    floor: '1F',
    indoors: [4],
    desc: 'DLR-71F × 1',
  },
  {
    code: 'foreign_trade',
    name: '外贸交易展示区',
    floor: '1F',
    indoors: [5, 6],
    desc: 'DLR-71F + DLR-80F',
  },
  {
    code: 'park_display',
    name: '园区展示',
    floor: '1F',
    indoors: [7],
    desc: 'DLR-90F × 1',
  },
  {
    code: 'roadshow',
    name: '路演发布洽谈区',
    floor: '1F',
    indoors: [8, 9],
    desc: 'DLR-100F + DLR-112F',
  },
  {
    code: 'showcase',
    name: '企业综合展销区',
    floor: '1F',
    indoors: [10],
    desc: 'DLR-125F × 1',
  },
  // ============ 2F (12 内机 → 8 个功能区) ============
  {
    code: 'group_mgmt',
    name: '集团产业管理中心',
    floor: '2F',
    indoors: [11],
    desc: 'DLR-90F × 1',
  },
  {
    code: 'decision_center',
    name: '投资决策中心',
    floor: '2F',
    indoors: [12],
    desc: 'DLR-90F × 1',
  },
  {
    code: 'meeting_room',
    name: '会议室',
    floor: '2F',
    indoors: [13],
    desc: 'DLR-90F × 1',
  },
  {
    code: 'shared_office',
    name: '共享办公室',
    floor: '2F',
    indoors: [14, 15],
    desc: 'DLR-90F × 2',
  },
  {
    code: 'service_center',
    name: '企业服务中心',
    floor: '2F',
    indoors: [16, 17],
    desc: 'DLR-90F × 2',
  },
  {
    code: 'command_center',
    name: '园区运营指挥中心',
    floor: '2F',
    indoors: [18, 19],
    desc: 'DLR-90F × 2',
  },
  {
    code: 'lobby_2f',
    name: '二层前厅',
    floor: '2F',
    indoors: [20, 21],
    desc: 'DLR-100F × 2',
  },
  {
    code: 'research_center',
    name: '产业研究中心',
    floor: '2F',
    indoors: [22],
    desc: 'DLR-100F × 1',
  },
];

/** 按 code 找 zone */
export function findZone(code: string): HvacZoneConfig | undefined {
  return HVAC_ZONES.find(z => z.code === code);
}

/** 按楼层分组 */
export function zonesByFloor(floor: '1F' | '2F'): HvacZoneConfig[] {
  return HVAC_ZONES.filter(z => z.floor === floor);
}

/** 给定内机 indoorIdx, 反查所在区 */
export function zoneOfIndoor(indoorIdx: number): HvacZoneConfig | undefined {
  return HVAC_ZONES.find(z => z.indoors.includes(indoorIdx));
}

/** 内机总数 (用于校验) */
export const TOTAL_INDOORS = HVAC_ZONES.reduce((sum, z) => sum + z.indoors.length, 0);
