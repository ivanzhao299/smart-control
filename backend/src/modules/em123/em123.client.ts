/**
 * em123 智慧能源管理平台 (若依 RuoYi v4.7.2 预付费抄表 SaaS) HTTP 客户端。
 *
 * 鉴权与数据约定 (均已在平台侧实测):
 *   - 登录: POST /login, 表单 username/password/rememberMe, 无验证码, 成功返回
 *           { code:0, msg:"操作成功" } 并经 Set-Cookie 下发 JSESSIONID 类会话 Cookie。
 *   - 数据: 全部 POST, Content-Type: application/x-www-form-urlencoded,
 *           头 X-Requested-With: XMLHttpRequest, 携带登录 Cookie; 直接 GET 会报 500。
 *   - 只读: 会话过期/302 时重新登录后重试一次 (登录并发去重)。
 *
 * 一期 (PWA 能源管理后台, 只读):
 *   - 缴费流水 /record/charge/list、控制记录 /record/control/list 分页查询 (字段原样透传)。
 *   - 平台导出代理: POST /xxx/export 触发生成 → GET /common/download 取回真实 xlsx。
 *   - 只读召测 POST /record/meter/reading: 仅触发平台立即抄一次表, 不改任何状态/不合闸不写卡。
 *
 * 二/三期 (PWA 物业/财务运营, 会改平台数据/资金/供电):
 *   - 只读回显: 住房 /basic/house/list、住房树 /basic/house/treeData、业主 /basic/user/list
 *     (改名/档案/充值前必须先回显, 拿到完整行 + 隐藏 id/parentId/priceId/绑定关系)。
 *   - 写: 住房/业主改名、表档案编辑、现金/补量录入、退费/减免/预值、换表、
 *     拉合闸/校时/多费率。写操作统一走 writeCommand。
 *
 * 【资金/供电安全铁律】写操作 writeCommand 与只读 postForm 不同:
 *   - 写前主动刷新一次会话 (避免会话失效), 然后只发一次, 绝不自动重试
 *     (防止重复扣款 / 重复拉闸); 若仍遇会话失效/非 JSON, 直接抛错并标注"结果未确认",
 *     由 service 层在重新读取最新状态、人工确认无重复后再决定是否重试。
 *   - 平台业务成败 (code != 0) 不抛, 原样返回 ok=false, 由 service 落 failed 留痕。
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

/** 平台任意业务列表行 (缴费/控制记录等), 字段原样透传, 不在后端强类型化。 */
export type Em123RawRow = Record<string, unknown>;

/** 导出两步结果: 真实 xlsx 字节 + 平台返回的文件名。 */
export interface Em123ExportFile {
  buffer: Buffer;
  fileName: string;
}

/**
 * 写操作统一结果。业务成败 (平台 code) 不抛错, 由 service 落留痕;
 * 仅网络/会话/非 JSON 等"结果未确认"情况才抛错 (且不自动重试)。
 */
export interface Em123WriteResult {
  /** 平台是否明确返回成功 (code === 0 或 200)。 */
  ok: boolean;
  /** 平台业务码; 无法解析为 JSON 时为 null。 */
  code: number | null;
  msg: string;
  /** 平台原始返回 (除 code/msg 外可能含 data)。 */
  raw: Record<string, unknown>;
}

/** 写操作发出后无法确认结果 (会话失效 / 非 JSON) —— 禁止自动重试。 */
export class Em123WriteUnconfirmedError extends Error {
  constructor(
    public readonly path: string,
    message: string,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'Em123WriteUnconfirmedError';
  }
}

/**
 * 退费表单回显: GET /record/refund/add/{recordId} 解析出的隐藏字段与基准信息。
 * 退费必须先回显拿到系统生成的 refundNo/seleNo 等, 再连同 refundMoney 提交。
 */
export interface Em123RefundForm {
  recordId: string;
  /** 表单全部 hidden input 的 name/value (原样回填提交)。 */
  hidden: Record<string, string>;
  /** 原充值金额 (只读, 退费上限)。 */
  chargeMoney: number | null;
  houseId?: string;
  meterId?: string;
  userId?: string;
  houseName?: string;
  meterNo?: string;
  userName?: string;
}

/**
 * 多费率设置回显 (GET /record/control/setrate/{meterId})。
 * 平台把"多费率配置方案"做成下拉 (rateId); 提交时 meterIds + rateId 下发。
 */
export interface Em123SetRateForm {
  meterId: string;
  /** hidden meterIds (单表即该表 meterId)。 */
  meterIds: string;
  /** 可选费率方案 (服务端渲染的 rateId 下拉)。 */
  rateOptions: { value: string; label: string }[];
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

  /**
   * 通用分页列表查询 (一期: 缴费流水/控制记录等后台业务表)。
   * 查询参数由调用方原样透传 (pageNum/pageSize/时间/方式/状态/关键字); 只走 POST 表单,
   * 平台业务行字段较多且会随版本变化, 后端不做字段裁剪, 原样返回给前端展示。
   */
  async fetchList(
    path: string,
    params: Record<string, string | number>,
  ): Promise<RuoYiRows<Em123RawRow>> {
    return this.postForm<RuoYiRows<Em123RawRow>>(path, {
      pageSize: 20,
      pageNum: 1,
      ...params,
    });
  }

  /** 缴费流水分页 (POST /record/charge/list), 只读。 */
  fetchCharges(params: Record<string, string | number>) {
    return this.fetchList('/record/charge/list', params);
  }

  /** 控制记录分页 (POST /record/control/list), 只读。 */
  fetchControlRecords(params: Record<string, string | number>) {
    return this.fetchList('/record/control/list', params);
  }

  /**
   * 只读召测 (POST /record/meter/reading): 请求平台立即对指定表抄读一次。
   * 这是查询性质的"指令"——只触发一次读表, 不改变开关/不充值/不改任何状态。
   * @param meterIds 逗号分隔的 meterId 列表 (如 "9988" 或 "9988,9989")
   */
  async requestReadout(meterIds: string): Promise<RuoYiRows<unknown>> {
    const ids = String(meterIds ?? '').trim();
    if (!ids) throw new Error('meterIds 不能为空');
    return this.postForm<RuoYiRows<unknown>>('/record/meter/reading', { meterIds: ids });
  }

  /**
   * 平台导出两步代理 (只读, 取回真实 xlsx):
   *   1) POST ${exportPath} (如 /record/charge/export) 触发生成, 返回 { code:0, msg:"<文件名>.xlsx" };
   *   2) GET  /common/download?fileName=<encode>&delete=false 带 Cookie 取回二进制。
   * 返回原始字节与文件名; 校验 PK 头确保不是登录页/错误页 HTML。
   */
  async exportFile(
    exportPath: string,
    params: Record<string, string | number>,
  ): Promise<Em123ExportFile> {
    const j = await this.postForm<RuoYiRows<unknown>>(exportPath, params);
    const fileName = String(j.msg ?? '').trim();
    if (!fileName) throw new Error(`导出 ${exportPath} 未返回文件名`);
    const buffer = await this.downloadCommon(fileName);
    return { buffer, fileName };
  }

  /** 带 Cookie 下载 /common/download, 会话过期重登一次; 校验 xlsx PK 头。 */
  private async downloadCommon(fileName: string): Promise<Buffer> {
    const url = `${this.baseUrl}/common/download?fileName=${encodeURIComponent(
      fileName,
    )}&delete=false`;
    const doGet = (): Promise<Response> =>
      fetch(url, {
        method: 'GET',
        headers: { Accept: '*/*', ...(this.cookie ? { Cookie: this.cookie } : {}) },
        redirect: 'manual',
        signal: AbortSignal.timeout(Math.max(this.timeoutMs, 60_000)),
      });

    if (!this.cookie) await this.login();
    let resp = await doGet();
    if (resp.status === 302 || resp.status === 0) {
      this.cookie = '';
      await this.login();
      resp = await doGet();
    }
    if (!resp.ok) throw new Error(`下载导出文件失败 HTTP ${resp.status}`);
    const contentType = resp.headers.get('content-type') ?? '';
    const buf = Buffer.from(await resp.arrayBuffer());
    // 真实 xlsx 以 PK\x03\x04 开头; 若拿到 HTML (登录页/错误页), 抛出可读错误。
    if (buf.length < 4 || buf[0] !== 0x50 || buf[1] !== 0x4b) {
      const head = buf.toString('utf8', 0, Math.min(buf.length, 200)).replace(/\s+/g, ' ');
      throw new Error(`下载内容不是有效 xlsx (content-type=${contentType || '未知'}) ${head.slice(0, 120)}`);
    }
    return buf;
  }

  // ===========================================================================
  // 二/三期: 只读回显 + 写操作
  // ===========================================================================

  /**
   * 带 Cookie 的 GET JSON (少数 GET 接口, 如 /basic/house/treeData); 只读, 会话失效重登一次。
   * 与写操作不同, GET 幂等可安全重试。
   */
  /** 带 Cookie 的 GET, 返回 {status,text}; 只读, 会话失效重登一次。 */
  private async getText(path: string): Promise<{ status: number; text: string }> {
    const doGet = (): Promise<Response> =>
      fetch(`${this.baseUrl}${path}`, {
        method: 'GET',
        headers: {
          'X-Requested-With': 'XMLHttpRequest',
          Accept: 'application/json, text/plain, */*',
          ...(this.cookie ? { Cookie: this.cookie } : {}),
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    if (!this.cookie) await this.login();
    let resp = await doGet();
    if (resp.status === 302 || resp.status === 0) {
      this.cookie = '';
      await this.login();
      resp = await doGet();
    }
    return { status: resp.status, text: await resp.text() };
  }

  private async getJson<T>(path: string): Promise<T> {
    const { status, text } = await this.getText(path);
    const json = this.tryJson<T>(text);
    if (!json) throw new Error(`em123 GET ${path} 返回非 JSON (HTTP ${status})`);
    return json;
  }

  /**
   * 住房（客户名）列表 /basic/house/list (POST, 全量约 157 户)。
   * 注意该接口不返回分页 {rows}, 而直接返回住房数组。改名/绑定前回显, 字段原样透传。
   */
  async fetchHouses(): Promise<Em123RawRow[]> {
    const j = (await this.postForm<RuoYiRows<unknown>>('/basic/house/list', {})) as unknown;
    return Array.isArray(j) ? (j as Em123RawRow[]) : [];
  }

  /** 住房树 /basic/house/treeData (GET), 节点 {id,pId,name,title,type}, 用于选择上级/绑定住房。 */
  async fetchHouseTree(): Promise<Em123RawRow[]> {
    const j = await this.getJson<unknown>('/basic/house/treeData');
    return Array.isArray(j) ? (j as Em123RawRow[]) : [];
  }

  /** 业主（户名）分页列表 /basic/user/list (改名/电话前回显), 字段原样透传。 */
  fetchUsers(params: Record<string, string | number> = {}) {
    return this.fetchList('/basic/user/list', params);
  }

  /**
   * 写操作统一通道 (资金/供电安全铁律):
   * 写前主动刷新一次会话 → 只发一次 → 绝不自动重试。
   * 业务成败 (code != 0) 不抛, 返回 ok=false 由 service 落 failed;
   * 会话失效/非 JSON 等"结果未确认"抛 Em123WriteUnconfirmedError, 不重发。
   */
  async writeCommand(
    path: string,
    params: Record<string, string | number>,
  ): Promise<Em123WriteResult> {
    // 写前刷新会话, 把"写时会话已过期"的概率降到最低, 从而不需要重试。
    this.cookie = '';
    await this.login();
    const resp = await this.rawPost(path, params);
    const text = await resp.text();
    const json = this.tryJson<RuoYiRows<unknown>>(text);
    if (this.isSessionExpired(resp, json)) {
      // 最危险情形: 无法确认平台是否已执行。绝不重发。
      throw new Em123WriteUnconfirmedError(
        path,
        `写操作 ${path} 提交后会话失效/登录页, 操作结果未确认, 系统未自动重试。请先刷新查询最新状态、确认无重复后再手动决定。`,
        resp.status,
      );
    }
    if (!json) {
      throw new Em123WriteUnconfirmedError(
        path,
        `写操作 ${path} 返回非 JSON (HTTP ${resp.status}), 操作结果未确认, 系统未自动重试。请核对最新状态后再决定。`,
        resp.status,
      );
    }
    const code = typeof json.code === 'number' ? json.code : null;
    const ok = code === 0 || code === 200;
    return { ok, code, msg: String(json.msg ?? ''), raw: json };
  }

  /**
   * 新增/编辑住房 /basic/house/edit (完整表单)。
   * params 由 service 用回显行 + 修改字段构造 (含 houseId/parentId/houseName/fullName/houseType 等)。
   */
  saveHouse(params: Record<string, string | number>) {
    return this.writeCommand('/basic/house/edit', params);
  }

  /** 新增/编辑业主 /basic/user/edit (完整表单, 含 userId/userName/userPhone/绑定住房/remark)。 */
  saveUser(params: Record<string, string | number>) {
    return this.writeCommand('/basic/user/edit', params);
  }

  /** 编辑电/水表档案 /basic/meter/edit (完整表单: 表号/型号/倍率/价格/告警/绑定住房)。 */
  saveMeter(params: Record<string, string | number>) {
    return this.writeCommand('/basic/meter/edit', params);
  }

  /** 现金 / 补量录入 /record/charge/add (chargeMode 仅 cash/补量; 金额与前后余额由 service 校验)。 */
  cashCharge(params: Record<string, string | number>) {
    return this.writeCommand('/record/charge/add', params);
  }

  /**
   * 退费表单回显 (GET /record/refund/add/{recordId}): 解析隐藏字段与原充值金额。
   * 退费必须先回显: 系统在打开表单时生成 refundNo/seleNo 等, 提交时原样回填。
   * 仅成功缴费单可退, 否则平台返回错误页。
   */
  async fetchRefundForm(recordId: string | number): Promise<Em123RefundForm> {
    const id = encodeURIComponent(String(recordId));
    const { status, text } = await this.getText(`/record/refund/add/${id}`);
    if (status !== 200 || !text.includes('form-refund-add')) {
      const head = text.replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(`退费单 ${recordId} 不可退或回显失败 (HTTP ${status}): ${head}`);
    }
    const hidden: Record<string, string> = {};
    for (const m of text.matchAll(/<input[^>]*type=["']hidden["'][^>]*>/g)) {
      const tag = m[0];
      const name = tag.match(/name=["']([^"']*)["']/)?.[1];
      const value = tag.match(/value=["']([^"']*)["']/)?.[1] ?? '';
      if (name) hidden[name] = value;
    }
    const readOnly = (name: string): string | undefined => {
      const mm = text.match(
        new RegExp(`<input[^>]*name=["']${name}["'][^>]*value=["']([^"']*)["']`),
      );
      return mm?.[1];
    };
    const cm = readOnly('chargeMoney');
    const textVal = (name: string): string | undefined => {
      // 普通文本/只读框
      const mm = text.match(
        new RegExp(`name=["']${name}["'][^>]*value=["']([^"']*)["']`),
      );
      return mm?.[1];
    };
    return {
      recordId: String(recordId),
      hidden,
      chargeMoney: cm === undefined ? null : Number(cm),
      houseId: hidden.houseId,
      meterId: hidden.meterId,
      userId: hidden.userId,
      houseName: textVal('houseName'),
      meterNo: textVal('meterNo'),
      userName: textVal('userName'),
    };
  }

  /** 退费提交 (POST /record/refund/add/{recordId}); params 由 service 用回显 hidden + refundMoney/refundMode/remark 构造。 */
  refund(recordId: string | number, params: Record<string, string | number>) {
    const id = encodeURIComponent(String(recordId));
    return this.writeCommand(`/record/refund/add/${id}`, params);
  }

  /**
   * 减免提交 POST /record/reduction/add。
   * 平台按"住房树多选 + 表类型"批量减免: { deptId, houseIds(逗号分隔), meterType:E|W, reductionMoney, remark }。
   * 单表进入时由 service 把 houseIds 收敛为该表所属住房。params 由 service 回显后构造。
   */
  reduction(params: Record<string, string | number>) {
    return this.writeCommand('/record/reduction/add', params);
  }

  /**
   * 多费率设置回显 GET /record/control/setrate/{meterId}。
   * 解析 form-meter-setrate 里的 meterIds hidden 与 rateId 下拉选项。
   */
  async fetchSetRateForm(meterId: string | number): Promise<Em123SetRateForm> {
    const id = encodeURIComponent(String(meterId));
    const { status, text } = await this.getText(`/record/control/setrate/${id}`);
    if (status !== 200 || !text.includes('form-meter-setrate')) {
      const head = text.replace(/\s+/g, ' ').slice(0, 160);
      throw new Error(`多费率设置回显失败 (HTTP ${status}): ${head}`);
    }
    const meterIds =
      text.match(/name=["']meterIds["'][^>]*value=["']([^"']*)["']/)?.[1] ?? String(meterId);
    const sel = text.match(/<select[^>]*name=["']rateId["'][^>]*>([\s\S]*?)<\/select>/)?.[1] ?? '';
    const rateOptions: { value: string; label: string }[] = [];
    for (const m of sel.matchAll(/<option\s+value=["']([^"']*)["'][^>]*>([\s\S]*?)<\/option>/g)) {
      rateOptions.push({ value: m[1], label: m[2].trim() });
    }
    return { meterId: String(meterId), meterIds, rateOptions };
  }

  /** 预值 /record/preset。 */
  preset(params: Record<string, string | number>) {
    return this.writeCommand('/record/preset', params);
  }

  /** 换表 (旧表数据结转后换表) /record/change/add/{meterIds}。 */
  changeMeter(meterIds: string, params: Record<string, string | number>) {
    const ids = String(meterIds ?? '').trim();
    if (!ids) throw new Error('meterIds 不能为空');
    return this.writeCommand(`/record/change/add/${encodeURIComponent(ids)}`, params);
  }

  /**
   * 远程控制 /record/control/{action} (高危):
   *  wattoff 拉闸(断电) / watton 合闸(送电) / settime 校时 / setrate 多费率。
   * 仅 service 层在 admin 强授权 + 强二次确认 (输入户名+原因) 后调用, 全量留痕。
   */
  remoteControl(
    action: 'wattoff' | 'watton' | 'settime' | 'setrate',
    params: Record<string, string | number>,
  ) {
    const allowed = ['wattoff', 'watton', 'settime', 'setrate'] as const;
    if (!allowed.includes(action)) throw new Error(`不支持的控制动作: ${action}`);
    return this.writeCommand(`/record/control/${action}`, params);
  }
}
