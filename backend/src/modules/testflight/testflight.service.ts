import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { TestFlightInvitation, type TestFlightInvitationStatus } from '../../entities/testflight-invitation.entity';
import type { RootConfig, TestFlightConfig } from '../../common/config/configuration';
import {
  AppleApiException,
  AppleAppStoreClient,
  type AppleLatestBuild,
  type AppleTeamUser,
  type AppleTesterState,
} from './apple-app-store.client';
import { GitHubActionsClient, GitHubActionsException } from './github-actions.client';
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

/** 重发邀请结果：invited=已重新发起；accepted=已是团队成员；pending=原邀请仍有效（无权撤销，见 notice）。 */
export interface ResendTesterOutcome {
  state: 'invited' | 'accepted' | 'pending';
  tester: TestFlightTesterView;
  /** state=pending 时给管理员的引导说明（原邀请仍有效 / 当前密钥无权撤销）。 */
  notice?: string;
}

/** 当前内测构建 + 90 天到期倒计时视图。 */
export interface BuildRenewInfo {
  id: string;
  version: string;
  build: string;
  processingState: string;
  uploadedDate: string | null;
  expired: boolean;
  expirationDate: string | null;
  /** 距到期的完整自然天 (向上取整); 已过期为负; 拿不到到期时间为 null */
  daysRemaining: number | null;
  /** VALID 有效 / PROCESSING 苹果处理中 / EXPIRED 已过期 / UNKNOWN 未知 */
  state: 'VALID' | 'PROCESSING' | 'EXPIRED' | 'UNKNOWN';
}

/** 一键续期后台任务状态 (内存态, 后端重启后回到 idle)。 */
export interface RenewalState {
  configured: boolean;
  repository: string;
  workflow: string;
  ref: string;
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  /** dispatching→queued→building→uploading→processing→succeeded/failed */
  stage: 'idle' | 'dispatching' | 'queued' | 'building' | 'uploading' | 'processing' | 'succeeded' | 'failed';
  message: string;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  fromBuild: string | null;
  targetBuild: string | null;
  runId: number | null;
  runUrl: string | null;
  error: string | null;
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
  latestBuild: BuildRenewInfo | null;
  /** 一键续期 (GitHub Actions) 配置与默认目标 */
  renewal: { configured: boolean; repository: string; workflow: string; ref: string };
  counts: { total: number; pending: number; accepted: number; failed: number };
  error: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** 由 ASC build 推导到期倒计时与展示状态 (纯函数, 便于测试)。 */
export function summarizeBuild(b: AppleLatestBuild | null, now: number = Date.now()): BuildRenewInfo | null {
  if (!b) return null;
  let daysRemaining: number | null = null;
  if (b.expirationDate) {
    const ms = new Date(b.expirationDate).getTime();
    if (!Number.isNaN(ms)) daysRemaining = Math.ceil((ms - now) / DAY_MS);
  }
  let state: BuildRenewInfo['state'] = 'UNKNOWN';
  if (b.processingState && b.processingState !== 'VALID') state = 'PROCESSING';
  else if (b.expired || (daysRemaining !== null && daysRemaining < 0)) state = 'EXPIRED';
  else if (b.processingState === 'VALID') state = 'VALID';
  return { ...b, daysRemaining, state };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * App Manager 密钥无权撤销一条已发出的团队邀请（DELETE /v1/userInvitations/{id} 返回 403），
 * 而团队邀请在被接受前长期有效，此时「重发」无可动作，给管理员明确的人工处理引导。
 */
const PENDING_INVITATION_NOTICE =
  '该邀请仍处于“待接受”状态且持续有效，无需重发。后台所用 App Manager 密钥无权撤销已发出的团队邀请' +
  '（苹果返回 403），因此不能原地重发。请让受邀人在原邀请邮件（含“垃圾邮件”文件夹）中点击“激活账号/接受邀请”；' +
  '若邮件确已丢失，需 Account Holder/管理员在 App Store Connect“用户和访问”中撤销该邀请后重新添加。';

@Injectable()
export class TestFlightService {
  private readonly logger = new Logger(TestFlightService.name);
  /** 进页面自动对账的节流窗口: 60s 内不重复请求苹果 (手动同步用 force 绕过)。 */
  private static readonly SYNC_THROTTLE_MS = 60_000;
  private lastSyncAt = 0;
  private lastSyncSummary: TestFlightSyncSummary | null = null;
  /** 续期任务内存态 */
  private renewalJob: RenewalState;

  constructor(
    @InjectRepository(TestFlightInvitation) private readonly repo: Repository<TestFlightInvitation>,
    private readonly apple: AppleAppStoreClient,
    private readonly github: GitHubActionsClient,
    private readonly config: ConfigService,
  ) {
    this.renewalJob = this.idleRenewal();
  }

  private idleRenewal(): RenewalState {
    const gh = this.cfg.github;
    return {
      configured: gh.configured,
      repository: gh.repository,
      workflow: gh.workflow,
      ref: gh.ref,
      status: 'idle',
      stage: 'idle',
      message: '',
      startedAt: null,
      updatedAt: null,
      finishedAt: null,
      fromBuild: null,
      targetBuild: null,
      runId: null,
      runUrl: null,
      error: null,
    };
  }

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
      renewal: {
        configured: cfg.github.configured,
        repository: cfg.github.repository,
        workflow: cfg.github.workflow,
        ref: cfg.github.ref,
      },
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
      base.latestBuild = summarizeBuild(await this.apple.getLatestBuild());
    } catch (err) {
      base.error = err instanceof AppleApiException ? err.message : (err as Error).message;
      this.logger.warn(`总览读取苹果侧信息失败: ${base.error}`);
    }
    return base;
  }

  /** 当前续期任务状态 (前端轮询); 顺带刷新配置标记, 便于补配 token 后无需重启即可看到。 */
  getRenewalState(): RenewalState {
    const gh = this.cfg.github;
    Object.assign(this.renewalJob, {
      configured: gh.configured,
      repository: gh.repository,
      workflow: gh.workflow,
      ref: gh.ref,
    });
    return { ...this.renewalJob };
  }

  /**
   * 一键续期: TestFlight 每个 build 只有 90 天有效期且无法延长, 续期 = 触发 GitHub Actions
   * 在 macOS 上重新归档、云签名并上传新 build (build 号自动递增)。内部测试员对新 build 免审核、
   * 内部组自动指向最新有效 build, 无需重新邀请。dispatch 同步执行 (权限错误立即返回), 随后后台轮询。
   */
  async renewBuild(operator: string): Promise<RenewalState> {
    this.ensureReady();
    if (!this.cfg.github.configured) {
      throw new ServiceUnavailableException(
        '后台尚未配置 GitHub Token：请在服务器 backend/.env 设置 TESTFLIGHT_RENEW_TOKEN（classic PAT 需 repo+workflow 权限，或 fine-grained 仅授本仓库 Actions 读写）后重启后端。',
      );
    }
    if (this.renewalJob.status === 'running') {
      throw new ConflictException('已有续期构建在执行中，请等待其完成，或查看 GitHub Actions 运行状态。');
    }

    let fromBuild: string | null = null;
    try {
      fromBuild = summarizeBuild(await this.apple.getLatestBuild())?.build ?? null;
    } catch {
      /* 读不到当前 build 不阻断触发, fromBuild 留空 */
    }

    const startedAt = new Date().toISOString();
    Object.assign(this.renewalJob, {
      status: 'running',
      stage: 'dispatching',
      message: '正在触发 GitHub Actions 续期工作流…',
      startedAt,
      updatedAt: startedAt,
      finishedAt: null,
      fromBuild,
      targetBuild: null,
      runId: null,
      runUrl: null,
      error: null,
    });

    try {
      await this.github.dispatchWorkflow();
    } catch (err) {
      const mapped = err instanceof GitHubActionsException ? this.mapGitHub(err) : (err as Error);
      const msg = mapped.message ?? (err as Error).message;
      this.patchRenewal({
        status: 'failed',
        stage: 'failed',
        finishedAt: new Date().toISOString(),
        error: msg,
        message: `触发失败：${msg}`,
      });
      throw mapped;
    }

    this.logger.log(`管理员 ${operator} 触发 TestFlight 一键续期，当前 build=${fromBuild ?? '?'}`);
    this.patchRenewal({ stage: 'queued', message: '已触发，等待 GitHub 分配 macOS runner…' });
    void this.pollRenewal(fromBuild, Date.parse(startedAt));
    return { ...this.renewalJob };
  }

  private patchRenewal(patch: Partial<RenewalState>): void {
    Object.assign(this.renewalJob, patch, { updatedAt: new Date().toISOString() });
  }

  /** 触发后的后台轮询: 找到本次 run → 等 CI 成功 → 等 ASC 处理出新的有效 build。 */
  private async pollRenewal(fromBuild: string | null, dispatchMs: number): Promise<void> {
    const job = this.renewalJob;
    try {
      // 1) 定位本次 workflow_dispatch 对应的 run (最多等约 3 分钟)
      let run: Awaited<ReturnType<GitHubActionsClient['getRun']>> | null = null;
      for (let i = 0; i < 12 && !run; i += 1) {
        await sleep(15_000);
        const runs = await this.github.listDispatchRuns(8).catch(() => []);
        run =
          runs.find(
            (r) =>
              r.event === 'workflow_dispatch' &&
              r.headBranch === this.cfg.github.ref &&
              !Number.isNaN(Date.parse(r.createdAt)) &&
              Date.parse(r.createdAt) >= dispatchMs - 60_000,
          ) ?? null;
      }
      if (!run) throw new Error('已触发，但 3 分钟内未在 GitHub 查到对应运行，请打开 Actions 页面确认。');
      this.patchRenewal({
        runId: run.id,
        runUrl: run.htmlUrl,
        stage: 'building',
        message: 'macOS runner 正在重新归档、签名（约需数分钟）…',
      });

      // 2) 等 CI 跑完 (最多 30 分钟), 期间按 job 名区分构建/上传阶段
      const ciDeadline = Date.now() + 30 * 60_000;
      while (Date.now() < ciDeadline) {
        await sleep(15_000);
        run = await this.github.getRun(run.id);
        this.patchRenewal({ runUrl: run.htmlUrl });
        if (run.status === 'completed') break;
        const jobs = await this.github.listJobs(run.id).catch(() => []);
        const uploading = jobs.some((j) => /testflight|upload|sign|archive/i.test(j.name) && j.status === 'in_progress');
        if (uploading) {
          this.patchRenewal({ stage: 'uploading', message: '正在导出归档并上传新构建到 App Store Connect…' });
        } else if (job.stage !== 'building') {
          this.patchRenewal({ stage: 'building' });
        }
      }
      if (!run || run.status !== 'completed') {
        throw new Error('CI 运行超过 30 分钟仍未结束，请打开 Actions 页面查看。');
      }
      if (run.conclusion !== 'success') {
        throw new Error(`CI 运行未成功（${run.conclusion ?? 'unknown'}），请查看 Actions 日志。`);
      }

      // 3) 等 ASC 处理出 build 号更大且 VALID 的新构建 (最多 20 分钟)
      this.patchRenewal({ stage: 'processing', message: 'CI 已上传，等待 App Store Connect 处理新构建…' });
      const ascDeadline = Date.now() + 20 * 60_000;
      const fromNum = Number.parseInt(fromBuild ?? '0', 10) || 0;
      let target: BuildRenewInfo | null = null;
      while (Date.now() < ascDeadline) {
        await sleep(20_000);
        const latest = summarizeBuild(await this.apple.getLatestBuild().catch(() => null));
        const num = Number.parseInt(latest?.build ?? '0', 10) || 0;
        if (latest && num > fromNum) {
          if (latest.processingState === 'VALID') {
            target = latest;
            break;
          }
          this.patchRenewal({ targetBuild: latest.build, message: `新 build #${latest.build} 已上传，苹果处理中…` });
        }
      }
      if (!target) {
        throw new Error('未在 20 分钟内等到处理完成的新构建；构建可能仍在 App Store Connect 处理，可稍后刷新本页查看。');
      }
      this.patchRenewal({
        status: 'succeeded',
        stage: 'succeeded',
        targetBuild: target.build,
        finishedAt: new Date().toISOString(),
        error: null,
        message: `续期完成：新 build #${target.build} 已生效，内部测试员无需重新接受邀请；到期时间更新为 ${target.expirationDate ?? '—'}。`,
      });
      this.logger.log(`TestFlight 续期成功: build ${fromBuild ?? '?'} -> ${target.build}`);
    } catch (err) {
      const msg = err instanceof GitHubActionsException ? this.mapGitHub(err).message : (err as Error).message;
      this.patchRenewal({
        status: 'failed',
        stage: 'failed',
        finishedAt: new Date().toISOString(),
        error: msg,
        message: `续期失败：${msg}`,
      });
      this.logger.warn(`TestFlight 一键续期失败: ${msg}`);
    }
  }

  private mapGitHub(err: GitHubActionsException): Error {
    if (err.httpStatus === 0) return new ServiceUnavailableException(`服务器连不上 GitHub：${err.message}`);
    if (err.httpStatus === 401 || err.httpStatus === 403) {
      return new ForbiddenException('GitHub Token 无效或权限不足：classic PAT 需勾选 repo 与 workflow，fine-grained 需对该仓库授予 Actions 读写。');
    }
    if (err.httpStatus === 404) {
      return new BadGatewayException(`GitHub 找不到仓库或工作流（${this.cfg.github.repository} / ${this.cfg.github.workflow}），请检查 TESTFLIGHT_RENEW_* 配置与 token 权限。`);
    }
    return new BadGatewayException(`GitHub API 错误 (HTTP ${err.httpStatus})：${err.message}`);
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
      throw this.mapApple(err, '发起邀请');
    }
  }

  /**
   * 重发邀请。苹果没有单独的 resend 接口，常规做法=先 DELETE 旧邀请再 POST；
   * 但常驻服务器的 App Manager 密钥无权撤销团队邀请（DELETE /v1/userInvitations/{id} → 403）。分支：
   *   - 已接受团队邀请：拒绝（无需重发）；
   *   - 仍有 pending 邀请且当前密钥无权撤销：不改状态、不报错，返回引导性 notice（原邀请长期有效）；
   *   - 旧邀请已撤销/过期（查无 pending，或 DELETE 返回 404）：直接 POST 一封新邀请（App Manager 有权限）。
   */
  async resend(id: number, operator: string): Promise<ResendTesterOutcome> {
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
        let revokeForbidden = false;
        await this.apple.deleteInvitation(inv.id).catch((e) => {
          if (e instanceof AppleApiException && e.httpStatus === 404) return; // 已不存在，可直接重建
          if (e instanceof AppleApiException && e.httpStatus === 403) {
            // App Manager 无权撤销团队邀请：不能原地重发，保留原 pending 邀请并引导人工处理。
            revokeForbidden = true;
            return;
          }
          throw e;
        });
        if (revokeForbidden) {
          this.applyState(row, inv); // 恢复/保持 PENDING，清掉历史 FAILED 标记
          const saved = await this.repo.save(row);
          this.logger.warn(`重发中止：App Manager 密钥无权撤销 pending 团队邀请，保留原邀请: ${row.email}`);
          return { state: 'pending', tester: this.toView(saved), notice: PENDING_INVITATION_NOTICE };
        }
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
      if (err instanceof AppleApiException && err.isDuplicate) {
        // 创建时苹果报重复（邀请/成员其实已存在，常见于列表过滤的最终一致性），按实时状态归一。
        const live = await this.resolveLiveState(row.email);
        if (live?.kind === 'user') {
          this.applyState(row, live);
          const saved = await this.repo.save(row);
          return { state: 'accepted', tester: this.toView(saved) };
        }
        if (live?.kind === 'invitation') {
          this.applyState(row, live);
          const saved = await this.repo.save(row);
          return { state: 'pending', tester: this.toView(saved), notice: PENDING_INVITATION_NOTICE };
        }
      }
      if (err instanceof AppleApiException) {
        row.status = 'FAILED';
        row.lastError = err.message.slice(0, 1000);
        await this.repo.save(row).catch(() => undefined);
      }
      throw this.mapApple(err, '重发邀请');
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

  /**
   * 把苹果错误翻译成给管理员看的中文异常。刻意区分 401（密钥本身无效/被撤销）与 403（密钥有效但
   * 当前角色无权做此操作，例如 App Manager 不能撤销团队邀请），避免过去把 403 也笼统报成「密钥无效」。
   */
  private mapApple(err: unknown, operation = '调用 App Store Connect'): Error {
    if (!(err instanceof AppleApiException)) return err as Error;
    if (err.httpStatus === 0) {
      return new ServiceUnavailableException(`服务器连不上 App Store Connect（请检查主控机外网/DNS）：${err.message}`);
    }
    if (err.httpStatus === 401) {
      return new UnauthorizedException(
        `App Store Connect 密钥无效、已过期或被撤销（401 未授权）：请检查 TESTFLIGHT_KEY_ID、Issuer ID 与 .p8 私钥是否匹配，且该密钥在 App Store Connect 仍为 Active。（操作：${operation}）`,
      );
    }
    if (err.httpStatus === 403) {
      return new ForbiddenException(
        `App Store Connect 密钥权限不足（403 禁止访问）：当前 App Manager 密钥可创建、查询内部测试邀请，但无权执行“${operation}”` +
          `（撤销团队邀请等操作需 Admin/Account Holder，或改在 App Store Connect 网页处理）。苹果详情：${err.message}`,
      );
    }
    if (err.httpStatus === 409) {
      return new ConflictException(`苹果返回冲突：${err.message}`);
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
