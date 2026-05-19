import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { WsAdapter } from '@nestjs/platform-ws';
import { WINSTON_MODULE_NEST_PROVIDER } from 'nest-winston';
import { AppModule } from './app.module';
import { AppConfig, WebSocketConfig } from './common/config/configuration';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const logger = app.get(WINSTON_MODULE_NEST_PROVIDER);
  app.useLogger(logger);

  const config = app.get(ConfigService);
  const appCfg = config.getOrThrow<AppConfig>('app');
  const wsCfg = config.getOrThrow<WebSocketConfig>('websocket');

  app.setGlobalPrefix(appCfg.apiPrefix.replace(/^\//, ''));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.enableCors();
  app.useWebSocketAdapter(new WsAdapter(app));
  app.enableShutdownHooks();

  await app.listen(appCfg.port, '0.0.0.0');

  logger.log(
    `🚀 ${appCfg.appName} started on http://0.0.0.0:${appCfg.port}${appCfg.apiPrefix} (ws: ${wsCfg.path}) [${appCfg.nodeEnv}]`,
    'Bootstrap',
  );
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Failed to start application:', err);
  process.exit(1);
});
