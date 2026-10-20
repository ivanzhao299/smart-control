import { EwelinkApiAdapter } from './ewelink-api.adapter';

/**
 * 易微联云开关读数口径回归测试。
 * 控制命令接受字符串 'on'/'off'，但部分固件（如 UIID 226 计量开关 fw 1.2.1）
 * 回报的 params.switch 是布尔 true/false；两种口径都必须识别，否则实际 on 的
 * 设备会被误判成 off，造成电源页状态错乱、PWA 操作看似无效。
 */
describe('EwelinkApiAdapter 开关读数', () => {
  const config: any = { getOrThrow: () => ({ mock: false }) };
  const logger: any = { info() {}, warn() {}, error() {}, debug() {} };
  const hwRepo: any = {
    findOne: async () => ({ addressing: JSON.stringify({ deviceId: 'dev', channel: 0 }) }),
  };
  let params: any;
  const devices: any = { getRawParams: async () => ({ params }) };
  const adapter = new EwelinkApiAdapter(config, logger, hwRepo, devices);

  beforeEach(() => {
    params = {};
  });

  it('布尔 true 识别为合闸，并读取 phase_0_v 电压', async () => {
    params = { switch: true, phase_0_v: 237.12, phase_0_c: 0, phase_0_p: 0 };
    const r = await adapter.getMeasurements('EWE-x');
    expect(r.data?.switchState).toBe('closed');
    expect(r.data?.voltages[0]).toBe(237.12);
  });

  it('布尔 false 识别为分闸', async () => {
    params = { switch: false };
    const r = await adapter.getMeasurements('EWE-x');
    expect(r.data?.switchState).toBe('open');
  });

  it('字符串 on/off 仍正常识别', async () => {
    params = { switch: 'on', voltage: 220 };
    expect((await adapter.getMeasurements('EWE-x')).data?.switchState).toBe('closed');
    params = { switch: 'off' };
    expect((await adapter.getMeasurements('EWE-x')).data?.switchState).toBe('open');
  });

  it('多路 switches 布尔值按 outlet 识别', async () => {
    params = { switches: [{ outlet: 0, switch: true }, { outlet: 1, switch: false }] };
    expect((await adapter.getMeasurements('EWE-x')).data?.switchState).toBe('closed');
  });
});
