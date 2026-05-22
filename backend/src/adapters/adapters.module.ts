import { Module } from '@nestjs/common';
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
];

@Module({
  imports: [ServicesPrimitivesModule],
  providers: PROVIDERS,
  exports: PROVIDERS,
})
export class AdaptersModule {}
