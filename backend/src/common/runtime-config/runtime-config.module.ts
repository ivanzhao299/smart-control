import { Global, Module } from '@nestjs/common';
import { RuntimeConfigStore } from './runtime-config.store';

@Global()
@Module({
  providers: [RuntimeConfigStore],
  exports: [RuntimeConfigStore],
})
export class RuntimeConfigModule {}
