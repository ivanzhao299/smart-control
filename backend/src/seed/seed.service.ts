import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { Device, DeviceCategory } from '../entities/device.entity';
import { Scene } from '../entities/scene.entity';
import { User } from '../entities/user.entity';
import { UatCategory, UatRecord } from '../entities/uat-record.entity';
import { HardwareCategory, HardwareUnit } from '../entities/hardware-unit.entity';
import { hashPassword } from '../common/utils/password.util';

interface UatSeed {
  itemName: string;
  category: UatCategory;
  testStep: string;
  expectedResult: string;
}

const UAT_ITEMS: UatSeed[] = [
  // 场景验收
  { itemName: '场景: 开馆模式', category: 'scene', testStep: '后台或平板点击「开馆模式」', expectedResult: '所有楼层主灯打开, LED 显示欢迎页, 背景音乐播放, 空调正常运行' },
  { itemName: '场景: 接待模式', category: 'scene', testStep: '点击「接待模式」', expectedResult: '主区灯光柔和, LED 切换演示内容, 音响适中, 空调舒适温度' },
  { itemName: '场景: 会议模式', category: 'scene', testStep: '点击「会议模式」', expectedResult: '会议区灯光合适, LED 切换 HDMI 笔记本输入, 音响音量适中' },
  { itemName: '场景: 路演模式', category: 'scene', testStep: '点击「路演模式」', expectedResult: '舞台灯亮, LED 播放预设视频, 音响开启' },
  { itemName: '场景: 清洁模式', category: 'scene', testStep: '点击「清洁模式」', expectedResult: '所有照明开到 100%, LED/音响关闭' },
  { itemName: '场景: 闭馆模式', category: 'scene', testStep: '点击「闭馆模式」', expectedResult: '主灯关闭, 仅安防应急照明, LED/音响关闭, 空调关闭' },
  // 设备验收
  { itemName: '设备: 灯光开关', category: 'device', testStep: '灯光页点击 1F/2F 开/关按钮', expectedResult: '设备实际开关, 后台状态同步刷新' },
  { itemName: '设备: 灯光调光', category: 'device', testStep: '拖动亮度滑条至 30/60/100', expectedResult: 'DALI 指令下发, 实际亮度跟随' },
  { itemName: '设备: LED 开关屏', category: 'device', testStep: 'LED 页点击开屏/关屏', expectedResult: 'LED 实际开关, NUC 输出生效' },
  { itemName: '设备: LED 播放视频', category: 'device', testStep: '选择视频或播放欢迎页', expectedResult: 'LED 切换至对应输入并播放, 无黑屏' },
  { itemName: '设备: 音响音量控制', category: 'device', testStep: '音响页拖动音量滑条 / 切换静音', expectedResult: 'DSP 音量实际变化, 静音生效, 取消静音恢复' },
  { itemName: '设备: 空调温度控制', category: 'device', testStep: '空调页设置 20/24/28 ℃ 并切换制冷/制热', expectedResult: 'Modbus 指令下发, 空调实际温度模式跟随' },
  // 稳定性验收
  { itemName: '稳定性: 断网恢复', category: 'stability', testStep: '拔掉网关网线 30s 后插回', expectedResult: '设备显示 reconnecting → online, 报警自动 resolve' },
  { itemName: '稳定性: 断电恢复', category: 'stability', testStep: '断开网关电源 1 分钟后供电', expectedResult: 'PM2 自动恢复连接, 网关回到 online' },
  { itemName: '稳定性: 设备离线提示', category: 'stability', testStep: '强制某网关离线 (改 IP 错误)', expectedResult: '报警中心创建 critical alert, 平板顶部红色提示' },
  { itemName: '稳定性: 场景执行日志', category: 'stability', testStep: '执行任意场景后查看后台→执行记录', expectedResult: '记录完整, 失败设备明细可见, 成功/失败计数准确' },
];

interface DeviceSeed {
  name: string;
  category: DeviceCategory;
  protocol: string;
  adapter: string;
  floor: string;
  zone: string;
  /** JSON 字符串, 示例 '{"slaveId":1,"group":3}', adapter 解析后用作寻址 */
  address?: string;
}

interface SceneSeed {
  code: string;
  name: string;
  description: string;
}

const SCENES: SceneSeed[] = [
  { code: 'opening', name: '开馆模式', description: '展馆开放期间常规灯光与音响' },
  { code: 'reception', name: '接待模式', description: '重要客户接待场景' },
  { code: 'meeting', name: '会议模式', description: '会议区域灯光与显示设备' },
  { code: 'roadshow', name: '路演模式', description: '展品路演与互动展示' },
  { code: 'cleaning', name: '清洁模式', description: '保洁时段照明' },
  { code: 'closing', name: '闭馆模式', description: '闭馆后基础安防与节能照明' },
];

// 灯光设备 = DALI 组. id 后缀 = DALI 组号 (与 LightingPage 前端 zone.id 对齐)
// 走 CY-DALI64A 网关 (Modbus RTU over TCP). LIGHTING_ADAPTER_KIND=cy-dali64a (默认)
const DEVICES: DeviceSeed[] = [
  // ---- 1F (DALI 组 1-7) ----
  { name: 'light_1f_lobby',      category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'lobby',         address: '{"slaveId":1,"group":1}' },
  { name: 'light_1f_roadshow',   category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'roadshow',      address: '{"slaveId":1,"group":2}' },
  { name: 'light_1f_corridor',   category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'corridor',      address: '{"slaveId":1,"group":3}' },
  { name: 'light_1f_accent',     category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'accent',        address: '{"slaveId":1,"group":4}' },
  { name: 'light_1f_exhibit',    category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'f102_exhibit',  address: '{"slaveId":1,"group":5}' },
  { name: 'light_1f_showroom',   category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'f103_showroom', address: '{"slaveId":1,"group":6}' },
  { name: 'light_1f_trade',      category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '1F', zone: 'f104_trade',    address: '{"slaveId":1,"group":7}' },
  // ---- 2F (DALI 组 8-12) ----
  { name: 'light_2f_lobby',      category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '2F', zone: 'lobby_corridor', address: '{"slaveId":1,"group":8}'  },
  { name: 'light_2f_service',    category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '2F', zone: 'service_center', address: '{"slaveId":1,"group":9}'  },
  { name: 'light_2f_office',     category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '2F', zone: 'shared_office',  address: '{"slaveId":1,"group":10}' },
  { name: 'light_2f_research',   category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '2F', zone: 'research_center',address: '{"slaveId":1,"group":11}' },
  { name: 'light_2f_command',    category: 'lighting', protocol: 'dali-modbus-rtu', adapter: 'cy-dali64a', floor: '2F', zone: 'command_center', address: '{"slaveId":1,"group":12}' },
  { name: 'led_1f_main', category: 'led', protocol: 'tcp', adapter: 'mock', floor: '1F', zone: 'main' },
  { name: 'led_2f_main', category: 'led', protocol: 'tcp', adapter: 'mock', floor: '2F', zone: 'main' },
  { name: 'audio_1f', category: 'audio', protocol: 'tcp', adapter: 'mock', floor: '1F', zone: 'main' },
  { name: 'audio_2f', category: 'audio', protocol: 'tcp', adapter: 'mock', floor: '2F', zone: 'main' },
  // ---- 中央空调内机 (奥克斯 ARV-X9 / 2 台外机 / CCM-270B 网关, indoorIdx=1..22) ----
  // 1F: 10 台 (外机 DLR-785W5/DCM-ARVX9 35.5kW); 2F: 12 台 (外机 DLR-1015W5/DCM-ARVX9 40.8kW)
  // 数据来源: 《F1楼-一层二层空调位置明细》2026-05-21
  // 1F
  { name: 'hvac_1f_exhibit_1',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '1F', zone: 'enterprise_booth_1', address: '{"indoorIdx":1,"model":"DLR-63F","kw":1.8}'  },
  { name: 'hvac_1f_exhibit_2',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '1F', zone: 'enterprise_booth_2', address: '{"indoorIdx":2,"model":"DLR-63F","kw":1.8}'  },
  { name: 'hvac_1f_exhibit_3',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '1F', zone: 'enterprise_booth_3', address: '{"indoorIdx":3,"model":"DLR-63F","kw":1.8}'  },
  { name: 'hvac_1f_livestream',    category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '1F', zone: 'livestream',         address: '{"indoorIdx":4,"model":"DLR-71F","kw":2.0}'  },
  { name: 'hvac_1f_trade_1',       category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '1F', zone: 'foreign_trade_1',    address: '{"indoorIdx":5,"model":"DLR-71F","kw":2.0}'  },
  { name: 'hvac_1f_trade_2',       category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '1F', zone: 'foreign_trade_2',    address: '{"indoorIdx":6,"model":"DLR-80F","kw":2.0}'  },
  { name: 'hvac_1f_park_display',  category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '1F', zone: 'park_display',       address: '{"indoorIdx":7,"model":"DLR-90F","kw":2.2}'  },
  { name: 'hvac_1f_roadshow_1',    category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '1F', zone: 'roadshow_1',         address: '{"indoorIdx":8,"model":"DLR-100F","kw":2.2}' },
  { name: 'hvac_1f_roadshow_2',    category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '1F', zone: 'roadshow_2',         address: '{"indoorIdx":9,"model":"DLR-112F","kw":2.2}' },
  { name: 'hvac_1f_showcase',      category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '1F', zone: 'enterprise_showcase',address: '{"indoorIdx":10,"model":"DLR-125F","kw":2.2}' },
  // 2F
  { name: 'hvac_2f_group_mgmt',    category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'group_mgmt',         address: '{"indoorIdx":11,"model":"DLR-90F","kw":2.2}' },
  { name: 'hvac_2f_decision',      category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'decision_center',    address: '{"indoorIdx":12,"model":"DLR-90F","kw":2.2}' },
  { name: 'hvac_2f_meeting',       category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'meeting_room',       address: '{"indoorIdx":13,"model":"DLR-90F","kw":2.2}' },
  { name: 'hvac_2f_shared_1',      category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'shared_office_1',    address: '{"indoorIdx":14,"model":"DLR-90F","kw":2.2}' },
  { name: 'hvac_2f_shared_2',      category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'shared_office_2',    address: '{"indoorIdx":15,"model":"DLR-90F","kw":2.2}' },
  { name: 'hvac_2f_service_1',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'service_center_1',   address: '{"indoorIdx":16,"model":"DLR-90F","kw":2.2}' },
  { name: 'hvac_2f_service_2',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'service_center_2',   address: '{"indoorIdx":17,"model":"DLR-90F","kw":2.2}' },
  { name: 'hvac_2f_command_1',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'command_center_1',   address: '{"indoorIdx":18,"model":"DLR-90F","kw":2.2}' },
  { name: 'hvac_2f_command_2',     category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'command_center_2',   address: '{"indoorIdx":19,"model":"DLR-90F","kw":2.2}' },
  { name: 'hvac_2f_lobby_1',       category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'lobby_1',            address: '{"indoorIdx":20,"model":"DLR-100F","kw":2.2}' },
  { name: 'hvac_2f_lobby_2',       category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'lobby_2',            address: '{"indoorIdx":21,"model":"DLR-100F","kw":2.2}' },
  { name: 'hvac_2f_research',      category: 'hvac', protocol: 'modbus-tcp', adapter: 'aux-ccm270b', floor: '2F', zone: 'research_center',    address: '{"indoorIdx":22,"model":"DLR-100F","kw":2.2}' },
];

@Injectable()
export class SeedService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
    @InjectRepository(UatRecord) private readonly uatRepo: Repository<UatRecord>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async run(): Promise<void> {
    await this.seedAdmin();
    await this.seedScenes();
    await this.seedDevices();
    await this.seedHardware();
    await this.seedUat();
    this.logger.info('Seed completed', { context: 'SeedService' });
  }

  private async seedUat(): Promise<void> {
    let idx = 0;
    for (const u of UAT_ITEMS) {
      idx += 1;
      const exists = await this.uatRepo.findOne({ where: { itemName: u.itemName } });
      if (exists) continue;
      const r = this.uatRepo.create({
        itemName: u.itemName,
        category: u.category,
        testStep: u.testStep,
        expectedResult: u.expectedResult,
        status: 'pending',
        sortOrder: idx,
      });
      await this.uatRepo.save(r);
      this.logger.info(`Seeded UAT: ${u.itemName}`, { context: 'SeedService' });
    }
  }

  private async seedAdmin(): Promise<void> {
    const username = 'admin';
    const exists = await this.userRepo.findOne({ where: { username } });
    if (exists) {
      this.logger.info(`User '${username}' already exists, skip`, { context: 'SeedService' });
      return;
    }
    const user = this.userRepo.create({
      username,
      password: hashPassword('admin123'),
      role: 'admin',
      enabled: true,
    });
    await this.userRepo.save(user);
    this.logger.info(`Seeded user: ${username} (default password: admin123)`, {
      context: 'SeedService',
    });
  }

  private async seedScenes(): Promise<void> {
    for (const s of SCENES) {
      const exists = await this.sceneRepo.findOne({ where: { code: s.code } });
      if (exists) continue;
      const scene = this.sceneRepo.create({
        code: s.code,
        name: s.name,
        description: s.description,
        enabled: true,
      });
      await this.sceneRepo.save(scene);
      this.logger.info(`Seeded scene: ${s.code} (${s.name})`, { context: 'SeedService' });
    }
  }

  private async seedDevices(): Promise<void> {
    for (const d of DEVICES) {
      const exists = await this.deviceRepo.findOne({ where: { name: d.name } });
      if (exists) continue;
      const device = this.deviceRepo.create({
        name: d.name,
        category: d.category,
        protocol: d.protocol,
        adapter: d.adapter,
        ip: null,
        address: d.address ?? null,
        floor: d.floor,
        zone: d.zone,
        enabled: true,
        status: 'offline',
      });
      await this.deviceRepo.save(device);
      this.logger.info(`Seeded device: ${d.name} (${d.category})`, { context: 'SeedService' });
    }
  }

  private async seedHardware(): Promise<void> {
    interface HardwareSeed {
      code: string;
      name: string;
      category: HardwareCategory;
      vendor: string;
      model: string;
      location?: string;
      floor?: string;
      ip?: string;
      addressing?: string;
      channels?: string;
      remark?: string;
    }

    const HARDWARE: HardwareSeed[] = [
      // ---- 中控核心 ----
      {
        code: 'HOST-GK9000',
        name: '中控主机 (GK9000)',
        category: 'other',
        vendor: '占美 GIADA',
        model: 'GK9000',
        floor: '1F',
        location: '1F 主控室 / 弱电机柜',
        addressing: JSON.stringify({
          cpu: 'Intel i7-10750H (6C12T)',
          ram: '16GB DDR4',
          ssd: '1TB',
          serialPorts: 6,
          nics: 2,
          os: 'Windows 10 Pro',
        }),
        remark: 'Windows 10 + Node.js 20 + PM2 + Nginx, D:\\smart-control\\; NIC1=DeviceLAN 192.168.50.10, NIC2=MgmtLAN(DHCP), 6 COM 闲置备用',
      },
      // ---- DALI 灯光 ----
      {
        code: 'CONV-RTU-1',
        name: 'RS485 RTU↔TCP 转换器',
        category: 'rtu-tcp-converter',
        vendor: '有人 USR',
        model: 'USR-TCP232-410S',
        ip: '192.168.50.20',
        floor: '1F',
        location: '1F 弱电机柜 / 公共电箱 F101 附近',
        addressing: JSON.stringify({ port: 502, baud: 9600, parity: 'N', stop: 1 }),
        remark: 'RS485 端接 CY-DALI64A 控制串口 (非调试串口)',
      },
      {
        code: 'GW-DALI-1',
        name: 'DALI 网关 #1',
        category: 'dali-gateway',
        vendor: '元创智控',
        model: 'CY-DALI64A',
        floor: '1F',
        location: '1F 弱电机柜',
        addressing: JSON.stringify({ slaveId: 1, baud: 9600, frameIntervalMs: 200 }),
        remark: 'DALI 总线 16V/250mA, 拨码盘地址 1, RS485 控制串口接 CONV-RTU-1',
      },
      {
        code: 'DIMMER-DA4D-01',
        name: '1F 调光器 #1 (前厅 / 园区展示)',
        category: 'dali-dimmer',
        vendor: 'CTLEDTECH',
        model: 'DA4-D',
        floor: '1F',
        location: '1F 公共电箱 F101 内',
        addressing: JSON.stringify({ daliStart: 1, daliCount: 4, mode: '4CH' }),
        channels: JSON.stringify([
          { ch: 1, daliShort: 1, label: '前厅灯带', powerW: 300, daliGroup: 1 },
          { ch: 2, daliShort: 2, label: '前厅筒灯+射灯', powerW: 600, daliGroup: 1 },
          { ch: 3, daliShort: 3, label: '园区展示筒灯+灯带+灯箱', powerW: 1600, daliGroup: 1 },
          { ch: 4, daliShort: 4, label: '走廊灯带', powerW: 1300, daliGroup: 3 },
        ]),
      },
      {
        code: 'DIMMER-DA4D-02',
        name: '1F 调光器 #2 (走廊 + 重点)',
        category: 'dali-dimmer',
        vendor: 'CTLEDTECH',
        model: 'DA4-D',
        floor: '1F',
        location: '1F 公共电箱 F101 内',
        addressing: JSON.stringify({ daliStart: 5, daliCount: 4, mode: '4CH' }),
        channels: JSON.stringify([
          { ch: 1, daliShort: 5, label: '走廊筒灯+射灯', powerW: 800, daliGroup: 3 },
          { ch: 2, daliShort: 6, label: '吸顶灯', powerW: 60, daliGroup: 3 },
          { ch: 3, daliShort: 7, label: '格栅长条灯', powerW: 800, daliGroup: 4 },
          { ch: 4, daliShort: 8, label: '重点照明灯带', powerW: 700, daliGroup: 4 },
        ]),
      },
      {
        code: 'DIMMER-DA4D-03',
        name: '1F 调光器 #3 (F102/F103/F104)',
        category: 'dali-dimmer',
        vendor: 'CTLEDTECH',
        model: 'DA4-D',
        floor: '1F',
        location: '1F 企业展位区电箱 (F102)',
        addressing: JSON.stringify({ daliStart: 9, daliCount: 4, mode: '4CH' }),
        channels: JSON.stringify([
          { ch: 1, daliShort: 9, label: 'F102 灯带', powerW: 200, daliGroup: 5 },
          { ch: 2, daliShort: 10, label: 'F102 预留', powerW: 600, daliGroup: 5 },
          { ch: 3, daliShort: 11, label: 'F103 筒灯+射灯', powerW: 400, daliGroup: 6 },
          { ch: 4, daliShort: 12, label: 'F104 灯带', powerW: 200, daliGroup: 7 },
        ]),
      },
      {
        code: 'DIMMER-DA4D-04',
        name: '2F 调光器 #1 (前厅 + 服务中心)',
        category: 'dali-dimmer',
        vendor: 'CTLEDTECH',
        model: 'DA4-D',
        floor: '2F',
        location: '2F 公共电箱 F201 内',
        addressing: JSON.stringify({ daliStart: 13, daliCount: 4, mode: '4CH' }),
        channels: JSON.stringify([
          { ch: 1, daliShort: 13, label: '2F 前厅筒灯', powerW: 600, daliGroup: 8 },
          { ch: 2, daliShort: 14, label: '2F 走廊灯带', powerW: 900, daliGroup: 8 },
          { ch: 3, daliShort: 15, label: '服务中心筒灯', powerW: 1200, daliGroup: 9 },
          { ch: 4, daliShort: 16, label: '配房筒灯+射灯', powerW: 1000, daliGroup: 9 },
        ]),
      },
      {
        code: 'DIMMER-DA4D-05',
        name: '2F 调光器 #2 (办公 + 研究 + 指挥)',
        category: 'dali-dimmer',
        vendor: 'CTLEDTECH',
        model: 'DA4-D',
        floor: '2F',
        location: '2F 共享办公电箱 (F202)',
        addressing: JSON.stringify({ daliStart: 17, daliCount: 3, mode: '3CH' }),
        channels: JSON.stringify([
          { ch: 1, daliShort: 17, label: 'F202 共享办公吸顶灯', powerW: 800, daliGroup: 10 },
          { ch: 2, daliShort: 18, label: 'F203 产业研究吸顶灯', powerW: 1000, daliGroup: 11 },
          { ch: 3, daliShort: 19, label: 'F204 指挥中心吸顶灯', powerW: 900, daliGroup: 12 },
        ]),
      },
      // ---- LED 大屏 ----
      {
        code: 'LED-NOVA-1',
        name: '1F LED 大屏控制器',
        category: 'led-controller',
        vendor: '诺瓦 NovaStar',
        model: 'VX1000',
        ip: '192.168.50.30',
        floor: '1F',
        location: '1F 主控室机柜',
        addressing: JSON.stringify({ box: '1', port: 5200 }),
        remark: '一层主 LED 大屏播控; 通过 NUC HDMI 输入',
      },
      {
        code: 'LED-NUC-1',
        name: '1F LED 播控主机',
        category: 'led-player',
        vendor: 'Intel',
        model: 'NUC11',
        ip: '192.168.50.31',
        floor: '1F',
        location: '1F 主控室机柜',
        remark: 'Windows + ViPlex Express, 输出 HDMI 到 VX1000',
      },
      // ---- 音响 ----
      {
        code: 'AUDIO-DSP-1',
        name: '音响 DSP 处理器',
        category: 'audio-dsp',
        vendor: 'DSPPA',
        model: 'MAG6816',
        ip: '192.168.50.40',
        floor: '1F',
        location: '1F 主控室机柜',
        addressing: JSON.stringify({ zones: ['1f_bg', '2f_bg', 'meeting', 'roadshow'] }),
        remark: '4 路分区背景音 + 麦克风输入',
      },
      // ---- 空调 ----
      {
        code: 'HVAC-ODU-1F',
        name: '1F 中央空调外机 (商用 VRF)',
        category: 'hvac-outdoor',
        vendor: '奥克斯',
        model: 'DLR-785W5/DCM-ARVX9',
        floor: '1F',
        location: '楼顶设备平台',
        addressing: JSON.stringify({ capacityKw: 35.5, currentA: 57, series: 'ARV-X9', subType: '超低温全直流变频' }),
        remark: '一层专用外机, 制冷量 35.5kW, 57A, R410A, 带 10 台内机 (indoorIdx 1-10)',
      },
      {
        code: 'HVAC-ODU-2F',
        name: '2F 中央空调外机 (商用 VRF)',
        category: 'hvac-outdoor',
        vendor: '奥克斯',
        model: 'DLR-1015W5/DCM-ARVX9',
        floor: '2F',
        location: '楼顶设备平台',
        addressing: JSON.stringify({ capacityKw: 40.8, currentA: 64, series: 'ARV-X9', subType: '超低温全直流变频' }),
        remark: '二层专用外机, 制冷量 40.8kW, 64A, R410A, 带 12 台内机 (indoorIdx 11-22)',
      },
      {
        code: 'HVAC-GW-1',
        name: '中央空调通讯网关',
        category: 'hvac-gateway',
        vendor: '奥克斯',
        model: 'CCM-270B',
        ip: '192.168.50.50',
        floor: '1F',
        location: '1F 弱电机柜',
        addressing: JSON.stringify({ slaveId: 1, port: 502, maxIndoor: 64, indoorBlockSize: 16, supportsArvX9: 'TBD' }),
        remark: 'Modbus TCP 网关; 单 slaveId+寄存器偏移寻址 22 台内机. ARV-X9 系列是否兼容需厂家确认 (可能需升级到 CCM-280/CCM-310)',
      },
      // ---- 控制平板 ----
      {
        code: 'TABLET-1F',
        name: '1F 控制平板',
        category: 'tablet',
        vendor: '通用',
        model: 'iPad Pro 12.9 / Android 平板',
        floor: '1F',
        location: '1F 前厅控制台',
        remark: 'PWA 网址 https://cnjinhu.top/control/ 添加到主屏',
      },
    ];

    for (const h of HARDWARE) {
      const exists = await this.hwRepo.findOne({ where: { code: h.code } });
      if (exists) continue;
      const entity = this.hwRepo.create({
        code: h.code,
        name: h.name,
        category: h.category,
        vendor: h.vendor,
        model: h.model,
        serialNo: null,
        firmwareVersion: null,
        location: h.location ?? null,
        floor: h.floor ?? null,
        ip: h.ip ?? null,
        macAddress: null,
        addressing: h.addressing ?? null,
        channels: h.channels ?? null,
        status: 'normal',
        enabled: true,
        remark: h.remark ?? null,
        installedAt: null,
      });
      await this.hwRepo.save(entity);
      this.logger.info(`Seeded hardware: ${h.code} (${h.vendor} ${h.model})`, {
        context: 'SeedService',
      });
    }
  }
}
