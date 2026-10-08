import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EwelinkAuth } from '../../entities/ewelink-auth.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { EwelinkAuthService } from './ewelink-auth.service';
import { EwelinkDevicesService } from './ewelink-devices.service';
import { EwelinkController } from './ewelink.controller';

/**
 * 易微联 eWeLink 云接入模块：OAuth2.0 授权、设备同步、开关控制。
 */
@Module({
  imports: [TypeOrmModule.forFeature([EwelinkAuth, HardwareUnit, PowerCircuit])],
  controllers: [EwelinkController],
  providers: [EwelinkAuthService, EwelinkDevicesService],
  exports: [EwelinkAuthService, EwelinkDevicesService],
})
export class EwelinkModule {}
