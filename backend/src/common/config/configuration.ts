import { isAbsolute, resolve } from 'path';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  appName: string;
  apiPrefix: string;
  apiTimeout: number;
  /** Sprint-01 现场部署: 主机型号 (例 GIADA GK9000) */
  hostMachine: string;
  /** 平台标识 (windows / linux / darwin), 优先取 env, 默认 process.platform */
  platform: string;
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

/**
 * 跨平台路径解析: 绝对路径 (D:\smart-control\... 或 /srv/...) 原样返回;
 * 相对路径基于 process.cwd() 解析。
 */
const resolvePath = (raw: string | undefined, fallback: string): string => {
  const p = raw ?? fallback;
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
};

export default (): RootConfig => ({
  app: {
    port: parseInt10(process.env.PORT, 3000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    appName: process.env.APP_NAME ?? 'smart-control-backend',
    apiPrefix: process.env.API_PREFIX ?? '/api',
    apiTimeout: parseInt10(process.env.API_TIMEOUT, 30000),
    hostMachine: process.env.HOST_MACHINE ?? '',
    platform: (process.env.PLATFORM ?? process.platform).toLowerCase(),
  },
  database: {
    path: resolvePath(process.env.DB_PATH, './database/smart-control.db'),
    synchronize: parseBool(process.env.DB_SYNCHRONIZE, true),
    logging: parseBool(process.env.DB_LOGGING, false),
  },
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    dir: resolvePath(process.env.LOG_DIR, './logs'),
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
