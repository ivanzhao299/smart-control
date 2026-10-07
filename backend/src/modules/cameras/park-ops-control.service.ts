import { Injectable } from '@nestjs/common';

export interface ParkOpsControlState {
  page: number;
  autoPlay: boolean;
  timestamp: number;
  totalPages: number;
  refreshRequested: boolean;
  refreshTimestamp: number;
}

/**
 * 大屏总页数。必须与 frontend/public/park-ops/index.html 中 `<section class="page">`
 * 的实际数量保持一致（当前 7 页：欢迎/综合态势/企业经营/安全消防/人车管理/视频监控/能源管理）；
 * 以后增删大屏页面时务必同步修改此常量，否则远程翻页与自动轮播无法到达新增页。
 */
const TOTAL_PAGES = 7;
const REFRESH_TTL_MS = 10_000;

/**
 * 园区大屏的实时控制信号。
 *
 * 这些值只描述当前翻页、自动播放和一次性刷新指令，不是业务记录。进程重启后恢复
 * 安全默认值比把瞬时指令写进运行目录更可靠，也避免多个 JSON 副本成为数据源。
 */
@Injectable()
export class ParkOpsControlService {
  private readonly state: ParkOpsControlState = {
    page: 0,
    autoPlay: false,
    timestamp: Date.now(),
    totalPages: TOTAL_PAGES,
    refreshRequested: false,
    refreshTimestamp: 0,
  };

  getState(consumeRefresh = false): ParkOpsControlState {
    this.expireRefresh();
    const current = this.snapshot();
    if (consumeRefresh && current.refreshRequested) {
      this.state.refreshRequested = false;
      this.touch();
    }
    return current;
  }

  nextPage(): ParkOpsControlState {
    this.state.page = (this.state.page + 1) % TOTAL_PAGES;
    return this.changed();
  }

  prevPage(): ParkOpsControlState {
    this.state.page = (this.state.page + TOTAL_PAGES - 1) % TOTAL_PAGES;
    return this.changed();
  }

  gotoPage(page: number): ParkOpsControlState {
    this.state.page = page;
    return this.changed();
  }

  toggleAuto(enabled?: boolean): ParkOpsControlState {
    this.state.autoPlay = enabled ?? !this.state.autoPlay;
    return this.changed();
  }

  requestRefresh(): ParkOpsControlState {
    this.state.refreshRequested = true;
    this.state.refreshTimestamp = Date.now();
    return this.changed();
  }

  private expireRefresh(): void {
    if (
      this.state.refreshRequested &&
      this.state.refreshTimestamp > 0 &&
      Date.now() - this.state.refreshTimestamp > REFRESH_TTL_MS
    ) {
      this.state.refreshRequested = false;
      this.touch();
    }
  }

  private changed(): ParkOpsControlState {
    this.touch();
    return this.snapshot();
  }

  private touch(): void {
    this.state.timestamp = Date.now();
  }

  private snapshot(): ParkOpsControlState {
    return { ...this.state };
  }
}
