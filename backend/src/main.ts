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

  // 进程级崩溃兜底 (2026-07-19 加固). 非 HTTP 的异步路径 —— 定时器 (设备探活 /
  // 音频对账 / 调度 fire)、WS、adapter 回调 —— 里任何漏网的异常, 之前会按 Node
  // 默认直接终止后端进程 (异常过滤器只覆盖 HTTP 上下文)。各服务大多自带 try/catch,
  // 这里是最后一道防线:
  //   - unhandledRejection: 记日志后**容忍**, 不让单个漏网的 async reject 崩掉整个
  //     后端 (一崩就得 pm2 拉起, 拉起前 API/设备控制全断)。
  //   - uncaughtException: 更严重 (同步异常, 进程状态可能已损坏) -> 记日志后**优雅
  //     退出**, 交给 pm2 拉起一个干净实例, 而不是带着脏状态硬撑。
  process.on('unhandledRejection', (reason) => {
    logger.error(
      `[unhandledRejection] ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
      'Process',
    );
  });
  process.on('uncaughtException', (err) => {
    logger.error(`[uncaughtException] ${err.stack ?? err.message}`, 'Process');
    // 给 winston 一点刷盘时间再退, unref 避免这个 timer 反过来钉住进程不退
    setTimeout(() => process.exit(1), 500).unref?.();
  });

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
