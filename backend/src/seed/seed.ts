import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { SeedModule } from './seed.module';
import { SeedService } from './seed.service';

async function run(): Promise<void> {
  const app = await NestFactory.createApplicationContext(SeedModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER));

  try {
    const seeder = app.get(SeedService);
    await seeder.run();
  } finally {
    await app.close();
  }
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Seed failed:', err);
  process.exit(1);
});
