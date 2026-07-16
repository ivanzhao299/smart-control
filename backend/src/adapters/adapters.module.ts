import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HardwareUnit } from '../entities/hardware-unit.entity';
import { Device } from '../entities/device.entity';
import { AdapterConnectionRegistry } from './connection-registry';
import { LightingAdapter } from './lighting/lighting.adapter';
import { MockDaliAdapter } from './lighting/mock-dali.adapter';
import { RealDaliAdapter } from './lighting/real-dali.adapter';
import { CyDali64aAdapter } from './lighting/cy-dali64a.adapter';
import { LedAdapter } from './led/led.adapter';
import { MockLedAdapter } from './led/mock-led.adapter';
import { NovaLedAdapter } from './led/nova-led.adapter';
import { AudioAdapter } from './audio/audio.adapter';
import { MockAudioAdapter } from './audio/mock-audio.adapter';
import { RealAudioAdapter } from './audio/real-audio.adapter';
import { EkxDspAdapter } from './audio/ekx808.adapter';
import { HvacAdapter } from './hvac/hvac.adapter';
import { MockHvacAdapter } from './hvac/mock-hvac.adapter';
import { ModbusHvacAdapter } from './hvac/modbus-hvac.adapter';
import { PowerAdapter } from './power/power.adapter';
import { Epo802pAdapter } from './power/epo802p.adapter';
import { ServicesPrimitivesModule } from '../services/services-primitives.module';

const PROVIDERS = [
  AdapterConnectionRegistry,
  // Lighting
  MockDaliAdapter,
  RealDaliAdapter,
  CyDali64aAdapter,
  LightingAdapter,
  // LED
  MockLedAdapter,
  NovaLedAdapter,
  LedAdapter,
  // Audio
  MockAudioAdapter,
  RealAudioAdapter,
  EkxDspAdapter,
  AudioAdapter,
  // HVAC
  MockHvacAdapter,
  ModbusHvacAdapter,
  HvacAdapter,
  // Power
  PowerAdapter,
  Epo802pAdapter,
];

@Module({
  imports: [
    ServicesPrimitivesModule,
    // adapter 自己查 HardwareUnit 读 IP — 后台改完 IP 不用重启 backend
    // Device: HVAC 适配器用它把内机序号(1..22)映射到 {gwHost,n} 地址
    TypeOrmModule.forFeature([HardwareUnit, Device]),
  ],
  providers: PROVIDERS,
  exports: PROVIDERS,
})
export class AdaptersModule {}
