import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdaptersModule } from '../../adapters/adapters.module';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { HperforController } from './hperfor.controller';
import { HperforDevicesService } from './hperfor-devices.service';

/**
 * 华普云 HPERFOR ePa 智电云接入模块：后台设备清单查看与一键同步。
 * 平台调用复用 adapters 里的 HperforApiAdapter（登录/控制/列表同源）。
 */
@Module({
  imports: [
    AdaptersModule,
    TypeOrmModule.forFeature([HardwareUnit, PowerCircuit]),
  ],
  controllers: [HperforController],
  providers: [HperforDevicesService],
  exports: [HperforDevicesService],
})
export class HperforModule {}
