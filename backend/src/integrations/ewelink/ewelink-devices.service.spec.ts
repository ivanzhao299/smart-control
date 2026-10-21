import { EwelinkDevicesService } from './ewelink-devices.service';

/**
 * setSwitch 控制口径回归。
 * 标准易微联协议控制值为字符串 'on'/'off'；但 UIID 226 计量开关 fw 1.2.1 的
 * 控制接口要求布尔 true/false（字符串一律返回 4002）。setSwitch 必须按设备口径
 * 下发，且在口径未知时“字符串 4002 → 布尔”兜底，同时不破坏标准字符串设备。
 */
describe('EwelinkDevicesService.setSwitch 控制口径', () => {
  let auth: any;
  let fetchCalls: Array<{ url: string; init: any }>;
  let responses: any[];
  let svc: EwelinkDevicesService;

  beforeEach(() => {
    fetchCalls = [];
    responses = [];
    let idx = 0;
    auth = {
      ensureAccessToken: jest.fn(async () => ({ token: 'tok', region: 'cn', familyId: null })),
      getCredentials: jest.fn(async () => ({ appId: 'appid', appSecret: 'sec' })),
    };
    svc = new EwelinkDevicesService(
      {} as any,
      {} as any,
      auth,
      { info() {}, warn() {}, error() {}, debug() {} } as any,
    );
    // 模拟真实 Response：cloudFetch 走 resp.text() 再 JSON.parse，需提供 text/status/headers。
    // 元素可带 __status（HTTP 状态码）或 __raw（纯文本，如限流 invoke too fast）。
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      fetchCalls.push({ url, init });
      const r: any = responses[Math.min(idx, responses.length - 1)];
      idx += 1;
      const status = r?.__status ?? 200;
      const text = r?.__raw !== undefined ? String(r.__raw) : JSON.stringify(r);
      return {
        status,
        headers: { get: () => (r?.__raw !== undefined ? 'text/plain' : 'application/json') },
        text: async () => text,
        json: async () => (r?.__raw !== undefined ? JSON.parse(r.__raw) : r),
      } as any;
    });
  });

  const bodyOf = (i: number) => JSON.parse(fetchCalls[i].init.body);
  const headersOf = (i: number) => fetchCalls[i].init.headers;

  it('布尔口径设备下发 switch=true 且带 X-CK-Appid，只请求一次', async () => {
    responses = [{ error: 0 }];
    await svc.setSwitch('dev', 226, 0, true, 'boolean');
    expect(bodyOf(0).params.switch).toBe(true);
    expect(headersOf(0)['X-CK-Appid']).toBe('appid');
    expect(fetchCalls).toHaveLength(1);
  });

  it('布尔口径关闭下发 false', async () => {
    responses = [{ error: 0 }];
    await svc.setSwitch('dev', 226, 0, false, 'boolean');
    expect(bodyOf(0).params.switch).toBe(false);
  });

  it('字符串口径设备下发 on，只请求一次', async () => {
    responses = [{ error: 0 }];
    await svc.setSwitch('dev', 1, 0, true, 'string');
    expect(bodyOf(0).params.switch).toBe('on');
    expect(fetchCalls).toHaveLength(1);
  });

  it('多路设备按 outlet 下发布尔', async () => {
    responses = [{ error: 0 }];
    await svc.setSwitch('dev', 226, 2, true, 'boolean');
    expect(bodyOf(0).params.switches).toEqual([{ switch: true, outlet: 2 }]);
  });

  it('口径未知：字符串 4002 后用布尔重试成功', async () => {
    responses = [
      { error: 4002, msg: '控制失败' },
      { error: 0 },
    ];
    await svc.setSwitch('dev', 226, 0, true);
    expect(fetchCalls).toHaveLength(2);
    expect(bodyOf(0).params.switch).toBe('on');
    expect(bodyOf(1).params.switch).toBe(true);
  });

  it('口径未知：字符串 4002 后布尔仍失败则抛错', async () => {
    responses = [{ error: 4002 }, { error: 4002 }];
    await expect(svc.setSwitch('dev', 226, 0, true)).rejects.toThrow();
  });

  it('非 4002 错误（如设备离线）不换口径，直接抛错', async () => {
    responses = [{ error: 4012, msg: '设备离线' }];
    await expect(svc.setSwitch('dev', 1, 0, true)).rejects.toThrow();
    expect(fetchCalls).toHaveLength(1);
  });

  it('聚合总开关 setGroupSwitch：一次显式列出 4 路同值（不使用全开快捷命令）', async () => {
    responses = [{ error: 0 }];
    await svc.setGroupSwitch('dev', 138, 4, true, 'string');
    expect(bodyOf(0).params.switches).toEqual([
      { switch: 'on', outlet: 0 },
      { switch: 'on', outlet: 1 },
      { switch: 'on', outlet: 2 },
      { switch: 'on', outlet: 3 },
    ]);
    expect(fetchCalls).toHaveLength(1);
  });

  it('聚合总开关关闭：4 路全 off', async () => {
    responses = [{ error: 0 }];
    await svc.setGroupSwitch('dev', 138, 4, false, 'string');
    expect(bodyOf(0).params.switches.every((s: any) => s.switch === 'off')).toBe(true);
  });

  it('限流 429 纯文本 invoke too fast：退避重试后成功，不抛 JSON 解析错误', async () => {
    responses = [{ __status: 429, __raw: 'invoke too fast' }, { error: 0 }];
    await svc.setSwitch('dev', 1, 0, true, 'string');
    expect(fetchCalls).toHaveLength(2);
  }, 10000);
});

/**
 * 聚合回归：isSupportChannelSplit=false 的多路设备（官方 App 只显示一个总开关）
 * 不得被拆成 N 张卡；必须归一为 1 个 grouped 总开关，并保留物理路数供整组下发。
 */
describe('EwelinkDevicesService.normalize 聚合（isSupportChannelSplit）', () => {
  function makeService(thingList: any[]): EwelinkDevicesService {
    const auth: any = {
      ensureAccessToken: jest.fn(async () => ({ token: 'tok', region: 'cn', familyId: null })),
      getCredentials: jest.fn(async () => ({ appId: 'appid', appSecret: 'sec' })),
    };
    const svc = new EwelinkDevicesService(
      {} as any,
      {} as any,
      auth,
      { info() {}, warn() {}, error() {}, debug() {} } as any,
    );
    (global as any).fetch = jest.fn(async () => ({
      status: 200,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: 0, data: { thingList } }),
      json: async () => ({ error: 0, data: { thingList } }),
    }));
    return svc;
  }

  const fourWay = (id: string, name: string, split: boolean, allOn: boolean) => ({
    itemType: 1,
    itemData: {
      deviceid: id,
      name,
      uiid: 138,
      online: true,
      isSupportChannelSplit: split,
      denyFeatures: ['allOnOff'],
      params: {
        switches: [0, 1, 2, 3].map((outlet) => ({
          outlet,
          switch: allOn ? 'on' : 'off',
        })),
      },
    },
  });

  it('isSupportChannelSplit=false 的 4 路设备聚合为 1 个总开关（grouped/outletCount=4）', async () => {
    const svc = makeService([fourWay('1002cbf50b', '西展厅', false, false)]);
    const things = await svc.listSwitchThings();
    expect(things).toHaveLength(1);
    const t = things[0];
    expect(t.grouped).toBe(true);
    expect(t.isSupportChannelSplit).toBe(false);
    expect(t.outletCount).toBe(4);
    expect(t.channels).toHaveLength(1);
    expect(t.channels[0].on).toBe(false);
  });

  it('聚合总开关：4 路全 on 时总开关 on，部分 on 时 off', async () => {
    const svcOn = makeService([fourWay('a', 'A', false, true)]);
    const on = await svcOn.listSwitchThings();
    expect(on[0].channels[0].on).toBe(true);

    const partial = {
      itemType: 1,
      itemData: {
        deviceid: 'b', name: 'B', uiid: 138, online: true,
        isSupportChannelSplit: false,
        params: { switches: [
          { outlet: 0, switch: 'on' }, { outlet: 1, switch: 'off' },
          { outlet: 2, switch: 'on' }, { outlet: 3, switch: 'off' },
        ] },
      },
    };
    const svcPart = makeService([partial]);
    const part = await svcPart.listSwitchThings();
    expect(part[0].channels[0].on).toBe(false);
  });

  it('isSupportChannelSplit=true 的 4 路设备仍拆为 4 个逻辑通道（向后兼容）', async () => {
    const svc = makeService([fourWay('x', '可拆', true, false)]);
    const things = await svc.listSwitchThings();
    expect(things[0].grouped).toBe(false);
    expect(things[0].channels).toHaveLength(4);
  });

  it('3 台四路聚合 + 2 台单路 = 5 个逻辑设备（不再是 14 张卡）', async () => {
    const single = (id: string, name: string, on: boolean) => ({
      itemType: 1,
      itemData: {
        deviceid: id, name, uiid: 226, online: true,
        isSupportChannelSplit: false,
        params: { switch: on },
      },
    });
    const svc = makeService([
      fourWay('1002cbf50b', '西展厅', false, false),
      fourWay('1002cbf4ef', '无纺布展厅', false, false),
      fourWay('1002cbf4eb', '金特夫展厅', false, false),
      single('1002b88e41', '展厅灯带', true),
      single('1002b8942a', '展厅筒灯射灯', true),
    ]);
    const things = await svc.listSwitchThings();
    expect(things).toHaveLength(5);
    expect(things.filter((t) => t.grouped)).toHaveLength(3);
  });
});
