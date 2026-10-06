import { BadRequestException, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { FusionPlayerAdapter } from '../../adapters/projector/fusion-player.adapter';
import type { FusionWindow } from '../../adapters/projector/fusion-player-protocol';

/** HDMI 输入源名 (实测融合器只认大写 HDMI) —— 显示 GK9000 HDMI2 推来的画面 */
const HDMI_SOURCE = 'HDMI';

export interface ProjectorStatus {
  /** 融合器是否在线 (后台采集可达) */
  online: boolean;
  version: string;
  kind: string;
  /** 预案是否在运行 (运行时窗口操作会失效) */
  planRunning: boolean;
  windows: FusionWindow[];
  /** 是否正在显示 GK9000 的 HDMI 输入 (模型A: 投影应始终显示这个) */
  showingHdmi: boolean;
}

const DEFAULT_STATUS: ProjectorStatus = {
  online: false, version: '', kind: '', planRunning: false, windows: [], showingHdmi: false,
};

/**
 * 投影视频融合器 (JBT-SK-HD02) 控制服务 —— 薄封装 FusionPlayerAdapter。
 *
 * 只暴露 2026-07-23 现场**实机验通**的核心命令: 状态读取 / 开窗切源 / 移动 / 缩放 / 音量。
 * run_mode(调预设)等未验命令暂不在此暴露, 待设备里配好模式 + 拿到厂家新版文档再补。
 *
 * 状态读取走**后台采集快照** (onModuleInit 每 10s 主动拉一次): 页面 status() 只读快照、
 * 不直接等融合器, 融合器掉线/休眠不卡投影仪页; 写操作后调度一次快刷新。
 * 坐标/大小归一化 0~1。窗口 ID 掉电会变。
 */
@Injectable()
export class ProjectorService implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly fusion: FusionPlayerAdapter) {}

  private snapshot: ProjectorStatus | null = null;
  private collecting = false;
  private timer?: NodeJS.Timeout;
  private readonly POLL_INTERVAL_MS = 10_000;

  onModuleInit(): void {
    const t = setInterval(() => { void this.collectStatus(); }, this.POLL_INTERVAL_MS);
    t.unref?.();
    this.timer = t;
    void this.collectStatus();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** 后台采集融合器完整状态: 版本 + 预案 + 窗口; 失败保留上次快照, 不抛错 */
  private async collectStatus(): Promise<void> {
    if (this.collecting) return;
    this.collecting = true;
    try {
      const [ver, plan, wins] = await Promise.all([
        this.fusion.version(),
        this.fusion.getRunningPlan(),
        this.fusion.enumWindows(),
      ]);
      const windows = wins.ok && wins.data ? wins.data : [];
      this.snapshot = {
        online: ver.ok || wins.ok,
        version: ver.ok && ver.data ? ver.data.version : '',
        kind: ver.ok && ver.data ? ver.data.kind : '',
        planRunning: plan.ok && plan.data ? plan.data.running : false,
        windows,
        showingHdmi: windows.some((w) => w.source === HDMI_SOURCE),
      };
    } catch {
      // 融合器超时/异常: 保留上次快照, 只把 online 标 false
      this.snapshot = { ...(this.snapshot ?? DEFAULT_STATUS), online: false };
    } finally {
      this.collecting = false;
    }
  }

  /** 写操作后让快照在设备动作完后刷新 (不阻塞当前请求) */
  private touch(delayMs = 1200): void {
    const t = setTimeout(() => { void this.collectStatus(); }, delayMs);
    t.unref?.();
  }

  /** 状态快照 (页面读取, 不开 HTTP 等设备) */
  status(): ProjectorStatus {
    return this.snapshot ?? DEFAULT_STATUS;
  }

  /**
   * 模型A 一键: 让投影显示 GK9000 的 HDMI 输入。
   * 关掉融合器所有内部媒体窗口, 开一个全屏 HDMI 窗口。之后投影 = GK9000 HDMI2 推来的画面
   * (边缘融合到两台投影)。内容切换走 GK9000 播控(slot2 播放列表), 融合器只管融合显示。
   */
  async showHdmiInput(): Promise<void> {
    const wins = this.unwrap(await this.fusion.enumWindows());
    for (const w of wins) {
      if (w.id >= 0) await this.fusion.closeWindow(w.id); // 只关 open 出来的数字 id 窗口
    }
    const r = this.unwrap(await this.fusion.openWindow(HDMI_SOURCE, 0, 0, 1, 1));
    if (!r.ok) throw new BadRequestException(`切到 HDMI 输入失败: ${r.error ?? '未知(源名要大写 HDMI)'}`);
    this.touch(1500);
  }

  async listWindows(): Promise<FusionWindow[]> {
    return this.unwrap(await this.fusion.enumWindows());
  }

  /** 开一个信号源窗口. 返回新窗口 id (0=失败). 坐标 0~1. */
  async openWindow(source: string, x: number, y: number, w: number, h: number): Promise<{ windowId: number }> {
    if (!source) throw new BadRequestException('source 必填');
    this.assertNorm({ x, y, w, h });
    const r = this.unwrap(await this.fusion.openWindow(source, x, y, w, h));
    if (!r.ok) throw new BadRequestException(`开窗失败: ${r.error ?? '未知'}`);
    this.touch();
    return { windowId: r.windowId };
  }

  async closeWindow(id: number): Promise<void> {
    this.expectOk(await this.fusion.closeWindow(id), '关窗');
    this.touch();
  }

  async cleanWindows(): Promise<void> {
    this.expectOk(await this.fusion.cleanWindows(), '清空窗口');
    this.touch();
  }

  async moveWindow(id: number, x: number, y: number): Promise<void> {
    this.assertNorm({ x, y });
    this.expectOk(await this.fusion.moveWindow(id, x, y), '移动窗口');
    this.touch();
  }

  async resizeWindow(id: number, w: number, h: number): Promise<void> {
    this.assertNorm({ w, h });
    this.expectOk(await this.fusion.resizeWindow(id, w, h), '缩放窗口');
    this.touch();
  }

  async setVolume(id: number, volume: number): Promise<{ volume: number; muted: boolean }> {
    if (volume < 0 || volume > 100) throw new BadRequestException('音量应在 0~100');
    const r = this.unwrap(await this.fusion.setWindowVolume(id, volume));
    if (!r.ok) throw new BadRequestException(`调音量失败: ${r.error ?? '未知'}`);
    this.touch();
    return { volume: r.volume ?? volume, muted: r.muted ?? false };
  }

  async getVolume(id: number): Promise<{ volume: number; muted: boolean }> {
    const r = this.unwrap(await this.fusion.getWindowVolume(id));
    if (!r.ok) throw new BadRequestException(`读音量失败: ${r.error ?? '未知'}`);
    return { volume: r.volume ?? 0, muted: r.muted ?? false };
  }

  // ============ 播放控制 (2026-07-23 实机验通, doc 格式) ============

  /** 让暂停的窗口继续播 */
  async play(id: number): Promise<void> {
    this.expectOk(await this.fusion.playWindow(id), '播放');
    this.touch();
  }

  /** 暂停窗口 */
  async pause(id: number): Promise<void> {
    this.expectOk(await this.fusion.pauseWindow(id), '暂停');
    this.touch();
  }

  /** 读窗口的播放列表: 当前文件 + 当前序号(从1) + 全部文件 */
  async getPlaylist(id: number): Promise<{ currentFile: string; currentIndex: number; files: string[] }> {
    const r = this.unwrap(await this.fusion.getPlaylist(id));
    if (!r.ok) throw new BadRequestException(`读播放列表失败: ${r.error ?? '未知'}`);
    return { currentFile: r.currentFile ?? '', currentIndex: r.currentIndex ?? 1, files: r.files ?? [] };
  }

  /** 切到播放列表里第 index 个(从1开始). 1成功/0失败(到头返回失败, 前端据此不越界)。 */
  async setPlaylistIndex(id: number, index: number): Promise<boolean> {
    if (index < 1) throw new BadRequestException('序号从 1 开始');
    const r = this.unwrap(await this.fusion.setPlaylistCurrent(id, index));
    this.touch();
    return r.ok;
  }

  // ============ 内部 ============

  private assertNorm(vals: Record<string, number>): void {
    for (const [k, v] of Object.entries(vals)) {
      if (typeof v !== 'number' || Number.isNaN(v) || v < 0 || v > 1) {
        throw new BadRequestException(`${k} 必须是归一化 0~1 的数, 得到 ${v}`);
      }
    }
  }

  private unwrap<T>(r: { ok: boolean; data?: T; error?: string }): T {
    if (!r.ok || r.data === undefined) {
      throw new BadRequestException(`融合器无响应或出错: ${r.error ?? '无数据'}`);
    }
    return r.data;
  }

  private expectOk(r: { ok: boolean; data?: { ok: boolean; error?: string }; error?: string }, what: string): void {
    const d = this.unwrap(r);
    if (!d.ok) throw new BadRequestException(`${what}失败: ${d.error ?? '未知(可能窗口不存在或预案运行中)'}`);
  }
}
