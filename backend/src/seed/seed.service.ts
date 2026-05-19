import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { Device, DeviceCategory } from '../entities/device.entity';
import { Scene } from '../entities/scene.entity';
import { User } from '../entities/user.entity';
import { UatCategory, UatRecord } from '../entities/uat-record.entity';
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

const DEVICES: DeviceSeed[] = [
  { name: 'light_1f_main', category: 'lighting', protocol: 'dali', adapter: 'mock', floor: '1F', zone: 'main' },
  { name: 'light_2f_main', category: 'lighting', protocol: 'dali', adapter: 'mock', floor: '2F', zone: 'main' },
  { name: 'led_1f_main', category: 'led', protocol: 'tcp', adapter: 'mock', floor: '1F', zone: 'main' },
  { name: 'led_2f_main', category: 'led', protocol: 'tcp', adapter: 'mock', floor: '2F', zone: 'main' },
  { name: 'audio_1f', category: 'audio', protocol: 'tcp', adapter: 'mock', floor: '1F', zone: 'main' },
  { name: 'audio_2f', category: 'audio', protocol: 'tcp', adapter: 'mock', floor: '2F', zone: 'main' },
  { name: 'hvac_1f', category: 'hvac', protocol: 'modbus', adapter: 'mock', floor: '1F', zone: 'main' },
  { name: 'hvac_2f', category: 'hvac', protocol: 'modbus', adapter: 'mock', floor: '2F', zone: 'main' },
];

@Injectable()
export class SeedService {
  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
    @InjectRepository(UatRecord) private readonly uatRepo: Repository<UatRecord>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async run(): Promise<void> {
    await this.seedAdmin();
    await this.seedScenes();
    await this.seedDevices();
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
        address: null,
        floor: d.floor,
        zone: d.zone,
        enabled: true,
        status: 'offline',
      });
      await this.deviceRepo.save(device);
      this.logger.info(`Seeded device: ${d.name} (${d.category})`, { context: 'SeedService' });
    }
  }
}
