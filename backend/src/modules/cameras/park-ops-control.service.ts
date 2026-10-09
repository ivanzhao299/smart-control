import { Injectable } from '@nestjs/common';

/**
 * 一次远程接管的公开信息。remainingMs 为距自动还权的剩余毫秒。
 */
export interface ControlClaimInfo {
  ownerId: string;
  ownerName: string;
  claimedAt: number;
  lastActiveAt: number;
  remainingMs: number;
}

export interface ParkOpsControlState {
  page: number;
  autoPlay: boolean;
  timestamp: number;
  totalPages: number;
  refreshRequested: boolean;
  refreshTimestamp: number;
  /** 是否正被某个远程终端接管（现场主控时为 false）。 */
  claimed: boolean;
  claim: ControlClaimInfo | null;
}

/**
 * 大屏总页数。必须与 frontend/public/park-ops/index.html 中 `<section class="page">`
 * 的实际数量保持一致（当前 6 页：综合态势/企业经营/安全消防/人车管理/视频监控/能源管理）；
 * 以后增删大屏页面时务必同步修改此常量，否则远程翻页与自动轮播无法到达新增页。
 */
const TOTAL_PAGES = 6;
const REFRESH_TTL_MS = 10_000;
/**
 * 接管 TTL：远程终端最后一次操作（或心跳）后，超过该时长无动作即自动还权现场，
 * 同时停止其开启的自动轮播。避免测试终端长期占用大屏控制。
 */
const CLAIM_TTL_MS = 90_000;

interface ControlClaim {
  ownerId: string;
  ownerName: string;
  claimedAt: number;
  lastActiveAt: number;
}

/**
 * 园区大屏的实时控制信号。
 *
 * 默认现场主控：远程翻页 / 自动轮播必须先「接管」大屏（claim），且接管在
 * CLAIM_TTL_MS 无操作后自动释放。这些值只描述当前翻页、自动播放、一次性刷新
 * 指令和接管状态，不是业务记录；进程重启后恢复安全默认值（首页、不轮播、未接管）。
 */
@Injectable()
export class ParkOpsControlService {
  private readonly state = {
    page: 0,
    autoPlay: false,
    timestamp: Date.now(),
    totalPages: TOTAL_PAGES,
    refreshRequested: false,
    refreshTimestamp: 0,
  };
  private claim: ControlClaim | null = null;

  // ==================== 接管 / 释放 ====================

  /** 显式接管大屏；同一 owner 调用即续期，不同 owner 调用则替换接管（抢占）。 */
  claimControl(ownerId: string, ownerName?: string): ParkOpsControlState {
    const now = Date.now();
    const trimmed = ownerName?.trim();
    const sameOwner = this.claim && this.claim.ownerId === ownerId;
    this.claim = {
      ownerId,
      ownerName: trimmed || (sameOwner ? this.claim!.ownerName : '远程终端'),
      claimedAt: sameOwner ? this.claim!.claimedAt : now,
      lastActiveAt: now,
    };
    this.touch();
    return this.snapshot();
  }

  /** 释放接管；不传 ownerId 为现场强制释放，传 ownerId 仅当匹配时释放。 */
  releaseControl(ownerId?: string): ParkOpsControlState {
    if (this.claim && (!ownerId || this.claim.ownerId === ownerId)) {
      this.claim = null;
      // 释放时停止接管期开启的自动轮播，避免现场继续被翻页。
      if (this.state.autoPlay) this.state.autoPlay = false;
      return this.changed();
    }
    return this.snapshot();
  }

  /** 返回当前有效接管；TTL 过期则自动还权（并停止轮播）。 */
  private activeClaim(now = Date.now()): ControlClaim | null {
    if (!this.claim) return null;
    if (now - this.claim.lastActiveAt > CLAIM_TTL_MS) {
      this.claim = null;
      if (this.state.autoPlay) this.state.autoPlay = false;
      this.touch();
      return null;
    }
    return this.claim;
  }

  /** 判定 ownerId 是否为当前有效接管者。 */
  private isOwner(ownerId: string | undefined, now = Date.now()): boolean {
    const active = this.activeClaim(now);
    return !!active && !!ownerId && active.ownerId === ownerId;
  }

  /** 有效操作 / 心跳时为接管续期。 */
  private keepClaim(now: number): void {
    if (this.claim) this.claim.lastActiveAt = now;
  }

  // ==================== 状态读取 ====================

  getState(consumeRefresh = false): ParkOpsControlState {
    this.expireRefresh();
    this.activeClaim(); // 顺带处理 TTL 自动还权
    const current = this.snapshot();
    if (consumeRefresh && current.refreshRequested) {
      this.state.refreshRequested = false;
      this.touch();
    }
    return current;
  }

  // ==================== 翻页 / 轮播（需有效接管） ====================

  nextPage(ownerId?: string): ParkOpsControlState {
    const now = Date.now();
    if (!this.isOwner(ownerId, now)) return this.snapshot();
    this.state.page = (this.state.page + 1) % TOTAL_PAGES;
    this.keepClaim(now);
    return this.changed();
  }

  prevPage(ownerId?: string): ParkOpsControlState {
    const now = Date.now();
    if (!this.isOwner(ownerId, now)) return this.snapshot();
    this.state.page = (this.state.page + TOTAL_PAGES - 1) % TOTAL_PAGES;
    this.keepClaim(now);
    return this.changed();
  }

  gotoPage(page: number, ownerId?: string): ParkOpsControlState {
    const now = Date.now();
    if (!this.isOwner(ownerId, now)) return this.snapshot();
    this.state.page = page;
    this.keepClaim(now);
    return this.changed();
  }

  toggleAuto(enabled?: boolean, ownerId?: string): ParkOpsControlState {
    const now = Date.now();
    if (!this.isOwner(ownerId, now)) return this.snapshot();
    this.state.autoPlay = enabled ?? !this.state.autoPlay;
    this.keepClaim(now);
    return this.changed();
  }

  /** 强制刷新是低风险只读操作，不要求接管（现场与远程均可触发）。 */
  requestRefresh(): ParkOpsControlState {
    this.state.refreshRequested = true;
    this.state.refreshTimestamp = Date.now();
    return this.changed();
  }

  // ==================== 内部 ====================

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
    const now = Date.now();
    const active = this.activeClaim(now);
    return {
      ...this.state,
      claimed: !!active,
      claim: active
        ? {
            ownerId: active.ownerId,
            ownerName: active.ownerName,
            claimedAt: active.claimedAt,
            lastActiveAt: active.lastActiveAt,
            remainingMs: Math.max(0, CLAIM_TTL_MS - (now - active.lastActiveAt)),
          }
        : null,
    };
  }
}
