/**
 * FusionPlayerAdapter —— describe() 契约 + mock 路径行为。
 * 真机路径(真实 TCP 收发)靠 fusion-player-protocol.spec.ts 的 31 个金标准测试保证编解码;
 * 这里只测 adapter 层能装配、describe() 契约稳定、mock 态自洽。
 */
import type { Logger } from 'winston';
import type { ConfigService } from '@nestjs/config';
import { FusionPlayerAdapter } from './fusion-player.adapter';

const fakeLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

function mockConfig(): ConfigService {
  return { getOrThrow: () => ({ mock: true, mockLatencyMs: 0 }) } as unknown as ConfigService;
}

const makeAdapter = (): FusionPlayerAdapter => new FusionPlayerAdapter(mockConfig(), fakeLogger());

describe('FusionPlayerAdapter · describe() 驱动目录契约', () => {
  const d = FusionPlayerAdapter.describe();

  it('kind 稳定为 fusion-player', () => {
    expect(d.kind).toBe('fusion-player');
  });
  it('category=projector-fusion, protocol=tcp-text', () => {
    expect(d.category).toBe('projector-fusion');
    expect(d.protocol).toBe('tcp-text');
  });
  it('默认端口 63426, 必填 IP', () => {
    expect(d.defaultAddressing).toMatchObject({ port: 63426 });
    expect(d.paramSchema?.ip?.required).toBe(true);
    expect(d.paramSchema?.port?.default).toBe(63426);
  });
  it('能力含开窗/切源/模式/播放列表', () => {
    expect(d.capabilities).toEqual(
      expect.arrayContaining(['open_window', 'replace_window', 'run_mode', 'set_playlist_current']),
    );
  });
});

describe('FusionPlayerAdapter · mock 路径自洽', () => {
  it('开窗 → enumWindows 能看到, 关窗后消失', async () => {
    const a = makeAdapter();
    const o = await a.openWindow('测试.mp4', 0, 0, 0.5, 0.5);
    expect(o.ok).toBe(true);
    const id = o.data!.windowId;
    expect(id).toBeGreaterThan(0);

    const list1 = await a.enumWindows();
    expect(list1.data).toHaveLength(1);
    expect(list1.data![0]).toMatchObject({ id, source: '测试.mp4', width: 0.5 });

    const c = await a.closeWindow(id);
    expect(c.data!.ok).toBe(true);
    expect((await a.enumWindows()).data).toHaveLength(0);
  });

  it('两个窗口 id 递增且互不干扰; clean_windows 全清', async () => {
    const a = makeAdapter();
    const w1 = (await a.openWindow('a.mp4', 0, 0, 0.5, 1)).data!.windowId;
    const w2 = (await a.openWindow('b.mp4', 0.5, 0, 0.5, 1)).data!.windowId;
    expect(w2).toBeGreaterThan(w1);
    expect((await a.enumWindows()).data).toHaveLength(2);
    await a.cleanWindows();
    expect((await a.enumWindows()).data).toHaveLength(0);
  });

  it('replace 换源; move/resize 改坐标', async () => {
    const a = makeAdapter();
    const id = (await a.openWindow('a.mp4', 0, 0, 1, 1)).data!.windowId;
    await a.replaceWindow(id, 'b.mp4');
    await a.moveWindow(id, 0.25, 0.25);
    await a.resizeWindow(id, 0.75, 0.75);
    const w = (await a.enumWindows()).data![0];
    expect(w).toMatchObject({ source: 'b.mp4', x: 0.25, y: 0.25, width: 0.75, height: 0.75 });
  });

  it('对不存在的窗口操作返回 ok=false', async () => {
    const a = makeAdapter();
    expect((await a.moveWindow(999, 0, 0)).data!.ok).toBe(false);
    expect((await a.replaceWindow(999, 'x.mp4')).data!.ok).toBe(false);
  });

  it('音量: set/add/sub clamp 0~100, 静音开关', async () => {
    const a = makeAdapter();
    const id = (await a.openWindow('a.mp4', 0, 0, 1, 1)).data!.windowId;
    expect((await a.setWindowVolume(id, 80)).data).toMatchObject({ ok: true, volume: 80 });
    expect((await a.addWindowVolume(id, 50)).data!.volume).toBe(100); // clamp 上界
    expect((await a.subWindowVolume(id, 130)).data!.volume).toBe(0);  // clamp 下界
    await a.muteWindow(id);
    expect((await a.getWindowVolume(id)).data!.muted).toBe(true);
    await a.unmuteWindow(id);
    expect((await a.getWindowVolume(id)).data!.muted).toBe(false);
  });

  it('mock 版本是 FUSION, healthCheck 通过', async () => {
    const a = makeAdapter();
    expect((await a.version()).data).toEqual({ version: '2.4.25.60', kind: 'FUSION' });
    expect((await a.healthCheck()).data).toEqual({ ok: true });
  });

  it('mock 预案未运行, runMode / stopPlan 成功', async () => {
    const a = makeAdapter();
    expect((await a.getRunningPlan()).data!.running).toBe(false);
    expect((await a.runMode('开馆')).data!.ok).toBe(true);
    expect((await a.stopPlan()).data!.ok).toBe(true);
    expect((await a.enumModes()).data).toEqual(expect.arrayContaining(['开馆']));
  });
});
