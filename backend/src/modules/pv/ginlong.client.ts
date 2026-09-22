import { createHash, createHmac } from 'crypto';

/**
 * 锦浪云 (Ginlong / SolisCloud) 开放 API 客户端。
 *
 * 单账号 HMAC-SHA1 鉴权 (非 OAuth2):
 *   Content-MD5 = base64(MD5(body 字节))
 *   StringToSign = POST\n{Content-MD5}\napplication/json\n{Date}\n{path}
 *     - 第三行 Content-Type 固定写 "application/json" (不带 charset),
 *       与实际请求头里的 "application/json;charset=UTF-8" 无关 (官方约定)。
 *   Date 为 GMT/RFC1123, 例 "Tue, 27 Jun 2023 11:21:04 GMT"。
 *   Authorization: API {KeyId}:{base64(HMAC-SHA1(KeySecret, StringToSign))}
 * 频控 2 次/秒; 本系统后端 60s 拉取一次, 远低于阈值。
 */

export interface GinlongCredentials {
  baseUrl: string;
  keyId: string;
  keySecret: string;
  timeoutMs: number;
}

/** userStationList 返回里的单条电站记录 (仅声明大屏用到的字段, 其余原样保留)。 */
export interface GinlongStationRecord {
  id?: string;
  stationName?: string;
  /** 装机容量 kWp (capacity1 同值) */
  capacity?: number;
  capacity1?: number;
  /** 当前功率 kW (power1 为 W) */
  power?: number;
  power1?: number;
  /** 当前功率 / 装机, 0~1 */
  capacityPercent?: number;
  /** 今日发电 MWh (dayEnergy1 为 kWh) */
  dayEnergy?: number;
  dayEnergy1?: number;
  monthEnergy?: number;
  monthEnergy1?: number;
  yearEnergy?: number;
  yearEnergy1?: number;
  /** 累计发电 MWh (allEnergy1 为 kWh) */
  allEnergy?: number;
  allEnergy1?: number;
  /** 本月减碳 (吨 CO₂) */
  monthCarbonDioxide?: number;
  inverterCount?: number;
  inverterOnlineCount?: number;
  /** 电站状态: 1=正常 */
  state?: number;
  /** 白天天气文案, 如 "晴" */
  condTxtD?: string;
  dataTimestampStr?: string;
  [key: string]: unknown;
}

export interface GinlongStationStatusVo {
  all?: number;
  normal?: number;
  fault?: number;
  offline?: number;
  building?: number;
  mppt?: number;
}

export interface GinlongStationListResponse {
  success?: boolean;
  code?: string | number;
  msg?: string;
  data?: {
    stationStatusVo?: GinlongStationStatusVo;
    page?: {
      records?: GinlongStationRecord[];
      total?: number;
      size?: number;
      current?: number;
      pages?: number;
    };
  };
  traceId?: string;
}

export interface GinlongAuthHeaders {
  'Content-MD5': string;
  'Content-Type': string;
  Date: string;
  Authorization: string;
}

export const GINLONG_STATION_LIST_PATH = '/v1/api/userStationList';

/** 计算锦浪请求签名头。date 可注入便于测试。 */
export function buildGinlongHeaders(
  keyId: string,
  keySecret: string,
  path: string,
  body: string,
  date: string = new Date().toUTCString(),
): GinlongAuthHeaders {
  const contentMd5 = createHash('md5').update(body, 'utf8').digest('base64');
  // 第三行固定 application/json (无 charset), 是锦浪签名规范, 不可改成实际 Content-Type。
  const stringToSign = ['POST', contentMd5, 'application/json', date, path].join('\n');
  const signature = createHmac('sha1', keySecret).update(stringToSign, 'utf8').digest('base64');
  return {
    'Content-MD5': contentMd5,
    'Content-Type': 'application/json;charset=UTF-8',
    Date: date,
    Authorization: `API ${keyId}:${signature}`,
  };
}

export class GinlongClient {
  constructor(private readonly cred: GinlongCredentials) {}

  /** 拉取当前账号下全部电站 (单接口已含大屏所需电站级指标, 无需再调逆变器明细)。 */
  async fetchStationList(): Promise<{
    records: GinlongStationRecord[];
    statusVo: GinlongStationStatusVo;
    raw: GinlongStationListResponse;
  }> {
    const path = GINLONG_STATION_LIST_PATH;
    const body = JSON.stringify({ pageNo: 1, pageSize: 100 });
    const headers = buildGinlongHeaders(
      this.cred.keyId,
      this.cred.keySecret,
      path,
      body,
    );

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cred.timeoutMs);
    let res: Response;
    try {
      res = await fetch(`${this.cred.baseUrl}${path}`, {
        method: 'POST',
        headers: { ...headers, Accept: 'application/json' },
        body,
        signal: controller.signal,
        // 锦浪为国内公网服务; keep-alive 复用连接。
        keepalive: false,
      });
    } catch (error) {
      throw new Error(`请求锦浪接口失败: ${(error as Error).message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let json: GinlongStationListResponse;
    try {
      json = JSON.parse(text) as GinlongStationListResponse;
    } catch {
      throw new Error(`锦浪接口返回非 JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new Error(`锦浪接口 HTTP ${res.status}: ${json?.msg ?? text.slice(0, 200)}`);
    }
    if (String(json?.code) !== '0') {
      throw new Error(`锦浪接口业务错误 code=${json?.code} msg=${json?.msg ?? ''}`);
    }
    return {
      records: json.data?.page?.records ?? [],
      statusVo: json.data?.stationStatusVo ?? {},
      raw: json,
    };
  }
}
