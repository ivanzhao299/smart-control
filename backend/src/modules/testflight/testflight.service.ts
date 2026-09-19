import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { TestFlightInvitation, type TestFlightInvitationStatus } from '../../entities/testflight-invitation.entity';
import type { RootConfig, TestFlightConfig } from '../../common/config/configuration';
import {
  AppleApiException,
  AppleAppStoreClient,
  type AppleTeamUser,
  type AppleTesterState,
} from './apple-app-store.client';
import { InviteTesterDto } from './dto/invite-tester.dto';

/** 与 App Store Connect 对账结果。 */
export interface TestFlightSyncSummary {
  syncedAt: string;
  /** 内部组在册(已接受)测试员数 */
  accepted: number;
  /** 待接受的最小权限测试员邀请数 */
  pending: number;
  /** 本次新落入本地台账的邮箱 (在 ASC 存在但本地原本没有) */
  imported: string[];
  /** 对账后本地台账总行数 */
  totalLocal: number;
  /** true=命中 60s 节流, 未真正请求苹果 */
  throttled: boolean;
}

/** 管理类角色: 待接受邀请里若含这些角色, 视为团队管理账号而非本系统邀请的测试员, 不入台账。 */
const PRIVILEGED_ROLES = new Set(['ACCOUNT_HOLDER', 'ADMIN', 'APP_MANAGER']);
/** 角色展示优先级 (role 列只有 varchar(32), 多角色只存一个主要角色)。 */
const ROLE_RANK = ['ACCOUNT_HOLDER', 'ADMIN', 'APP_MANAGER', 'DEVELOPER', 'MARKETING', 'SALES', 'CUSTOMER_SUPPORT', 'FINANCE', 'REPORTING'];

function primaryRole(roles: string[], fallback: string): string {
  for (const r of ROLE_RANK) if (roles.includes(r)) return r;
  return roles[0] ?? fallback;
}

export interface TestFlightTesterView {
  id: number;
  appleInvitationId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  appId: string;
  /** 存储状态 */
  status: TestFlightInvitationStatus;
  /** 结合过期时间推导的展示状态: PENDING / EXPIRED / ACCEPTED / FAILED */
  effectiveStatus: 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'FAILED';
  expirationDate: string | null;
  lastError: string | null;
  invitedBy: string | null;
  invitedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestFlightOverview {
  configured: boolean;
  enabled: boolean;
  keyId: string;
  issuerId: string;
  appId: string;
  bundleId: string;
  testerRole: string;
  internalGroupName: string;
  app: { id: string; name: string; bundleId: string } | null;
  internalGroup: { id: string; name: string } | null;
  latestBuild: { version: string; build: string; processingState: string; uploadedDate: string | null } | null;
  counts: { total: number; pending: number; accepted: number; failed: number };
  error: string | null;
}

@Injectable()
export class TestFlightService {
  private readonly logger = new Logger(TestFlightService.name);
  /** 进页面自动对账的节流窗口: 60s 内不重复请求苹果 (手动同步用 force 绕过)。 */
  private static readonly SYNC_THROTTLE_MS = 60_000;
  private lastSyncAt = 0;
  private lastSyncSummary: TestFlightSyncSummary | null = null;

  constructor(
    @InjectRepository(TestFlightInvitation) private readonly repo: Repository<TestFlightInvitation>,
    private readonly apple: AppleAppStoreClient,
    private readonly config: ConfigService,
  ) {}

  private get cfg(): TestFlightConfig {
    return this.config.getOrThrow<RootConfig['testflight']>('testflight');
  }

  private ensureReady(): void {
    if (!this.cfg.configured) {
      throw new ServiceUnavailableException(
        '后台尚未配置 App Store Connect API 密钥：请在服务器 backend/.env 设置 TESTFLIGHT_ISSUER_ID / TESTFLIGHT_KEY_ID / TESTFLIGHT_P8_BASE64（App Manager 专用钥）后重启后端。',
      );
    }
    if (!this.cfg.enabled) {
      throw new ServiceUnavailableException('TestFlight 邀请功能已被停用（TESTFLIGHT_ENABLED=false）。');
    }
  }

  /** 后台首页总览：配置状态 + App/内部组/最新构建 + 计数。苹果侧失败不拖垮整页。 */
  async overview(): Promise<TestFlightOverview> {
    const cfg = this.cfg;
    const rows = await this.repo.find();
    const counts = {
      total: rows.length,
      pending: rows.filter((r) => r.status === 'PENDING').length,
      accepted: rows.filter((r) => r.status === 'ACCEPTED').length,
      failed: rows.filter((r) => r.status === 'FAILED').length,
    };
    const base: TestFlightOverview = {
      configured: cfg.configured,
      enabled: cfg.enabled,
      keyId: cfg.keyId,
      issuerId: cfg.issuerId,
      appId: cfg.appId,
      bundleId: cfg.bundleId,
      testerRole: cfg.testerRole,
      internalGroupName: cfg.internalGroupName,
      app: null,
      internalGroup: null,
      latestBuild: null,
      counts,
      error: null,
    };
    if (!cfg.configured || !cfg.enabled) return base;
    try {
      const app = await this.apple.getApp();
      base.app = {
        id: app.id,
        name: String(app.attributes.name ?? ''),
        bundleId: String(app.attributes.bundleId ?? cfg.bundleId),
      };
      const group = await this.apple.getInternalGroup();
      base.internalGroup = group ? { id: group.id, name: String(group.attributes.name ?? '') } : null;
      base.latestBuild = await this.apple.getLatestBuild();
    } catch (err) {
      base.error = err instanceof AppleApiException ? err.message : (err as Error).message;
      this.logger.warn(`总览读取苹果侧信息失败: ${base.error}`);
    }
    return base;
  }

  /**
   * 列表；live=true 时先与 App Store Connect 自动对账一次 (60s 节流),
   * 让在 ASC 直接添加/接受的测试员也能自动出现。苹果侧失败不拖垮页面, 降级返回本地台账。
   */
  async list(live = true): Promise<TestFlightTesterView[]> {
    if (live && this.cfg.configured && this.cfg.enabled) {
      try {
        await this.syncFromApple(false);
      } catch (err) {
        this.logger.warn(`进页面自动同步失败，降级展示本地台账: ${(err as Error).message}`);
      }
    }
    const rows = await this.repo.find({ order: { id: 'DESC' } });
    return rows.map((r) => this.toView(r));
  }

  /**
   * 与 App Store Connect 单向对账 (Apple → 本地), 不反向改苹果、不删除本地行:
   *   已接受 = 内部组 betaTesters; 待接受 = userInvitations 中本系统发起的最小权限(MARKETING)邀请。
   * 按 email upsert 进本地台账; 苹果侧已查不到的本地行保留 (过期由 effectiveStatus 推导, 失败行保留)。
   * @param force true=手动同步, 绕过 60s 节流
   */
  async syncFromApple(force = false): Promise<TestFlightSyncSummary> {
    this.ensureReady();
    const now = Date.now();
    if (!force && this.lastSyncSummary && now - this.lastSyncAt < TestFlightService.SYNC_THROTTLE_MS) {
      return { ...this.lastSyncSummary, throttled: true };
    }

    const group = await this.apple.getInternalGroup();
    if (!group) {
      throw new BadGatewayException('未在 App Store Connect 找到内部测试组（isInternalGroup=true），无法同步。');
    }
    const [testers, users, invitations] = await Promise.all([
      this.apple.listInternalBetaTesters(group.id),
      this.apple.listTeamUsers().catch((err): AppleTeamUser[] => {
        this.logger.warn(`同步时读取团队成员失败 (角色将留空): ${(err as Error).message}`);
        return [];
      }),
      this.apple.listPendingInvitations(),
    ]);

    const userByEmail = new Map(users.map((u) => [u.email, u]));
    const acceptedEmails = new Set(testers.map((t) => t.email));
    // 只收本系统口径的待接受测试员: 含 MARKETING 且不含任何管理类角色。
    const pending = invitations.filter(
      (i) => i.roles.includes(this.cfg.testerRole) && !i.roles.some((r) => PRIVILEGED_ROLES.has(r)),
    );

    const existing = await this.repo.find();
    const byEmail = new Map(existing.map((r) => [r.email, r]));
    const imported: string[] = [];
    const toSave: TestFlightInvitation[] = [];

    const obtain = (email: string): TestFlightInvitation => {
      let row = byEmail.get(email);
      if (!row) {
        row = this.repo.create({
          email,
          firstName: '',
          lastName: '',
          role: this.cfg.testerRole,
          appId: this.cfg.appId,
          status: 'PENDING',
          invitedBy: 'apple-sync',
        });
        byEmail.set(email, row);
        imported.push(email);
      }
      return row;
    };

    // 1) 已接受 (内部组在册) —— 优先于待接受。
    for (const t of testers) {
      const row = obtain(t.email);
      if (t.firstName) row.firstName = t.firstName;
      if (t.lastName) row.lastName = t.lastName;
      const meta = userByEmail.get(t.email);
      if (meta?.roles.length) row.role = primaryRole(meta.roles, this.cfg.testerRole);
      row.appId = this.cfg.appId;
      row.status = 'ACCEPTED';
      row.appleInvitationId = null;
      row.expirationDate = null;
      row.lastError = null;
      toSave.push(row);
    }

    // 2) 待接受 (本系统发起的最小权限邀请, 且尚未进入内部组)。
    let pendingCount = 0;
    for (const inv of pending) {
      if (acceptedEmails.has(inv.email)) continue;
      const row = obtain(inv.email);
      if (inv.firstName) row.firstName = inv.firstName;
      if (inv.lastName) row.lastName = inv.lastName;
      row.role = primaryRole(inv.roles, this.cfg.testerRole);
      row.appId = this.cfg.appId;
      row.status = 'PENDING';
      row.appleInvitationId = inv.id;
      row.expirationDate = inv.expirationDate ? new Date(inv.expirationDate) : null;
      row.lastError = null;
      toSave.push(row);
      pendingCount += 1;
    }

    if (toSave.length) await this.repo.save(toSave);

    const totalLocal = await this.repo.count();
    const summary: TestFlightSyncSummary = {
      syncedAt: new Date().toISOString(),
      accepted: testers.length,
      pending: pendingCount,
      imported,
      totalLocal,
      throttled: false,
    };
    this.lastSyncAt = Date.now();
    this.lastSyncSummary = summary;
    this.logger.log(`与 App Store Connect 对账完成: 已接受 ${testers.length}、待接受 ${pendingCount}、新导入 ${imported.length}、本地共 ${totalLocal}`);
    return summary;
  }

  /**
   * 邀请内部测试员（幂等）：
   *   已是团队用户 → ACCEPTED；已有待接受邀请 → 回到 PENDING；否则创建最小权限邀请。
   */
  async invite(dto: InviteTesterDto, operator: string): Promise<{ state: 'invited' | 'pending' | 'accepted'; tester: TestFlightTesterView }> {
    this.ensureReady();
    const email = dto.email.trim().toLowerCase();
    const firstName = dto.firstName.trim();
    const lastName = dto.lastName.trim();

    let row = await this.repo.findOne({ where: { email } });
    if (!row) {
      row = this.repo.create({
        email,
        firstName,
        lastName,
        role: this.cfg.testerRole,
        appId: this.cfg.appId,
        status: 'PENDING',
      });
    }
    row.firstName = firstName;
    row.lastName = lastName;
    row.role = this.cfg.testerRole;
    row.appId = this.cfg.appId;

    try {
      const existing = await this.resolveLiveState(email);
      if (existing?.kind === 'user') {
        this.applyState(row, existing);
        const saved = await this.repo.save(row);
        return { state: 'accepted', tester: this.toView(saved) };
      }
      if (existing?.kind === 'invitation') {
        this.applyState(row, existing);
        row.invitedBy ??= operator;
        const saved = await this.repo.save(row);
        return { state: 'pending', tester: this.toView(saved) };
      }

      const created = await this.apple.createInvitation({ email, firstName, lastName });
      row.appleInvitationId = created.id;
      row.status = 'PENDING';
      row.expirationDate = created.expirationDate ? new Date(created.expirationDate) : null;
      row.lastError = null;
      row.invitedBy = operator;
      row.invitedAt = new Date();
      const saved = await this.repo.save(row);
      this.logger.log(`已发起内部测试邀请: ${email} (${lastName}${firstName}) by ${operator}, apple=${created.id}`);
      return { state: 'invited', tester: this.toView(saved) };
    } catch (err) {
      if (err instanceof AppleApiException && err.isDuplicate) {
        const live = await this.resolveLiveState(email);
        if (live) {
          this.applyState(row, live);
          const saved = await this.repo.save(row);
          return { state: live.kind === 'user' ? 'accepted' : 'pending', tester: this.toView(saved) };
        }
      }
      if (err instanceof AppleApiException) {
        row.status = 'FAILED';
        row.lastError = err.message.slice(0, 1000);
        await this.repo.save(row).catch(() => undefined);
      }
      throw this.mapApple(err);
    }
  }

  /** 重发邀请：已接受则拒绝；有待接受邀请先撤销再重新发起。 */
  async resend(id: number, operator: string): Promise<{ state: 'invited' | 'accepted'; tester: TestFlightTesterView }> {
    this.ensureReady();
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`邀请记录 #${id} 不存在`);

    try {
      const user = await this.apple.findUser(row.email);
      if (user) {
        this.applyState(row, user);
        await this.repo.save(row);
        throw new BadRequestException('该测试员已接受邀请并成为团队成员，无需重发。');
      }
      const inv = await this.apple.findInvitation(row.email);
      if (inv) {
        await this.apple.deleteInvitation(inv.id).catch((e) => {
          if (e instanceof AppleApiException && e.httpStatus === 404) return;
          throw e;
        });
      }
      const created = await this.apple.createInvitation({
        email: row.email,
        firstName: row.firstName,
        lastName: row.lastName,
      });
      row.appleInvitationId = created.id;
      row.status = 'PENDING';
      row.expirationDate = created.expirationDate ? new Date(created.expirationDate) : null;
      row.lastError = null;
      row.invitedBy = operator;
      row.invitedAt = new Date();
      const saved = await this.repo.save(row);
      this.logger.log(`重发内部测试邀请: ${row.email} by ${operator}, apple=${created.id}`);
      return { state: 'invited', tester: this.toView(saved) };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      if (err instanceof AppleApiException) {
        row.status = 'FAILED';
        row.lastError = err.message.slice(0, 1000);
        await this.repo.save(row).catch(() => undefined);
      }
      throw this.mapApple(err);
    }
  }

  private async resolveLiveState(email: string): Promise<AppleTesterState | null> {
    const user = await this.apple.findUser(email);
    if (user) return user;
    return this.apple.findInvitation(email);
  }

  private applyState(row: TestFlightInvitation, state: AppleTesterState): void {
    if (state.kind === 'user') {
      row.status = 'ACCEPTED';
      row.expirationDate = null;
      row.lastError = null;
    } else {
      row.status = 'PENDING';
      row.appleInvitationId = state.id;
      row.expirationDate = state.expirationDate ? new Date(state.expirationDate) : null;
      row.lastError = null;
    }
  }

  private mapApple(err: unknown): Error {
    if (!(err instanceof AppleApiException)) return err as Error;
    if (err.httpStatus === 0) {
      return new ServiceUnavailableException(`服务器连不上 App Store Connect（请检查主控机外网/DNS）：${err.message}`);
    }
    if (err.httpStatus === 401 || err.httpStatus === 403) {
      return new ForbiddenException('App Store Connect 密钥无效或权限不足：请确认使用的是可管理 TestFlight 的 App Manager 及以上密钥，且未被撤销。');
    }
    if (err.httpStatus === 409) {
      return new BadRequestException(`苹果返回冲突：${err.message}`);
    }
    return new BadGatewayException(`App Store Connect 返回错误 (HTTP ${err.httpStatus})：${err.message}`);
  }

  private toView(row: TestFlightInvitation): TestFlightTesterView {
    const expirationIso = normalizeIso(row.expirationDate);
    let effectiveStatus: TestFlightTesterView['effectiveStatus'];
    if (row.status === 'FAILED') effectiveStatus = 'FAILED';
    else if (row.status === 'ACCEPTED') effectiveStatus = 'ACCEPTED';
    else if (expirationIso && new Date(expirationIso).getTime() < Date.now()) effectiveStatus = 'EXPIRED';
    else effectiveStatus = 'PENDING';
    return {
      id: row.id,
      appleInvitationId: row.appleInvitationId,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      role: row.role,
      appId: row.appId,
      status: row.status,
      effectiveStatus,
      expirationDate: expirationIso,
      lastError: row.lastError,
      invitedBy: row.invitedBy,
      invitedAt: normalizeIso(row.invitedAt),
      createdAt: normalizeIso(row.createdAt) ?? '',
      updatedAt: normalizeIso(row.updatedAt) ?? '',
    };
  }
}

/** TypeORM/better-sqlite3 下 datetime 可能是 Date、'YYYY-MM-DD HH:MM:SS'(UTC) 或 ISO, 统一成 ISO。 */
function normalizeIso(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === 'string') {
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(value)) {
      return `${value.replace(' ', 'T').replace(/(\.\d+)?$/, '')}Z`;
    }
    return value;
  }
  return null;
}
