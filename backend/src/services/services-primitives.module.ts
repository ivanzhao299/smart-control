import { Module } from '@nestjs/common';
import { ControlBus } from './control-bus';

@Module({
  providers: [ControlBus],
  exports: [ControlBus],
})
export class ServicesPrimitivesModule {}
