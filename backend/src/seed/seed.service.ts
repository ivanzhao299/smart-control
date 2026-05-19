import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { Device, DeviceCategory } from '../entities/device.entity';
import { Scene } from '../entities/scene.entity';
import { User } from '../entities/user.entity';
import { hashPassword } from '../common/utils/password.util';

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
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async run(): Promise<void> {
    await this.seedAdmin();
    await this.seedScenes();
    await this.seedDevices();
    this.logger.info('Seed completed', { context: 'SeedService' });
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
