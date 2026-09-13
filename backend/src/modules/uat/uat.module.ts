import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UatRecord } from '../../entities/uat-record.entity';
import { ServicesPrimitivesModule } from '../../services/services-primitives.module';
import { UatController } from './uat.controller';
import { UatService } from './uat.service';

@Module({
  imports: [TypeOrmModule.forFeature([UatRecord]), ServicesPrimitivesModule],
  controllers: [UatController],
  providers: [UatService],
  exports: [UatService],
})
export class UatModule {}
