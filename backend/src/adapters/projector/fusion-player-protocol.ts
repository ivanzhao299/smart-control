/**
 * 投影仪视频融合器 (JBT-SK-HD02) —— 《播控中控控制协议 V1.1》文本命令编解码 (纯函数)。
 *
 * 数据源: 厂家《播控被控中控协议.pdf》(2023-07-13, 最低兼容播控 V2.4.25.60)。
 * 用途: 给投影融合器做远程控制 —— 开/关/移动/缩放窗口、切信号源、调音量、调用模式、控播放列表。
 *
 * 传输: TCP 63426 / UDP 63427, UTF-8。一发一收。本文件只做"命令 <-> 帧字符串"的纯换算,
 *       不碰 socket (那是 transports/TcpClient 的事; adapter 里用 sendAndReadUntil('>') 收响应)。
 *
 * 帧格式: `<命令,参数1,参数2,…>` —— 起始 '<'、结束 '>'、逗号分隔, 第一段是命令。
 *
 * ⚠️ 两条铁律 (踩过就找不到信号源):
 *   1. **请求里逗号后不能加空格** —— 尤其信号源名/文件名前。encodeCommand 保证不加。
 *   2. **响应里逗号后可能带空格** (如 `<set_window_volume,1, 90, 0>`) —— parseResponse 每段 trim。
 *
 * 坐标/大小统一归一化 0~1。窗口 ID 掉电重启会变, 不可持久化。
 *
 * 🔧 2026-07-23 现场实机(固件 2.4.25.268, 比文档 V1.1 的 2.4.25.60 新)逐条 read-back 验证,
 *    发现**命令格式 per-command 跟文档不一致**, 已按真机改:
 *      - open_window / close_window 多一个**前置"画布"字段**(填 0): `open_window,<画布>,源,x,y,w,h`
 *        / `close_window,<画布>,窗口id`。不加前置它会把 x 当源名。
 *      - move / resize / set_window_volume / get_window_volume 是**裸文档格式**(无前置)。
 *      - open_window 响应是 `<open_window,<成功1>,<窗口id>>`(两段: 成功位 + id), 不是文档的单段 id。
 *      - enum_modes 疑似 `<enum_modes,<count>,<名…>>`(0 模式时 `<enum_modes,0,>`) —— **未验(没配模式)**。
 *    详见 [[fusion-player-protocol]] 记忆的"固件实测命令格式"一节。
 */

export const FUSION_TCP_PORT = 63426;
export const FUSION_UDP_PORT = 63427;

/**
 * open_window / close_window 的前置"画布/屏"字段。二通道融合可能有多块画布,
 * 单屏场景固定 0(实机验证 0 可用)。真机没这个字段会把坐标当源名 → 开窗失败。
 */
export const DEFAULT_CANVAS = 0;

/** version 命令返回的播控类型 */
export type PlaybackKind = 'SPECIAL_VIDEO' | 'LED_PLAYER' | 'MAGIC_WALL' | 'FUSION';

// ============ 帧编解码 ============

export class FusionFrameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FusionFrameError';
  }
}

/** 播控回了 <command_error, …> */
export class FusionCommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FusionCommandError';
  }
}

/**
 * 组一条请求帧: `<cmd,arg1,arg2>`。参数一律 String() 后用逗号拼, **不加空格**。
 * 数字参数(坐标/音量)直接传 number; 信号源名/文件名传 string。
 */
export function encodeCommand(cmd: string, args: Array<string | number> = []): string {
  const parts = [cmd, ...args.map((a) => String(a))];
  return `<${parts.join(',')}>`;
}

export interface ParsedResponse {
  /** 第一段 = 命令回显 (或 'command_error') */
  cmd: string;
  /** 其余段, 已逐段 trim */
  params: string[];
  raw: string;
}

/**
 * 拆一条响应帧: 去掉外层 <>, 按逗号切, 每段 trim (响应逗号后可能带空格)。
 * 不是 <...> 包裹的抛 FusionFrameError。
 */
export function parseResponse(raw: string): ParsedResponse {
  const s = raw.trim();
  if (!s.startsWith('<') || !s.endsWith('>')) {
    throw new FusionFrameError(`帧格式错误, 缺 <> 包裹: ${JSON.stringify(raw)}`);
  }
  const inner = s.slice(1, -1);
  // 空 body (如 `<enum_windows,>` 末尾会切出一个 '') —— 保留, 由各 decoder 处理
  const segs = inner.split(',').map((x) => x.trim());
  const cmd = segs[0] ?? '';
  return { cmd, params: segs.slice(1), raw };
}

/** 若响应是 command_error 就抛 FusionCommandError */
export function assertOk(r: ParsedResponse, expectCmd?: string): ParsedResponse {
  if (r.cmd === 'command_error') {
    throw new FusionCommandError(r.params.join(', ') || 'command_error');
  }
  if (expectCmd && r.cmd !== expectCmd) {
    throw new FusionFrameError(`命令回显不符: 期望 ${expectCmd}, 得到 ${r.cmd}`);
  }
  return r;
}

// ============ 各命令的响应解码 ============

export interface FusionVersion {
  version: string;
  kind: PlaybackKind | string;
}

/** `<version, 2.4.25.255, LED_PLAYER>` → { version, kind } */
export function decodeVersion(r: ParsedResponse): FusionVersion {
  assertOk(r, 'version');
  return { version: r.params[0] ?? '', kind: (r.params[1] ?? '') as PlaybackKind };
}

export interface FusionWindow {
  /** 窗口 ID。**-1 = 融合器默认播放窗口**(enum 里 id 字段是空的, 无法用数字 id 控制)。 */
  id: number;
  /** 信号源名称 (播放的文件/输入源) */
  source: string;
  /** 归一化 0~1 */
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 默认播放窗口(enum 里 id 空)的哨兵 id —— 不可用数字 id 做 move/close/音量 */
export const DEFAULT_WINDOW_ID = -1;

/**
 * `<enum_windows,id,源,x,y,w,h,id,源,x,y,w,h,…>` → 窗口数组 (每 6 个一组)。
 * 空窗口时播控回 `<enum_windows,>` (parseResponse 后 params=['']), 返回空数组。
 * 🔧 真机: 默认播放窗口的 id 字段是**空的** → 记为 DEFAULT_WINDOW_ID(-1); open 出来的窗口是数字 id。
 */
export function decodeWindows(r: ParsedResponse): FusionWindow[] {
  assertOk(r, 'enum_windows');
  const p = r.params;
  // 空: [''] 或 []
  if (p.length === 0 || (p.length === 1 && p[0] === '')) return [];
  if (p.length % 6 !== 0) {
    throw new FusionFrameError(`enum_windows 参数数量非 6 的倍数: ${p.length} (${r.raw})`);
  }
  const out: FusionWindow[] = [];
  for (let i = 0; i < p.length; i += 6) {
    const rawId = p[i];
    const id = rawId === '' ? DEFAULT_WINDOW_ID : Number.parseInt(rawId, 10);
    out.push({
      id: Number.isNaN(id) ? DEFAULT_WINDOW_ID : id,
      source: p[i + 1],
      x: Number.parseFloat(p[i + 2]),
      y: Number.parseFloat(p[i + 3]),
      width: Number.parseFloat(p[i + 4]),
      height: Number.parseFloat(p[i + 5]),
    });
  }
  return out;
}

export interface OpenResult {
  /** 新窗口 ID; 0 = 失败 */
  windowId: number;
  ok: boolean;
  error?: string;
}

/**
 * open_window 响应。
 * 🔧 真机(2.4.25.268): `<open_window,<成功1/0>,<窗口id>>` 成功 / `<open_window,0,原因>` 失败。
 *   —— 第一段是成功位(不是 id!), 成功时第二段才是新窗口 id。
 * (文档 V1.1 是单段 `<open_window,id>`, 已被真机推翻。)
 */
export function decodeOpenResult(r: ParsedResponse): OpenResult {
  assertOk(r);
  const ok = (r.params[0] ?? '0') === '1';
  if (!ok) return { windowId: 0, ok: false, error: r.params.slice(1).join(', ') || undefined };
  const id = Number.parseInt(r.params[1] ?? '0', 10);
  return { windowId: Number.isNaN(id) ? 0 : id, ok: true };
}

export interface BoolResult {
  ok: boolean;
  error?: string;
}

/**
 * 通用 1成功/0失败 响应 (close/clean/resize/move/play/pause/mute/unmute/run_mode/stop_plan/
 * set_playlist_current)。`<close_window,1>` / `<move_window,0,原因>`。
 */
export function decodeBoolResult(r: ParsedResponse): BoolResult {
  assertOk(r);
  const ok = (r.params[0] ?? '0') === '1';
  return ok ? { ok: true } : { ok: false, error: r.params[1] };
}

export interface VolumeResult {
  ok: boolean;
  /** 0~100 */
  volume?: number;
  muted?: boolean;
  error?: string;
}

/**
 * 音量类响应:
 *   add/sub_window_volume: `<add_window_volume,1,100>` → ok + 改后音量
 *   set_window_volume:     `<set_window_volume,1,60,0>` → ok + 音量 + 是否静音
 *   get_window_volume:     `<get_window_volume,1,100,0>` → ok + 音量 + 是否静音
 * 失败: `<…,0,原因>`。
 */
export function decodeVolumeResult(r: ParsedResponse): VolumeResult {
  assertOk(r);
  const ok = (r.params[0] ?? '0') === '1';
  if (!ok) return { ok: false, error: r.params[1] };
  const out: VolumeResult = { ok: true, volume: Number.parseInt(r.params[1] ?? '0', 10) };
  if (r.params[2] !== undefined) out.muted = r.params[2] === '1';
  return out;
}

/**
 * enum_modes → 模式名数组。
 * 🔧 真机(2.4.25.268)回 `<enum_modes,<count>,<名1>,<名2>…>` —— **前面多一个 count 字段**
 *   (0 模式时 `<enum_modes,0,>`)。⚠️ **未验**: 现场 0 模式, 没法看有模式时的真实排布,
 *   配了模式 + 拿到厂家新版文档后要复核。这里按"首段是 count 就丢掉"处理, 再滤掉空串。
 */
export function decodeModes(r: ParsedResponse): string[] {
  assertOk(r, 'enum_modes');
  let p = r.params;
  // 首段是纯数字且 == 后面非空名字的个数 → 当 count 丢掉
  if (p.length >= 1 && /^\d+$/.test(p[0])) {
    const rest = p.slice(1).filter((x) => x !== '');
    if (Number.parseInt(p[0], 10) === rest.length) return rest;
    // count 对不上也把它当 count 丢(保守), 剩下滤空
    p = p.slice(1);
  }
  return p.filter((x) => x !== '');
}

/** `<get_running_plan,1>` → true(预案运行中) */
export function decodeRunningPlan(r: ParsedResponse): boolean {
  assertOk(r, 'get_running_plan');
  return (r.params[0] ?? '0') === '1';
}

export interface PlaylistResult {
  ok: boolean;
  /** 当前正在播放的文件 */
  currentFile?: string;
  /** 当前文件在列表中的索引 —— **从 1 开始** */
  currentIndex?: number;
  /** 列表文件总数 */
  count?: number;
  /** 完整播放列表 */
  files?: string[];
  error?: string;
}

/**
 * `<get_playlist,1,cur.mp4,1,4,a.mp4,b.mp4,c.mp4,d.mp4>`
 *   ok · 当前文件 · 当前索引(从1) · 文件数 · 列表(N)
 * 失败: `<get_playlist,0,原因>`。
 */
export function decodePlaylist(r: ParsedResponse): PlaylistResult {
  assertOk(r, 'get_playlist');
  const ok = (r.params[0] ?? '0') === '1';
  if (!ok) return { ok: false, error: r.params[1] };
  return {
    ok: true,
    currentFile: r.params[1],
    currentIndex: Number.parseInt(r.params[2] ?? '0', 10),
    count: Number.parseInt(r.params[3] ?? '0', 10),
    files: r.params.slice(4),
  };
}
