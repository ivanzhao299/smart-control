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

  const httpServer = await app.listen(appCfg.port, '0.0.0.0');

  // 大文件上传 (媒体模块) 需要长 timeout, 默认 2 分钟. 改 30 分钟.
  // requestTimeout=0 表示不限 (Node 18+)
  // headersTimeout 60s 防慢速攻击; keepAliveTimeout 5s 默认
  httpServer.requestTimeout = 0;
  httpServer.headersTimeout = 60_000;
  httpServer.setTimeout(30 * 60 * 1000);

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
