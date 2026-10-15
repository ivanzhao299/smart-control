/**
 * em123 智慧能源管理平台 (若依 RuoYi v4.7.2 预付费抄表 SaaS) HTTP 客户端。
 *
 * 鉴权与数据约定 (均已在平台侧实测):
 *   - 登录: POST /login, 表单 username/password/rememberMe, 无验证码, 成功返回
 *           { code:0, msg:"操作成功" } 并经 Set-Cookie 下发 JSESSIONID 类会话 Cookie。
 *   - 数据: 全部 POST, Content-Type: application/x-www-form-urlencoded,
 *           头 X-Requested-With: XMLHttpRequest, 携带登录 Cookie; 直接 GET 会报 500。
 *   - 会话过期/302 时重新登录后重试一次 (登录并发去重)。
 *
 * 本客户端只做只读取数, 不封装任何拉合闸/写操作。
 */

export interface Em123ClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
}

/** /basic/meter/list 原始行 (仅声明用到字段, 其余保留)。 */
export interface Em123MeterRaw {
  meterId?: number | string;
  meterNo?: string;
  meterType?: string;
  meterName?: string;
  meterModel?: string;
  modelName?: string;
  deviceImei?: string;
  iccid?: string;
  connType?: string;
  multiply?: number | string;
  priceId?: number | string;
  priceName?: string;
  readingValue?: number | string;
  readingTime?: string;
  chargeMoney?: number | string;
  onlineStatus?: string;
  onlineTime?: string;
  offlineTime?: string;
  meterStatus?: string;
  alarmName?: string;
  houseId?: number | string;
  houseName?: string;
  deptId?: number | string;
  deptName?: string;
  [key: string]: unknown;
}

/** /report/record/usage/list 原始行 (按日用量)。 */
export interface Em123UsageRaw {
  reportId?: number | string;
  houseId?: number | string;
  houseName?: string;
  meterId?: number | string;
  meterNo?: string;
  meterType?: string;
  /** 该天日期 YYYY-MM-DD (平台字段名沿用 reportMonth) */
  reportMonth?: string;
  /** 当日起读数 */
  minValue?: number | string;
  /** 当日止读数 */
  maxValue?: number | string;
  /** 当日用量 (电 kWh / 水 t, 已乘倍率) */
  useLimit?: number | string;
  /** 当日费用 (元) */
  useMoney?: number | string;
  [key: string]: unknown;
}

/**
 * /record/meter/list 原始行 (抄表记录, 每小时一条定时抄表)。
 * 用于把三相关口总表的小时累计读数差分还原成小时负荷。
 * 注意: readingValue/lastResult 为原始字轮读数; useLimit 已乘倍率, 是本次抄表间隔的用量(kWh)。
 */
export interface Em123HourlyRaw {
  recordId?: number | string;
  meterId?: number | string;
  meterNo?: string;
  meterType?: string;
  /** 上次抄表读数 (原始字轮) */
  lastResult?: number | string;
  /** 上次抄表时间 YYYY-MM-DD HH:MM:SS */
  lastTime?: string;
  /** 本次抄表读数 (原始字轮) */
  readingValue?: number | string;
  /** 本次抄表时间 YYYY-MM-DD HH:MM:SS */
  readingTime?: string;
  /** 本次间隔用量 (已乘倍率, kWh 电 / t 水) */
  useLimit?: number | string;
  useMoney?: number | string;
  /** 信号强度 (dBm, 字符串) */
  csq?: string | null;
  /** 抄表类型: '0'=定时上报(每小时) / '1'=手动实时召测(间隔不规整, 不参与小时负荷) */
  readingType?: string;
  houseName?: string;
  [key: string]: unknown;
}

interface RuoYiRows<T> {
  code?: number;
  msg?: string;
  total?: number;
  rows?: T[];
  [key: string]: unknown;
}

const PAGE_SIZE = 500; // 表档案分页 (全园区仅 148 块, 1 页)
const USAGE_PAGE_SIZE = 1000; // 日用量分页: 单页数据量小、响应快(约 15~25s), 避开平台 60s 超时; 按月分块单月 ~4 页
const HOURLY_PAGE_SIZE = 500; // 单表小时抄表分页: 每小时 1 条, 近 30 天 720 条, 2 页内

export class Em123Client {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly timeoutMs: number;
  private cookie = '';
  private loginChain: Promise<void> | null = null;

  constructor(opts: Em123ClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.username = opts.username;
    this.password = opts.password;
    this.timeoutMs = opts.timeoutMs;
  }

  /** 登录并保存会话 Cookie (并发去重)。 */
  private async login(): Promise<void> {
    if (this.loginChain) return this.loginChain;
    this.loginChain = (async () => {
      const body = new URLSearchParams({
        username: this.username,
        password: this.password,
        rememberMe: 'false',
      });
      const resp = await fetch(`${this.baseUrl}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/plain, */*',
        },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      const cookies = this.readSetCookies(resp);
      if (cookies.length === 0) {
        // 个别情况下会话 cookie 在 follow 后才稳; manual 无 cookie 也记录, 交由后续判定。
      }
      this.cookie = cookies.join('; ');
      let json: RuoYiRows<unknown> | null = null;
      try {
        json = (await resp.json()) as RuoYiRows<unknown>;
      } catch {
        json = null;
      }
      if (json && json.code !== undefined && json.code !== 0) {
        throw new Error(`em123 登录失败: ${json.msg ?? 'code=' + json.code}`);
      }
      if (!this.cookie) {
        throw new Error('em123 登录未返回会话 Cookie');
      }
    })().finally(() => {
      this.loginChain = null;
    });
    return this.loginChain;
  }

  /** 兼容地读取 Set-Cookie 数组, 取每段的 name=value。 */
  private readSetCookies(resp: Response): string[] {
    const headers = resp.headers as unknown as {
      getSetCookie?: () => string[];
    };
    let raw: string[] = [];
    if (typeof headers.getSetCookie === 'function') {
      raw = headers.getSetCookie();
    } else {
      const single = resp.headers.get('set-cookie');
      if (single) raw = [single];
    }
    return raw
      .map((c) => c.split(';')[0]?.trim())
      .filter((c): c is string => Boolean(c) && c.includes('='));
  }

  /** 一次表单 POST, 返回原始 Response (manual, 不跟随重定向)。 */
  private async rawPost(path: string, params: Record<string, string | number>): Promise<Response> {
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) body.set(k, String(v));
    return fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        Accept: 'application/json, text/plain, */*',
        ...(this.cookie ? { Cookie: this.cookie } : {}),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  /** 判定响应是否为会话失效 (302/登录页/未授权 JSON)。 */
  private isSessionExpired(resp: Response, json: RuoYiRows<unknown> | null): boolean {
    if (resp.status === 302 || resp.status === 0) return true;
    const ct = resp.headers.get('content-type') ?? '';
    if (!json && !ct.includes('json')) return true;
    if (json && json.code !== undefined && json.code !== 0) {
      const msg = String(json.msg ?? '');
      return /登录|超时|未授权|认证|过期|请重新/.test(msg);
    }
    return false;
  }

  /** 带会话的表单 POST, 会话失效则重登一次并重试。 */
  private async postForm<T extends RuoYiRows<unknown>>(
    path: string,
    params: Record<string, string | number>,
  ): Promise<T> {
    if (!this.cookie) await this.login();
    let resp = await this.rawPost(path, params);
    let json: T | null = this.tryJson<T>(await resp.text());
    if (this.isSessionExpired(resp, json)) {
      this.cookie = '';
      await this.login();
      resp = await this.rawPost(path, params);
      json = this.tryJson<T>(await resp.text());
    }
    if (!json) throw new Error(`em123 接口 ${path} 返回非 JSON (HTTP ${resp.status})`);
    if (json.code !== undefined && json.code !== 0) {
      throw new Error(`em123 接口 ${path} 失败: ${json.msg ?? 'code=' + json.code}`);
    }
    return json;
  }

  private tryJson<T>(text: string): T | null {
    const trimmed = text.trim();
    if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return null;
    try {
      return JSON.parse(trimmed) as T;
    } catch {
      return null;
    }
  }

  /** 拉取某类表 (E 电 / W 水) 全量档案+实时读数/状态, 自动分页。 */
  async fetchMeters(meterType: 'E' | 'W'): Promise<Em123MeterRaw[]> {
    const out: Em123MeterRaw[] = [];
    let pageNum = 1;
    for (;;) {
      const j = await this.postForm<RuoYiRows<Em123MeterRaw>>('/basic/meter/list', {
        pageSize: PAGE_SIZE,
        pageNum,
        meterType,
        orderByColumn: 'houseName',
        isAsc: 'asc',
      });
      const rows = j.rows ?? [];
      out.push(...rows);
      const total = Number(j.total ?? out.length);
      if (out.length >= total || rows.length === 0) break;
      pageNum += 1;
      if (pageNum > 50) break; // 安全上限
    }
    return out;
  }

  /**
   * 拉取区间内全部表的按日用量 (不传 meterNo 即全量, 行内含 meterType 区分水电),
   * 自动分页。begin/end 为 YYYY-MM-DD。
   */
  async fetchUsage(begin: string, end: string): Promise<Em123UsageRaw[]> {
    const out: Em123UsageRaw[] = [];
    let pageNum = 1;
    for (;;) {
      const j = await this.postForm<RuoYiRows<Em123UsageRaw>>('/report/record/usage/list', {
        pageSize: USAGE_PAGE_SIZE,
        pageNum,
        isAsc: 'asc',
        'params[beginTime]': begin,
        'params[endTime]': end,
      });
      const rows = j.rows ?? [];
      out.push(...rows);
      const total = Number(j.total ?? out.length);
      if (out.length >= total || rows.length === 0) break;
      pageNum += 1;
      if (pageNum > 20) break; // 按月分块后单块安全上限 (约 6 万行)
    }
    return out;
  }

  /**
   * 拉取单块表在区间内的抄表记录 (POST /record/meter/list, 按 meterNo 单表查询)。
   * 只取 readingType=0 的定时上报 (每小时一条, 间隔规整), 手动实时召测(1)不参与小时负荷。
   * begin/end 为 YYYY-MM-DD; 跨月同样可能丢下月, 由 service 按自然月分块。
   */
  async fetchHourlyRecords(meterNo: string, begin: string, end: string): Promise<Em123HourlyRaw[]> {
    const out: Em123HourlyRaw[] = [];
    let pageNum = 1;
    for (;;) {
      const j = await this.postForm<RuoYiRows<Em123HourlyRaw>>('/record/meter/list', {
        pageSize: HOURLY_PAGE_SIZE,
        pageNum,
        meterNo,
        readingType: '0',
        isAsc: 'asc',
        'params[beginTime]': begin,
        'params[endTime]': end,
      });
      const rows = (j.rows ?? []).filter((r) => String(r.readingType ?? '0') === '0');
      out.push(...rows);
      const total = Number(j.total ?? out.length);
      // 该页原始条数(含被过滤的召测)为 0 才判定结束, 避免漏掉后续页
      if (out.length >= total || (j.rows ?? []).length === 0) break;
      pageNum += 1;
      if (pageNum > 20) break; // 单表安全上限
    }
    return out;
  }

  /** 轻量健康检查: 登录 + 拉一页电表。 */
  async healthCheck(): Promise<{ ok: true; meterCount: number }> {
    const rows = await this.fetchMeters('E');
    return { ok: true, meterCount: rows.length };
  }
}
