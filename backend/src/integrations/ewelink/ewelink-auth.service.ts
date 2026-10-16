import {
  BadRequestException,
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { CronJob } from 'cron';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { EwelinkAuth } from '../../entities/ewelink-auth.entity';
import {
  apiHostForRegion,
  makeApiSign,
  makeAuthorizationSign,
  makeNonce,
  oauthHostForRegion,
} from './ewelink-crypto';

const MARGIN_MS = 5 * 60 * 1000;

export interface EwelinkStatus {
  configured: boolean;
  authorized: boolean;
  region: string | null;
  currentFamilyId: string | null;
  atExpiresAt: string | null;
}

/**
 * eWeLink OAuth2.0 授权服务：配置 AppID/Secret、构造授权页、回调换 token、刷新。
 */
@Injectable()
export class EwelinkAuthService implements OnApplicationBootstrap, OnModuleDestroy {
  /** 长效机制：每天固定时刻强制刷新一次（让 at/rt 持续滚动，rt 60 天窗口永不触顶） */
  private refreshJob: CronJob | null = null;

  constructor(
    @InjectRepository(EwelinkAuth) private readonly repo: Repository<EwelinkAuth>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  onApplicationBootstrap(): void {
    // 每天 03:37（Asia/Shanghai，避开整点）；仅已授权时才真正刷新
    this.refreshJob = new CronJob(
      '37 3 * * *',
      () => {
        void this.scheduledRefresh();
      },
      null,
      false,
      'Asia/Shanghai',
    );
    this.refreshJob.start();
    this.logger.info('[eWeLink] token 定时刷新已启用（每天 03:37）', {
      context: 'EwelinkAuthService',
    });
  }

  onModuleDestroy(): void {
    if (this.refreshJob) {
      try {
        this.refreshJob.stop();
      } catch {
        // ignore
      }
      this.refreshJob = null;
    }
  }

  /** 定时任务：未授权/未配置时跳过（不报错），已授权则强制刷新续期 */
  private async scheduledRefresh(): Promise<void> {
    try {
      const r = await this.row();
      if (!r.accessToken || !r.refreshToken) return;
      await this.getCredentials();
      await this.refresh(r);
      this.logger.info('[eWeLink] 定时刷新成功（token 续期）', {
        context: 'EwelinkAuthService',
      });
    } catch (err) {
      // 单次失败不致命：rt 60 天窗口内还有大量重试机会，次日会再试
      this.logger.warn(`[eWeLink] 定时刷新失败: ${(err as Error).message}`, {
        context: 'EwelinkAuthService',
      });
    }
  }

  private async row(): Promise<EwelinkAuth> {
    let r = await this.repo.findOne({ where: { id: 1 } });
    if (!r) {
      r = await this.repo.save(
        this.repo.create({ id: 1, appId: null, appSecret: null }),
      );
    }
    return r;
  }

  /** 站点对外根地址（拼回调 URL，可被 PUBLIC_BASE_URL 覆盖） */
  private get publicBase(): string {
    return (process.env.PUBLIC_BASE_URL ?? 'https://erp.cnjinhu.com').replace(/\/+$/, '');
  }

  /** 应用里登记的回调地址，必须与授权请求 redirectUrl 完全一致 */
  get redirectUrl(): string {
    return `${this.publicBase}/api/integrations/ewelink/callback`;
  }

  /**
   * 取 AppID / AppSecret：环境变量 EWELINK_APP_ID / EWELINK_APP_SECRET 优先
   * （与华普云凭据同一配置方式、不入库不回显），未设则回落配置页保存到库的值。
   */
  async getCredentials(): Promise<{ appId: string; appSecret: string }> {
    const r = await this.row();
    const appId = (process.env.EWELINK_APP_ID ?? '').trim() || r.appId;
    const appSecret = (process.env.EWELINK_APP_SECRET ?? '').trim() || r.appSecret;
    if (!appId || !appSecret) {
      throw new BadRequestException('易微联 AppID / AppSecret 未配置（环境变量或配置页）');
    }
    return { appId: appId as string, appSecret: appSecret as string };
  }

  /** 凭据是否就绪：环境变量优先，未设则看库表（与 getCredentials 同一口径） */
  private hasCredentials(r: EwelinkAuth): boolean {
    const appId = (process.env.EWELINK_APP_ID ?? '').trim() || r.appId;
    const appSecret = (process.env.EWELINK_APP_SECRET ?? '').trim() || r.appSecret;
    return !!(appId && appSecret);
  }

  async status(): Promise<EwelinkStatus> {
    const r = await this.row();
    return {
      configured: this.hasCredentials(r),
      authorized: !!r.accessToken,
      region: r.region,
      currentFamilyId: r.currentFamilyId,
      atExpiresAt: r.atExpiresAt,
    };
  }

  async saveConfig(appId: string, appSecret: string): Promise<void> {
    const r = await this.row();
    r.appId = appId.trim();
    r.appSecret = appSecret.trim();
    // 换应用，旧 token 作废
    r.accessToken = null;
    r.refreshToken = null;
    r.atExpiresAt = r.rtExpiresAt = null;
    r.region = r.currentFamilyId = null;
    await this.repo.save(r);
    this.logger.info('[eWeLink] AppID/Secret 已保存，待授权', { context: 'EwelinkAuthService' });
  }

  /** 构造授权页 URL（业主在浏览器打开、登录并同意） */
  async buildAuthorizeUrl(state?: string): Promise<string> {
    const r = await this.row();
    const { appId, appSecret } = await this.getCredentials();
    const seq = String(Date.now());
    const authorization = makeAuthorizationSign(appSecret, appId, seq);
    const params = new URLSearchParams({
      clientId: appId,
      seq,
      authorization,
      redirectUrl: this.redirectUrl,
      grantType: 'authorization_code',
      state: state ?? 'ewelink-bind',
      nonce: makeNonce(8),
      showQRCode: 'false',
    });
    return `${oauthHostForRegion(r.region)}/oauth/index.html?${params.toString()}`;
  }

  /** 授权回调：code + region → 换 access/refresh token 落库（code 仅 30 秒有效） */
  async handleCallback(code: string, region: string): Promise<EwelinkStatus> {
    const r = await this.row();
    const { appId, appSecret } = await this.getCredentials();
    const body = {
      code,
      redirectUrl: this.redirectUrl,
      grantType: 'authorization_code',
    };
    const json = await this.signedPost(
      apiHostForRegion(region),
      '/v2/user/oauth/token',
      body,
      appId,
      appSecret,
    );
    if (json.error !== 0 || !json.data?.accessToken) {
      throw new BadRequestException(`易微联授权失败: ${json.msg ?? json.error}`);
    }
    r.region = region;
    r.accessToken = String(json.data.accessToken);
    r.refreshToken = String(json.data.refreshToken);
    r.atExpiresAt = String(json.data.atExpiredTime);
    r.rtExpiresAt = String(json.data.rtExpiredTime);
    await this.repo.save(r);
    this.logger.info('[eWeLink] 授权成功，token 已落库', { context: 'EwelinkAuthService' });
    return this.status();
  }

  /** 取有效 accessToken，过期自动 refresh */
  async ensureAccessToken(): Promise<{ token: string; region: string; familyId: string | null }> {
    const r = await this.row();
    // 凭据口径与 getCredentials 一致（环境变量优先），不能只看库表
    if (!this.hasCredentials(r)) {
      throw new BadRequestException('易微联 AppID / AppSecret 未配置（环境变量或配置页）');
    }
    if (!r.accessToken || !r.refreshToken) {
      throw new BadRequestException('易微联尚未授权 — 先完成一次账号授权');
    }
    const now = Date.now();
    if (r.atExpiresAt && Number(r.atExpiresAt) - now > MARGIN_MS) {
      return { token: r.accessToken, region: r.region ?? 'cn', familyId: r.currentFamilyId };
    }
    return this.refresh(r);
  }

  private async refresh(r: EwelinkAuth): Promise<{ token: string; region: string; familyId: string | null }> {
    const host = apiHostForRegion(r.region);
    const resp = await fetch(`${host}/v2/user/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${r.accessToken as string}`,
      },
      body: JSON.stringify({ rt: r.refreshToken }),
      signal: AbortSignal.timeout(12_000),
    });
    const json = (await resp.json()) as {
      error: number;
      msg?: string;
      data?: { at?: string; rt?: string };
    };
    if (json.error !== 0 || !json.data?.at) {
      throw new BadRequestException(`易微联 token 续期失败（${json.msg ?? json.error}），请重新授权`);
    }
    r.accessToken = String(json.data.at);
    if (json.data.rt) r.refreshToken = String(json.data.rt);
    // 文档口径：access 30 天、refresh 60 天
    r.atExpiresAt = String(Date.now() + 30 * 24 * 3600 * 1000);
    r.rtExpiresAt = String(Date.now() + 60 * 24 * 3600 * 1000);
    await this.repo.save(r);
    return { token: r.accessToken, region: r.region ?? 'cn', familyId: r.currentFamilyId };
  }

  async setCurrentFamilyId(familyId: string): Promise<void> {
    const r = await this.row();
    r.currentFamilyId = familyId;
    await this.repo.save(r);
  }

  async unbind(): Promise<void> {
    const r = await this.row();
    r.accessToken = null;
    r.refreshToken = null;
    r.atExpiresAt = r.rtExpiresAt = null;
    r.currentFamilyId = null;
    await this.repo.save(r);
  }

  /** 带 Sign 头的 POST（token 交换等未登录接口） */
  private async signedPost(
    host: string,
    path: string,
    body: Record<string, unknown>,
    appId: string,
    appSecret: string,
  ): Promise<{ error: number; msg?: string; data?: any }> {
    const bodyJson = JSON.stringify(body);
    const resp = await fetch(`${host}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CK-Appid': appId,
        'X-CK-Nonce': makeNonce(8),
        Authorization: `Sign ${makeApiSign(appSecret, bodyJson)}`,
      },
      body: bodyJson,
      signal: AbortSignal.timeout(12_000),
    });
    return (await resp.json()) as any;
  }
}
