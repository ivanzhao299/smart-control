import { resolve } from 'path';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  appName: string;
  apiPrefix: string;
  apiTimeout: number;
}

export interface DatabaseConfig {
  path: string;
  synchronize: boolean;
  logging: boolean;
}

export interface LoggerConfig {
  level: string;
  dir: string;
  maxFiles: string;
  maxSize: string;
}

export interface AdapterConfig {
  mock: boolean;
  mockLatencyMs: number;
}

export interface WebSocketConfig {
  path: string;
}

export interface RootConfig {
  app: AppConfig;
  database: DatabaseConfig;
  logger: LoggerConfig;
  adapter: AdapterConfig;
  websocket: WebSocketConfig;
}

const parseBool = (v: string | undefined, fallback: boolean): boolean => {
  if (v === undefined) return fallback;
  return v.toLowerCase() === 'true' || v === '1';
};

const parseInt10 = (v: string | undefined, fallback: number): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : fallback;
};

export default (): RootConfig => ({
  app: {
    port: parseInt10(process.env.PORT, 3000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    appName: process.env.APP_NAME ?? 'smart-control-backend',
    apiPrefix: process.env.API_PREFIX ?? '/api',
    apiTimeout: parseInt10(process.env.API_TIMEOUT, 30000),
  },
  database: {
    path: resolve(process.cwd(), process.env.DB_PATH ?? './database/smart-control.db'),
    synchronize: parseBool(process.env.DB_SYNCHRONIZE, true),
    logging: parseBool(process.env.DB_LOGGING, false),
  },
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    dir: resolve(process.cwd(), process.env.LOG_DIR ?? './logs'),
    maxFiles: process.env.LOG_MAX_FILES ?? '14d',
    maxSize: process.env.LOG_MAX_SIZE ?? '20m',
  },
  adapter: {
    mock: parseBool(process.env.MOCK_MODE, true),
    mockLatencyMs: parseInt10(process.env.MOCK_LATENCY_MS, 80),
  },
  websocket: {
    path: process.env.WS_PATH ?? '/ws/status',
  },
});
