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
  let responses: Array<{ error: number; msg?: string }>;
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
    (global as any).fetch = jest.fn(async (url: string, init: any) => {
      fetchCalls.push({ url, init });
      const r = responses[Math.min(idx, responses.length - 1)];
      idx += 1;
      return { json: async () => r } as any;
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
});
