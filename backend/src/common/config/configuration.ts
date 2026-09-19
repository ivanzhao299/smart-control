import { isAbsolute, resolve } from 'path';
import { readFileSync } from 'fs';
import { parseCorsAllowedOrigins } from './cors';

export interface AppConfig {
  port: number;
  nodeEnv: string;
  appName: string;
  apiPrefix: string;
  apiTimeout: number;
  corsAllowedOrigins: string[];
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

/**
 * TestFlight 内部测试员邀请 (后台「iOS 测试」页)。
 * 服务端常驻一把 App Manager 专用 App Store Connect API 密钥, 直接调 ASC API。
 */
export interface TestFlightConfig {
  /** 密钥三要素齐全且未被 TESTFLIGHT_ENABLED=false 显式停用, 功能才真正可用 */
  enabled: boolean;
  /** 密钥三要素是否齐全 (用于后台页提示「未配置」) */
  configured: boolean;
  issuerId: string;
  keyId: string;
  /** PEM 形式的 P-8 私钥 (由 base64 / 文件路径 / 内联三种 env 之一解析) */
  privateKeyPem: string;
  /** ASC App AdamID, 默认金湖智控 */
  appId: string;
  bundleId: string;
  /** 内部 TestFlight 组名 */
  internalGroupName: string;
  /** 授予内部测试员的团队角色, 固定最小权限 MARKETING */
  testerRole: string;
}

export interface RootConfig {
  app: AppConfig;
  database: DatabaseConfig;
  logger: LoggerConfig;
  adapter: AdapterConfig;
  websocket: WebSocketConfig;
  testflight: TestFlightConfig;
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

const firstNonEmpty = (...vals: Array<string | undefined>): string =>
  vals.map((v) => (v ?? '').trim()).find((v) => v.length > 0) ?? '';

/**
 * 解析苹果 P-8 私钥, 三种给法按优先级:
 *   1) TESTFLIGHT_P8_BASE64 / APPSTORE_P8_BASE64 —— base64(整份 PEM), 部署推荐 (不进 git)
 *   2) TESTFLIGHT_P8_PATH / APPSTORE_P8_PATH     —— 服务器上的 .p8 文件绝对路径
 *   3) TESTFLIGHT_P8 / APPSTORE_P8               —— 内联 PEM (允许用 \n 表示换行)
 */
function loadApplePrivateKey(): string {
  const b64 = firstNonEmpty(process.env.TESTFLIGHT_P8_BASE64, process.env.APPSTORE_P8_BASE64);
  if (b64) {
    try {
      const pem = Buffer.from(b64, 'base64').toString('utf8');
      if (pem.includes('PRIVATE KEY')) return pem;
    } catch {
      /* fall through to path */
    }
  }
  const p = firstNonEmpty(process.env.TESTFLIGHT_P8_PATH, process.env.APPSTORE_P8_PATH);
  if (p) {
    try {
      return readFileSync(resolvePath(p, p), 'utf8');
    } catch {
      /* fall through */
    }
  }
  const inline = firstNonEmpty(process.env.TESTFLIGHT_P8, process.env.APPSTORE_P8);
  return inline ? inline.replace(/\\n/g, '\n') : '';
}

function buildTestFlightConfig(): TestFlightConfig {
  const issuerId = firstNonEmpty(process.env.TESTFLIGHT_ISSUER_ID, process.env.APPSTORE_ISSUER_ID);
  const keyId = firstNonEmpty(process.env.TESTFLIGHT_KEY_ID, process.env.APPSTORE_KEY_ID);
  const privateKeyPem = loadApplePrivateKey();
  const appId = firstNonEmpty(process.env.TESTFLIGHT_APP_ID) || '6795375392';
  const bundleId = firstNonEmpty(process.env.TESTFLIGHT_BUNDLE_ID) || 'com.jinhu.smartcontrol';
  const internalGroupName = firstNonEmpty(process.env.TESTFLIGHT_INTERNAL_GROUP_NAME) || '内部测试';
  const testerRole = (firstNonEmpty(process.env.TESTFLIGHT_TESTER_ROLE) || 'MARKETING').toUpperCase();
  const configured = Boolean(issuerId && keyId && privateKeyPem.includes('PRIVATE KEY'));
  const explicitlyDisabled = (process.env.TESTFLIGHT_ENABLED ?? '').toLowerCase() === 'false';
  return {
    enabled: configured && !explicitlyDisabled,
    configured,
    issuerId,
    keyId,
    privateKeyPem,
    appId,
    bundleId,
    internalGroupName,
    testerRole,
  };
}

export default (): RootConfig => ({
  app: {
    port: parseInt10(process.env.PORT, 3000),
    nodeEnv: process.env.NODE_ENV ?? 'development',
    appName: process.env.APP_NAME ?? 'smart-control-backend',
    apiPrefix: process.env.API_PREFIX ?? '/api',
    apiTimeout: parseInt10(process.env.API_TIMEOUT, 30000),
    corsAllowedOrigins: parseCorsAllowedOrigins(process.env.CORS_ALLOWED_ORIGINS, [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]),
    hostMachine: process.env.HOST_MACHINE ?? '',
    platform: (process.env.PLATFORM ?? process.platform).toLowerCase(),
  },
  database: {
    // Runtime cwd is backend/. Keep the default identical to the CLI, backup,
    // restore and deployment verifier so every process opens the same database.
    path: resolvePath(process.env.DB_PATH, '../database/smart-control.db'),
    synchronize: parseBool(process.env.DB_SYNCHRONIZE, false),
    logging: parseBool(process.env.DB_LOGGING, false),
  },
  logger: {
    level: process.env.LOG_LEVEL ?? 'info',
    dir: resolvePath(process.env.LOG_DIR, '../logs'),
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
  testflight: buildTestFlightConfig(),
});
