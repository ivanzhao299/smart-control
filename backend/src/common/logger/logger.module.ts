import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { WinstonModule } from 'nest-winston';
import * as winston from 'winston';
import 'winston-daily-rotate-file';
import { mkdirSync } from 'fs';
import { LoggerConfig } from '../config/configuration';

@Module({
  imports: [
    WinstonModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const cfg = config.getOrThrow<LoggerConfig>('logger');
        mkdirSync(cfg.dir, { recursive: true });

        const consoleFormat = winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          winston.format.colorize({ all: true }),
          winston.format.printf(({ timestamp, level, message, context, stack }) => {
            const ctx = context ? `[${String(context)}]` : '';
            const trace = stack ? `\n${String(stack)}` : '';
            return `${String(timestamp)} ${level} ${ctx} ${String(message)}${trace}`;
          }),
        );

        const fileFormat = winston.format.combine(
          winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
          winston.format.errors({ stack: true }),
          winston.format.json(),
        );

        // PERFORMANCE_AUDIT P1-#9:
        // 生产环境 app.log 改成 'warn' 默认 (老 'info' 每命令写盘 5-12ms),
        // 想看详细 IO: 启动加 SHOW_INFO_LOGS=1 临时打开
        // Console transport 生产关掉, pm2 自己捕 stdout/stderr → pm2-out.log
        const isProd = process.env.NODE_ENV === 'production';
        const fileLevel =
          process.env.SHOW_INFO_LOGS === '1'
            ? 'info'
            : cfg.level === 'debug'
              ? 'debug'
              : isProd
                ? 'warn'
                : 'info';

        return {
          level: cfg.level,
          transports: [
            ...(isProd ? [] : [new winston.transports.Console({ format: consoleFormat })]),
            new winston.transports.DailyRotateFile({
              dirname: cfg.dir,
              filename: 'app-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              maxFiles: cfg.maxFiles,
              maxSize: cfg.maxSize,
              level: fileLevel,
              format: fileFormat,
            }),
            new winston.transports.DailyRotateFile({
              dirname: cfg.dir,
              filename: 'error-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              maxFiles: cfg.maxFiles,
              maxSize: cfg.maxSize,
              level: 'error',
              format: fileFormat,
            }),
          ],
        };
      },
    }),
  ],
  exports: [WinstonModule],
})
export class LoggerModule {}
