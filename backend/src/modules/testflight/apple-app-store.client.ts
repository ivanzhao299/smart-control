import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createSign } from 'node:crypto';
import type { RootConfig, TestFlightConfig } from '../../common/config/configuration';

const API_BASE = 'https://api.appstoreconnect.apple.com';
const AUDIENCE = 'appstoreconnect-v1';
/** JWT 有效期 10 分钟 (苹果上限 20 分钟), 留 1 分钟余量再续签 */
const TOKEN_TTL_SECONDS = 600;
const REQUEST_TIMEOUT_MS = 20000;

export interface AppleError {
  status?: string;
  code?: string;
  title?: string;
  detail?: string;
}

/** 苹果接口非 2xx 时抛出, 保留 httpStatus 与 errors 供 service 做语义判断 (如 409 重复)。 */
export class AppleApiException extends Error {
  constructor(
    public readonly httpStatus: number,
    public readonly errors: AppleError[],
  ) {
    super(errors.map((e) => `${e.code ?? e.title ?? 'ERROR'}: ${e.detail ?? e.title ?? ''}`).join(' | ') || `Apple API HTTP ${httpStatus}`);
    this.name = 'AppleApiException';
  }

  /** 409 且为邮箱重复 (邀请已存在 / 已是团队成员)。 */
  get isDuplicate(): boolean {
    if (this.httpStatus !== 409) return false;
    const text = `${this.message} ${this.errors.map((e) => e.code).join(' ')}`;
    return /DUPLICATE|already|exists|STATE_ERROR/i.test(text);
  }
}

interface AppleResource {
  id: string;
  type: string;
  attributes: Record<string, unknown>;
  relationships?: Record<string, unknown>;
}
interface AppleListResponse {
  data: AppleResource[];
  included?: AppleResource[];
}
interface AppleSingleResponse {
  data: AppleResource;
  included?: AppleResource[];
}

export interface AppleTesterState {
  kind: 'user' | 'invitation';
  id: string;
  email: string;
  roles: string[];
  expirationDate: string | null;
}

/** 最近一次构建 (含 TestFlight 90 天到期字段)。 */
export interface AppleLatestBuild {
  id: string;
  /** 营销版本 (CFBundleShortVersionString), 来自 preReleaseVersion */
  version: string;
  /** build 号 (CFBundleVersion) */
  build: string;
  /** PROCESSING / VALID 等 */
  processingState: string;
  uploadedDate: string | null;
  /** ASC 标记是否已过期 */
  expired: boolean;
  /** 90 天到期时间 (ISO, 带时区) */
  expirationDate: string | null;
}

/** 内部组在册测试员 (betaTesters of the internal beta group), 即当前可参与内部测试的人 */
export interface AppleInternalTester {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

/** 团队成员 (/v1/users), 用于给在册内部测试员补全角色与姓名 */
export interface AppleTeamUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
}

/** 尚未接受的团队用户邀请 (/v1/userInvitations) */
export interface ApplePendingInvitation {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roles: string[];
  expirationDate: string | null;
}

/**
 * 极简 App Store Connect REST 客户端: 只用 node:crypto 签 ES256 JWT, 不引新依赖。
 * 权限范围由密钥角色决定 —— 生产常驻的是 App Manager 专用钥 (仅可管理 TestFlight),
 * 不是 Admin 钥。
 */
@Injectable()
export class AppleAppStoreClient {
  private readonly logger = new Logger(AppleAppStoreClient.name);
  private cachedToken: { token: string; exp: number } | null = null;

  constructor(private readonly config: ConfigService) {}

  private get cfg(): TestFlightConfig {
    return this.config.getOrThrow<RootConfig['testflight']>('testflight');
  }

  /** ES256 JWT, 参考 Apple 文档; P-256 签名用 IEEE P1363 (raw r||s) 编码。 */
  private signToken(): string {
    const { issuerId, keyId, privateKeyPem } = this.cfg;
    const now = Math.floor(Date.now() / 1000);
    if (this.cachedToken && this.cachedToken.exp - 60 > now) {
      return this.cachedToken.token;
    }
    const b64url = (obj: unknown): string => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const header = b64url({ alg: 'ES256', kid: keyId, typ: 'JWT' });
    const claims = b64url({ iss: issuerId, iat: now, exp: now + TOKEN_TTL_SECONDS, aud: AUDIENCE });
    const signingInput = `${header}.${claims}`;
    const signature = createSign('SHA256')
      .update(signingInput)
      .sign({ key: privateKeyPem, dsaEncoding: 'ieee-p1363' })
      .toString('base64url');
    const token = `${signingInput}.${signature}`;
    this.cachedToken = { token, exp: now + TOKEN_TTL_SECONDS };
    return token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${this.signToken()}`,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (err) {
      this.logger.warn(`调用 App Store Connect 失败 (网络): ${method} ${path.split('?')[0]} ${(err as Error).message}`);
      throw new AppleApiException(0, [{ code: 'NETWORK_UNREACHABLE', detail: `无法连接 App Store Connect: ${(err as Error).message}` }]);
    }

    const text = await res.text();
    let json: any = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    if (!res.ok) {
      const errors: AppleError[] = Array.isArray(json?.errors) ? json.errors : [{ status: String(res.status), detail: text.slice(0, 300) }];
      this.logger.warn(`Apple ${method} ${path.split('?')[0]} HTTP ${res.status}: ${errors.map((e) => e.code).join(',')}`);
      throw new AppleApiException(res.status, errors);
    }
    return json as T;
  }

  /** 当前 App 元信息 */
  async getApp(): Promise<AppleResource> {
    const r = await this.request<AppleSingleResponse>('GET', `/v1/apps/${this.cfg.appId}?fields[apps]=name,bundleId,primaryLocale`);
    return r.data;
  }

  /** 内部 TestFlight 组 (isInternalGroup=true) */
  async getInternalGroup(): Promise<AppleResource | null> {
    const r = await this.request<AppleListResponse>(
      'GET',
      `/v1/apps/${this.cfg.appId}/betaGroups?limit=200&fields[betaGroups]=name,isInternalGroup,publicLinkEnabled,createdDate`,
    );
    return (
      r.data.find((g) => g.attributes.isInternalGroup === true && (g.attributes.name as string) === this.cfg.internalGroupName) ??
      r.data.find((g) => g.attributes.isInternalGroup === true) ??
      null
    );
  }

  /** 最近一次上传的构建版本 (含营销版本、90 天到期字段), 给后台展示「内测中版本 / 到期倒计时」。 */
  async getLatestBuild(): Promise<AppleLatestBuild | null> {
    const r = await this.request<AppleListResponse>(
      'GET',
      `/v1/builds?filter[app]=${this.cfg.appId}&sort=-uploadedDate&limit=1&include=preReleaseVersion` +
        `&fields[builds]=version,processingState,uploadedDate,expired,expirationDate&fields[preReleaseVersions]=version`,
    );
    const build = r.data?.[0];
    if (!build) return null;
    const preRelId = (build.relationships?.preReleaseVersion as { data?: { id: string } } | undefined)?.data?.id;
    const preRel = preRelId ? r.included?.find((i) => i.id === preRelId) : undefined;
    return {
      id: build.id,
      version: (preRel?.attributes.version as string) ?? '',
      build: String(build.attributes.version ?? ''),
      processingState: String(build.attributes.processingState ?? ''),
      uploadedDate: (build.attributes.uploadedDate as string) ?? null,
      expired: build.attributes.expired === true,
      expirationDate: (build.attributes.expirationDate as string) ?? null,
    };
  }

  /**
   * 内部组在册测试员 (已接受、当前可内测)。
   * 注意: /v1/apps/{id}/betaTesters 的 GET_RELATED 对本钥返回 403, 权威来源是
   * 内部组关系 /v1/betaGroups/{internalGroupId}/betaTesters。
   */
  async listInternalBetaTesters(internalGroupId: string): Promise<AppleInternalTester[]> {
    const r = await this.request<AppleListResponse>(
      'GET',
      `/v1/betaGroups/${internalGroupId}/betaTesters?limit=200&fields[betaTesters]=firstName,lastName,email,inviteType`,
    );
    return (r.data ?? [])
      .map((t) => ({
        id: t.id,
        email: String(t.attributes.email ?? '').trim().toLowerCase(),
        firstName: String(t.attributes.firstName ?? ''),
        lastName: String(t.attributes.lastName ?? ''),
      }))
      .filter((t) => t.email);
  }

  /** 全部团队成员 (内部测试组人数上限 100, limit=200 单页足够)。 */
  async listTeamUsers(): Promise<AppleTeamUser[]> {
    const r = await this.request<AppleListResponse>(
      'GET',
      `/v1/users?limit=200&fields[users]=username,firstName,lastName,roles,allAppsVisible`,
    );
    return (r.data ?? [])
      .map((u) => ({
        id: u.id,
        email: String(u.attributes.username ?? '').trim().toLowerCase(),
        firstName: String(u.attributes.firstName ?? ''),
        lastName: String(u.attributes.lastName ?? ''),
        roles: (u.attributes.roles as string[]) ?? [],
      }))
      .filter((u) => u.email);
  }

  /** 全部待接受团队用户邀请 (调用方按角色/可见 App 过滤出本系统发起的最小权限测试员)。 */
  async listPendingInvitations(): Promise<ApplePendingInvitation[]> {
    const r = await this.request<AppleListResponse>(
      'GET',
      `/v1/userInvitations?limit=200&fields[userInvitations]=email,firstName,lastName,roles,allAppsVisible,provisioningAllowed,expirationDate`,
    );
    return (r.data ?? [])
      .map((i) => ({
        id: i.id,
        email: String(i.attributes.email ?? '').trim().toLowerCase(),
        firstName: String(i.attributes.firstName ?? ''),
        lastName: String(i.attributes.lastName ?? ''),
        roles: (i.attributes.roles as string[]) ?? [],
        expirationDate: (i.attributes.expirationDate as string) ?? null,
      }))
      .filter((i) => i.email);
  }

  /** 已接受邀请、成为正式团队用户 */
  async findUser(email: string): Promise<AppleTesterState | null> {
    const r = await this.request<AppleListResponse>(
      'GET',
      `/v1/users?filter[username]=${encodeURIComponent(email)}&limit=1`,
    );
    const u = r.data?.[0];
    if (!u) return null;
    return {
      kind: 'user',
      id: u.id,
      email: String(u.attributes.username ?? email),
      roles: (u.attributes.roles as string[]) ?? [],
      expirationDate: null,
    };
  }

  /** 尚未接受的团队用户邀请 */
  async findInvitation(email: string): Promise<AppleTesterState | null> {
    const r = await this.request<AppleListResponse>(
      'GET',
      `/v1/userInvitations?filter[email]=${encodeURIComponent(email)}&limit=1`,
    );
    const inv = r.data?.[0];
    if (!inv) return null;
    return {
      kind: 'invitation',
      id: inv.id,
      email: String(inv.attributes.email ?? email),
      roles: (inv.attributes.roles as string[]) ?? [],
      expirationDate: (inv.attributes.expirationDate as string) ?? null,
    };
  }

  /**
   * 发起内部测试员邀请 (= 创建一个最小权限团队用户邀请)。
   * 固定 MARKETING + allAppsVisible=false + 仅可见本 App, 与人工实测通过的请求体一致。
   */
  async createInvitation(input: { email: string; firstName: string; lastName: string }): Promise<{ id: string; expirationDate: string | null }> {
    const r = await this.request<AppleSingleResponse>('POST', '/v1/userInvitations', {
      data: {
        type: 'userInvitations',
        attributes: {
          email: input.email,
          firstName: input.firstName,
          lastName: input.lastName,
          roles: [this.cfg.testerRole],
          allAppsVisible: false,
          provisioningAllowed: false,
        },
        relationships: {
          visibleApps: { data: [{ type: 'apps', id: this.cfg.appId }] },
        },
      },
    });
    return {
      id: r.data.id,
      expirationDate: (r.data.attributes.expirationDate as string) ?? null,
    };
  }

  /** 撤销一条待接受邀请 (重发前先撤销, 苹果没有单独的 resend 接口)。 */
  async deleteInvitation(appleInvitationId: string): Promise<void> {
    await this.request<null>('DELETE', `/v1/userInvitations/${appleInvitationId}`);
  }
}
