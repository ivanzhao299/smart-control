import { Controller, Get, Post, Body } from '@nestjs/common';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { Public } from '../../common/decorators/public.decorator';

/**
 * 运营大屏翻页控制 — 供PWA播放控制卡片远程控制LED大屏端运营大屏翻页
 *
 * 通信方式: HTTP API + 运营大屏端短轮询 (500ms)
 * 后续可优化为 WebSocket 推送, 降低延迟
 */
@Public()
@Controller('park-ops-control')
export class ParkOpsControlController {
  private statePath: string;
  private state: { page: number; autoPlay: boolean; timestamp: number; totalPages: number; refreshRequested: boolean; refreshTimestamp: number };

  constructor() {
    const dataDir = process.env.DATA_DIR || join(process.cwd(), 'data');
    if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
    this.statePath = join(dataDir, 'park-ops-control.json');
    this.state = this.loadState();
  }

  private loadState() {
    if (existsSync(this.statePath)) {
      try {
        const s = JSON.parse(readFileSync(this.statePath, 'utf-8'));
        return { ...s, totalPages: 6, refreshRequested: s.refreshRequested || false, refreshTimestamp: s.refreshTimestamp || 0 }; // 运营大屏共6页
      } catch {
        // ignore
      }
    }
    return { page: 0, autoPlay: false, timestamp: Date.now(), totalPages: 6, refreshRequested: false, refreshTimestamp: 0 };
  }

  private saveState() {
    this.state.timestamp = Date.now();
    writeFileSync(this.statePath, JSON.stringify(this.state), 'utf-8');
  }

  @Get('state')
  getState() {
    // 自动清除过期的refresh请求（超过10秒），防止无限刷新循环
    if (this.state.refreshRequested && this.state.refreshTimestamp && Date.now() - this.state.refreshTimestamp > 10000) {
      this.state.refreshRequested = false;
      this.saveState();
    }
    return {
      success: true,
      data: this.state,
    };
  }

  @Post('next')
  nextPage() {
    this.state.page = (this.state.page + 1) % this.state.totalPages; // 运营大屏共6页
    this.saveState();
    return { success: true, message: '下一页', data: this.state };
  }

  @Post('prev')
  prevPage() {
    this.state.page = (this.state.page + this.state.totalPages - 1) % this.state.totalPages;
    this.saveState();
    return { success: true, message: '上一页', data: this.state };
  }

  @Post('goto')
  gotoPage(@Body() body: { page: number }) {
    const page = Math.max(0, Math.min(this.state.totalPages - 1, Number(body.page) || 0));
    this.state.page = page;
    this.saveState();
    return { success: true, message: `跳转到第${page + 1}页`, data: this.state };
  }

  @Post('auto')
  toggleAuto(@Body() body: { enabled?: boolean }) {
    this.state.autoPlay = body.enabled !== undefined ? !!body.enabled : !this.state.autoPlay;
    this.saveState();
    return { success: true, message: this.state.autoPlay ? '自动轮播已开启' : '自动轮播已关闭', data: this.state };
  }

  @Post('refresh')
  requestRefresh() {
    this.state.refreshRequested = true;
    this.state.refreshTimestamp = Date.now();
    this.saveState();
    return { success: true, message: '已发送强制刷新指令，运营大屏将在1秒内刷新', data: this.state };
  }
}
