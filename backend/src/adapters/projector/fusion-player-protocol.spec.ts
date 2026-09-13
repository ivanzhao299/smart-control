/**
 * 融合器播控协议金标准测试 —— 全部用《播控中控控制协议 V1.1》文档里的**原文示例**,
 * 一次锁死: 请求编码不加空格 + 响应解析 trim + 各命令字段映射。
 * 真机到货前, 这些示例就是唯一的"厂家实测帧"依据。
 */
import {
  encodeCommand,
  parseResponse,
  assertOk,
  decodeVersion,
  decodeWindows,
  decodeOpenResult,
  decodeBoolResult,
  decodeVolumeResult,
  decodeModes,
  decodeRunningPlan,
  decodePlaylist,
  FusionCommandError,
  FusionFrameError,
} from './fusion-player-protocol';

describe('融合器协议 · 请求编码 (逗号后绝不加空格)', () => {
  it('无参命令', () => {
    expect(encodeCommand('version')).toBe('<version>');
    expect(encodeCommand('enum_windows')).toBe('<enum_windows>');
    expect(encodeCommand('clean_windows')).toBe('<clean_windows>');
  });

  it('encodeCommand 不加空格 (逗号紧贴源名)', () => {
    // 文档反复强调: 逗号和信号源名之间多一个空格就找不到信号源
    expect(encodeCommand('open_window', ['测试1.mp4', 0, 0, 0.5, 0.5])).toBe(
      '<open_window,测试1.mp4,0,0,0.5,0.5>',
    );
  });

  it('真机 open_window 帧: 前置画布字段 0 + 源 + 坐标', () => {
    // adapter 实际发的: <open_window,<画布=0>,源,x,y,w,h>
    expect(encodeCommand('open_window', [0, '测试1.mp4', 0, 0, 0.5, 0.5])).toBe(
      '<open_window,0,测试1.mp4,0,0,0.5,0.5>',
    );
    // close 也带画布: <close_window,<画布>,<窗口id>>
    expect(encodeCommand('close_window', [0, 3])).toBe('<close_window,0,3>');
  });

  it('close_window / resize / move', () => {
    expect(encodeCommand('close_window', [1])).toBe('<close_window,1>');
    expect(encodeCommand('resize_window', [1, 0.75, 0.75])).toBe('<resize_window,1,0.75,0.75>');
    expect(encodeCommand('move_window', [1, 0.25, 0.25])).toBe('<move_window,1,0.25,0.25>');
  });

  it('run_mode / set_playlist_current 中文与文件名不夹空格', () => {
    expect(encodeCommand('run_mode', ['测试1'])).toBe('<run_mode,测试1>');
    expect(encodeCommand('set_playlist_current', [1, 'media/SampleVideo1.mp4'])).toBe(
      '<set_playlist_current,1,media/SampleVideo1.mp4>',
    );
    expect(encodeCommand('set_playlist_current', [1, 1])).toBe('<set_playlist_current,1,1>');
  });
});

describe('融合器协议 · 帧解析 (响应逗号后可能带空格 → 每段 trim)', () => {
  it('普通帧', () => {
    expect(parseResponse('<close_window,1>')).toMatchObject({ cmd: 'close_window', params: ['1'] });
  });

  it('响应带空格照样 trim: <set_window_volume,1, 90, 0>', () => {
    const r = parseResponse('<set_window_volume,1, 90, 0>');
    expect(r.cmd).toBe('set_window_volume');
    expect(r.params).toEqual(['1', '90', '0']);
  });

  it('不是 <> 包裹 → FusionFrameError', () => {
    expect(() => parseResponse('close_window,1')).toThrow(FusionFrameError);
    expect(() => parseResponse('')).toThrow(FusionFrameError);
  });

  it('command_error 响应 → assertOk 抛 FusionCommandError', () => {
    // 文档原文两种错误
    const e1 = parseResponse("<command_error, can't find command ! command: enum_window>");
    expect(() => assertOk(e1)).toThrow(FusionCommandError);
    const e2 = parseResponse('<command_error, format_error>');
    expect(() => assertOk(e2)).toThrow(FusionCommandError);
    expect(() => assertOk(e2)).toThrow(/format_error/);
  });
});

describe('融合器协议 · version', () => {
  it('文档原文 <version, 2.4.25.255, LED_PLAYER>', () => {
    const v = decodeVersion(parseResponse('<version, 2.4.25.255, LED_PLAYER>'));
    expect(v).toEqual({ version: '2.4.25.255', kind: 'LED_PLAYER' });
  });
  it('本机是 FUSION 投影融合', () => {
    const v = decodeVersion(parseResponse('<version, 2.4.25.60, FUSION>'));
    expect(v.kind).toBe('FUSION');
  });
});

describe('融合器协议 · enum_windows', () => {
  it('空窗口: <enum_windows,> → []', () => {
    expect(decodeWindows(parseResponse('<enum_windows,>'))).toEqual([]);
  });

  it('文档原文两个窗口', () => {
    // <enum_windows,1,测试.mp4,0,0,0.5,0.5,2,测试2.mp4,0.5,0.5,0.5,0.5>
    const ws = decodeWindows(
      parseResponse('<enum_windows,1,测试.mp4,0,0,0.5,0.5,2,测试2.mp4,0.5,0.5,0.5,0.5>'),
    );
    expect(ws).toHaveLength(2);
    expect(ws[0]).toEqual({ id: 1, source: '测试.mp4', x: 0, y: 0, width: 0.5, height: 0.5 });
    expect(ws[1]).toEqual({ id: 2, source: '测试2.mp4', x: 0.5, y: 0.5, width: 0.5, height: 0.5 });
  });

  it('真机: 默认播放窗口 id 空 → DEFAULT_WINDOW_ID(-1)', () => {
    // 现场原样: <enum_windows, ,FRANCE...595s.mp4,0,0,1,0.998779>
    const ws = decodeWindows(
      parseResponse('<enum_windows, ,FRANCE 1周同尧《天体》-595s.mp4,0.000000,0.000000,1.000000,0.998779>'),
    );
    expect(ws).toHaveLength(1);
    expect(ws[0].id).toBe(-1); // DEFAULT_WINDOW_ID
    expect(ws[0].source).toBe('FRANCE 1周同尧《天体》-595s.mp4');
    expect(ws[0].width).toBe(1);
  });

  it('真机: 默认窗口 + open 出来的 id=0 窗口混排', () => {
    // <enum_windows, ,主源,0,0,1,0.998, 0,PIP源,0.72,0.02,0.25,0.25>
    const ws = decodeWindows(
      parseResponse('<enum_windows, ,主源.mp4,0,0,1,0.998779,0,PIP.mp4,0.72,0.02,0.25,0.25>'),
    );
    expect(ws.map((w) => w.id)).toEqual([-1, 0]);
    expect(ws[1]).toMatchObject({ id: 0, source: 'PIP.mp4', x: 0.72, width: 0.25 });
  });

  it('参数非 6 的倍数 → FusionFrameError', () => {
    expect(() => decodeWindows(parseResponse('<enum_windows,1,x.mp4,0,0,0.5>'))).toThrow(
      FusionFrameError,
    );
  });
});

describe('融合器协议 · open 窗口 (真机 2.4.25.268: 成功位 + id 两段)', () => {
  it('开窗成功: 真机回 <open_window, 1, 0> → 成功位1, 新窗口 id=0', () => {
    expect(decodeOpenResult(parseResponse('<open_window, 1, 0>'))).toEqual({ windowId: 0, ok: true });
  });
  it('开窗成功 id=5: <open_window,1,5>', () => {
    expect(decodeOpenResult(parseResponse('<open_window,1,5>'))).toEqual({ windowId: 5, ok: true });
  });
  it('开窗失败: <open_window, 0, can\'t find signal source…> → 成功位0 + 原因', () => {
    const r = decodeOpenResult(
      parseResponse("<open_window, 0, can't find signal source! signal source name: 测试1.mp4>"),
    );
    expect(r.ok).toBe(false);
    expect(r.windowId).toBe(0);
    expect(r.error).toMatch(/can't find signal source/);
  });
});

describe('融合器协议 · 通用 1/0 结果', () => {
  it('close 成功', () => {
    expect(decodeBoolResult(parseResponse('<close_window,1>'))).toEqual({ ok: true });
  });
  it('clean_windows 成功', () => {
    expect(decodeBoolResult(parseResponse('<clean_windows,1>')).ok).toBe(true);
  });
  it('move 失败 (窗口不存在/预案运行): <move_window,0>', () => {
    expect(decodeBoolResult(parseResponse('<move_window,0>')).ok).toBe(false);
  });
  it('run_mode 成功: <run_mode,1>', () => {
    expect(decodeBoolResult(parseResponse('<run_mode,1>')).ok).toBe(true);
  });
  it('stop_plan 成功: <stop_plan,1>', () => {
    expect(decodeBoolResult(parseResponse('<stop_plan,1>')).ok).toBe(true);
  });
});

describe('融合器协议 · 音量', () => {
  it('add 成功回改后音量: <add_window_volume,1,100>', () => {
    expect(decodeVolumeResult(parseResponse('<add_window_volume,1,100>'))).toMatchObject({
      ok: true,
      volume: 100,
    });
  });
  it('sub: <sub_window_volume,1,40>', () => {
    expect(decodeVolumeResult(parseResponse('<sub_window_volume,1,40>')).volume).toBe(40);
  });
  it('set 回音量+静音: <set_window_volume,1,60,0> → 60, 未静音', () => {
    const v = decodeVolumeResult(parseResponse('<set_window_volume,1,60,0>'));
    expect(v).toEqual({ ok: true, volume: 60, muted: false });
  });
  it('get 回音量+静音: <get_window_volume,1,100,0>', () => {
    const v = decodeVolumeResult(parseResponse('<get_window_volume,1,100,0>'));
    expect(v).toEqual({ ok: true, volume: 100, muted: false });
  });
  it('真机原样带空格+静音: <get_window_volume, 1,80,1> → 80, 静音', () => {
    const v = decodeVolumeResult(parseResponse('<get_window_volume, 1,80,1>'));
    expect(v).toEqual({ ok: true, volume: 80, muted: true });
  });
  it('真机 set 回读: <get_window_volume, 1,25,0> → 25, 未静音', () => {
    expect(decodeVolumeResult(parseResponse('<get_window_volume, 1,25,0>'))).toEqual({
      ok: true, volume: 25, muted: false,
    });
  });
});

describe('融合器协议 · 模式 / 预案', () => {
  it('真机 0 模式: <enum_modes, 0,> → [] (丢掉前置 count)', () => {
    expect(decodeModes(parseResponse('<enum_modes, 0,>'))).toEqual([]);
  });
  it('真机 count 前置格式: <enum_modes,4,测试1,测试2,测试3,测试4> → 4 个名 (未真机验但按此假设)', () => {
    expect(decodeModes(parseResponse('<enum_modes,4,测试1,测试2,测试3,测试4>'))).toEqual([
      '测试1', '测试2', '测试3', '测试4',
    ]);
  });
  it('文档裸格式(无 count)也兜住: <enum_modes,测试1,测试2>', () => {
    // 首段"测试1"非纯数字 → 不当 count, 全返回
    expect(decodeModes(parseResponse('<enum_modes,测试1,测试2>'))).toEqual(['测试1', '测试2']);
  });
  it('get_running_plan 运行中: <get_running_plan,1> → true', () => {
    expect(decodeRunningPlan(parseResponse('<get_running_plan,1>'))).toBe(true);
    expect(decodeRunningPlan(parseResponse('<get_running_plan,0>'))).toBe(false);
  });
});

describe('融合器协议 · 播放列表', () => {
  it('文档原文: 当前 SampleVideo1.mp4, 索引1(从1开始), 共4个', () => {
    const raw =
      '<get_playlist,1,media/SampleVideo1.mp4,1,4,media/SampleVideo1.mp4,media/SampleVideo2.mp4,media/SampleVideo3.mp4,media/SampleVideo4.mp4>';
    const pl = decodePlaylist(parseResponse(raw));
    expect(pl.ok).toBe(true);
    expect(pl.currentFile).toBe('media/SampleVideo1.mp4');
    expect(pl.currentIndex).toBe(1); // 从 1 开始, 不是 0
    expect(pl.count).toBe(4);
    expect(pl.files).toHaveLength(4);
    expect(pl.files?.[3]).toBe('media/SampleVideo4.mp4');
  });
  it('失败: <get_playlist,0,can\'t find window !>', () => {
    const pl = decodePlaylist(parseResponse("<get_playlist,0,can't find window !>"));
    expect(pl.ok).toBe(false);
    expect(pl.error).toMatch(/can't find window/);
  });
  it('set_playlist_current 成功/失败 走 bool', () => {
    expect(decodeBoolResult(parseResponse('<set_playlist_current,1>')).ok).toBe(true);
    expect(decodeBoolResult(parseResponse('<set_playlist_current,0>')).ok).toBe(false);
  });
});
