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

        return {
          level: cfg.level,
          transports: [
            new winston.transports.Console({ format: consoleFormat }),
            new winston.transports.DailyRotateFile({
              dirname: cfg.dir,
              filename: 'app-%DATE%.log',
              datePattern: 'YYYY-MM-DD',
              maxFiles: cfg.maxFiles,
              maxSize: cfg.maxSize,
              level: 'info',
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
