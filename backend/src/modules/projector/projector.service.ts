import { BadRequestException, Injectable } from '@nestjs/common';
import { FusionPlayerAdapter } from '../../adapters/projector/fusion-player.adapter';
import type { FusionWindow } from '../../adapters/projector/fusion-player-protocol';

export interface ProjectorStatus {
  version: string;
  kind: string;
  /** 预案是否在运行 (运行时窗口操作会失效) */
  planRunning: boolean;
  windows: FusionWindow[];
}

/**
 * 投影视频融合器 (JBT-SK-HD02) 控制服务 —— 薄封装 FusionPlayerAdapter。
 *
 * 只暴露 2026-07-23 现场**实机验通**的核心命令: 状态读取 / 开窗切源 / 移动 / 缩放 / 音量。
 * run_mode(调预设)等未验命令暂不在此暴露, 待设备里配好模式 + 拿到厂家新版文档再补。
 *
 * 坐标/大小归一化 0~1。窗口 ID 掉电会变, 前端每次操作前应先 status 拉最新窗口列表。
 */
@Injectable()
export class ProjectorService {
  constructor(private readonly fusion: FusionPlayerAdapter) {}

  /** 拉一份完整状态: 版本 + 预案状态 + 当前所有窗口 */
  async status(): Promise<ProjectorStatus> {
    const [ver, plan, wins] = await Promise.all([
      this.fusion.version(),
      this.fusion.getRunningPlan(),
      this.fusion.enumWindows(),
    ]);
    return {
      version: ver.ok && ver.data ? ver.data.version : '',
      kind: ver.ok && ver.data ? ver.data.kind : '',
      planRunning: plan.ok && plan.data ? plan.data.running : false,
      windows: wins.ok && wins.data ? wins.data : [],
    };
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
    return { windowId: r.windowId };
  }

  async closeWindow(id: number): Promise<void> {
    this.expectOk(await this.fusion.closeWindow(id), '关窗');
  }

  async cleanWindows(): Promise<void> {
    this.expectOk(await this.fusion.cleanWindows(), '清空窗口');
  }

  async moveWindow(id: number, x: number, y: number): Promise<void> {
    this.assertNorm({ x, y });
    this.expectOk(await this.fusion.moveWindow(id, x, y), '移动窗口');
  }

  async resizeWindow(id: number, w: number, h: number): Promise<void> {
    this.assertNorm({ w, h });
    this.expectOk(await this.fusion.resizeWindow(id, w, h), '缩放窗口');
  }

  async setVolume(id: number, volume: number): Promise<{ volume: number; muted: boolean }> {
    if (volume < 0 || volume > 100) throw new BadRequestException('音量应在 0~100');
    const r = this.unwrap(await this.fusion.setWindowVolume(id, volume));
    if (!r.ok) throw new BadRequestException(`调音量失败: ${r.error ?? '未知'}`);
    return { volume: r.volume ?? volume, muted: r.muted ?? false };
  }

  async getVolume(id: number): Promise<{ volume: number; muted: boolean }> {
    const r = this.unwrap(await this.fusion.getWindowVolume(id));
    if (!r.ok) throw new BadRequestException(`读音量失败: ${r.error ?? '未知'}`);
    return { volume: r.volume ?? 0, muted: r.muted ?? false };
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
