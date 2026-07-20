/**
 * 告警外发 —— 行为测试。
 *
 * 这是"救命功能": 2026-07-19 GK9000 掉线 14 小时无人知晓, 就是因为告警送不出去。
 * 所以这里重点钉死三件事:
 *   1. 该发的必须发 (级别达标 / 恶化时突破节流)
 *   2. 不该发的不能发 (未配置 / 级别不够 / 短时间重复)
 *   3. **发送失败绝不能把主流程带崩** —— 告警落库在前, 推送只是附加
 */
import type { Logger } from 'winston';
import { AlertNotifierService, NotifyPayload } from './alert-notifier.service';

const fakeLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

/** env 在字段初始化时求值, 所以要"设 env → new → 还原" */
function makeNotifier(env: Record<string, string | undefined>): AlertNotifierService {
  const snapshot = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const svc = new AlertNotifierService(fakeLogger());
  process.env = snapshot;
  return svc;
}

const payload = (over: Partial<NotifyPayload> = {}): NotifyPayload => ({
  level: 'critical',
  type: 'site_offline',
  sourceType: 'site',
  sourceId: 'GK9000',
  title: '现场主机失联: GK9000',
  message: '已 20 分钟没有收到心跳',
  at: '2026-07-19T09:34:00.000Z',
  ...over,
});

describe('告警外发 · 开关与级别过滤', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
  });

  it('未配置 ALERT_WEBHOOK_URL → 不发, enabled=false', async () => {
    const svc = makeNotifier({ ALERT_WEBHOOK_URL: undefined });
    expect(svc.enabled).toBe(false);
    await svc.notify(payload());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('配了 URL → enabled=true, critical 正常发出', async () => {
    const svc = makeNotifier({ ALERT_WEBHOOK_URL: 'https://example.invalid/hook' });
    expect(svc.enabled).toBe(true);
    await svc.notify(payload());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('低于 minLevel 的不发 (默认 warning, info 被挡)', async () => {
    const svc = makeNotifier({ ALERT_WEBHOOK_URL: 'https://example.invalid/hook' });
    await svc.notify(payload({ level: 'info' }));
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('minLevel 可调高: 设成 critical 后 warning 被挡', async () => {
    const svc = makeNotifier({
      ALERT_WEBHOOK_URL: 'https://example.invalid/hook',
      ALERT_WEBHOOK_MIN_LEVEL: 'critical',
    });
    await svc.notify(payload({ level: 'warning' }));
    expect(global.fetch).not.toHaveBeenCalled();
    await svc.notify(payload({ level: 'emergency' }));
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('告警外发 · 节流 (同一故障不刷屏, 但恶化必报)', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
  });

  it('同一来源同一类型, 节流窗口内第二次不发', async () => {
    const svc = makeNotifier({
      ALERT_WEBHOOK_URL: 'https://example.invalid/hook',
      ALERT_WEBHOOK_THROTTLE_MS: '600000',
    });
    await svc.notify(payload());
    await svc.notify(payload());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('不同来源互不影响节流', async () => {
    const svc = makeNotifier({ ALERT_WEBHOOK_URL: 'https://example.invalid/hook' });
    await svc.notify(payload({ sourceId: 'GK9000' }));
    await svc.notify(payload({ sourceId: 'GK9001' }));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('级别恶化 (critical→emergency) 突破节流, 必须报出去', async () => {
    const svc = makeNotifier({
      ALERT_WEBHOOK_URL: 'https://example.invalid/hook',
      ALERT_WEBHOOK_THROTTLE_MS: '600000',
    });
    await svc.notify(payload({ level: 'critical' }));
    await svc.notify(payload({ level: 'emergency' }));
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('节流设 0 = 关闭节流, 每次都发', async () => {
    const svc = makeNotifier({
      ALERT_WEBHOOK_URL: 'https://example.invalid/hook',
      ALERT_WEBHOOK_THROTTLE_MS: '0',
    });
    await svc.notify(payload());
    await svc.notify(payload());
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });
});

describe('告警外发 · 失败绝不能影响主流程', () => {
  it('fetch 抛异常 → notify 不抛错 (告警已落库, 推送只是附加)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
    const svc = makeNotifier({ ALERT_WEBHOOK_URL: 'https://example.invalid/hook' });
    await expect(svc.notify(payload())).resolves.toBeUndefined();
  });

  it('webhook 返回 500 → 不抛错, 且不计入已发送 (下次仍会重试)', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 500 }) as unknown as typeof fetch;
    const svc = makeNotifier({ ALERT_WEBHOOK_URL: 'https://example.invalid/hook' });
    await expect(svc.notify(payload())).resolves.toBeUndefined();
    // 上一条没成功, 所以节流不应该生效
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
    await svc.notify(payload());
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('告警外发 · 报文格式', () => {
  const bodyOf = (): Record<string, unknown> =>
    JSON.parse(((global.fetch as jest.Mock).mock.calls[0][1] as { body: string }).body);

  beforeEach(() => {
    global.fetch = jest.fn().mockResolvedValue({ ok: true, status: 200 }) as unknown as typeof fetch;
  });

  it('默认企业微信 markdown, 含站点名/级别/来源/详情', async () => {
    const svc = makeNotifier({
      ALERT_WEBHOOK_URL: 'https://example.invalid/hook',
      ALERT_WEBHOOK_SITE: '金湖展贸中心',
    });
    await svc.notify(payload());
    const body = bodyOf() as { msgtype: string; markdown: { content: string } };
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown.content).toContain('金湖展贸中心');
    expect(body.markdown.content).toContain('现场主机失联: GK9000');
    expect(body.markdown.content).toContain('critical');
    expect(body.markdown.content).toContain('site/GK9000');
  });

  it('dingtalk 格式带 title + text', async () => {
    const svc = makeNotifier({
      ALERT_WEBHOOK_URL: 'https://example.invalid/hook',
      ALERT_WEBHOOK_FORMAT: 'dingtalk',
    });
    await svc.notify(payload());
    const body = bodyOf() as { msgtype: string; markdown: { title: string; text: string } };
    expect(body.msgtype).toBe('markdown');
    expect(body.markdown.title).toContain('告警');
    expect(body.markdown.text).toContain('GK9000');
  });

  it('raw 格式发结构化字段, 供自建接口消费', async () => {
    const svc = makeNotifier({
      ALERT_WEBHOOK_URL: 'https://example.invalid/hook',
      ALERT_WEBHOOK_FORMAT: 'raw',
    });
    await svc.notify(payload());
    const body = bodyOf() as Record<string, unknown>;
    expect(body.type).toBe('site_offline');
    expect(body.sourceId).toBe('GK9000');
    expect(body.level).toBe('critical');
    expect(body.site).toBeDefined();
  });
});
