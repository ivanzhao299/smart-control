import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import type { AuthenticatedRequest } from '../../common/auth/actor';
import { PARK_OPS_LOCAL_OWNER_ID } from './park-ops-control.service';

/**
 * 运营大屏控制接口的条件鉴权。
 *
 * 背景：2026-07-21 加了全局鉴权门（GlobalAuthGuard），除 @Public 外每个请求都要带 token。
 * 但无人值守的现场大屏没有登录态，其现场主控登记(claim)与现场开/关闸本应匿名可用——
 * 授权由 ParkOpsControlService 的接管锁(gateAuthorization)承担。只给 state 标 @Public
 * 会导致 claim/gate-open/gate-close 全部 401，现场大屏按钮失效（生产 state.claimed 恒 false）。
 *
 * 本 guard 用于配合 @Public 使用（让 GlobalAuthGuard 放行后再做条件判定）：
 *  - 已登录身份（业主 PWA 的 X-Client-Token 或后台 Bearer）：放行，用于远程接管 / 远程开闸。
 *  - 匿名请求：仅允许以“现场运营大屏”固定标识 ownerId=park-ops-screen 调用（现场主控）。
 *  - 匿名请求不得冒充任何其它接管者 ownerId（远程接管必须先登录）。
 *  - 携带了凭据但凭据无效：仍 401，不允许借匿名通道提权（与全局门口径一致）。
 *
 * 真正“能不能开闸”由 gateAuthorization 二次判定：现场大屏只在未被远程接管时放行，
 * 接管期仅接管者可开。因此匿名通道无法在被接管时开闸，也无法匿名冒充接管者。
 */
@Injectable()
export class ParkOpsGuard implements CanActivate {
  constructor(
    private readonly clientAuth: ClientAuthService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    delete req.actor;

    const xClient = req.headers['x-client-token'];
    const clientTok = typeof xClient === 'string' ? xClient.trim() : '';
    const auth = req.headers['authorization'];
    const bearer =
      typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

    // 后台 Bearer：与全局门一致（后台身份可用于调试/审计，不参与接管锁身份）
    if (bearer && (await this.adminAuth.verifyToken(bearer))) {
      req.actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
      return true;
    }

    // 业主 PWA token（或 Bearer 形式的业主 token）
    for (const token of [bearer, clientTok]) {
      if (!token) continue;
      const actor = await this.clientAuth.resolveActor(token);
      if (actor) {
        req.actor = actor;
        return true;
      }
    }

    // 显式携带了无效凭据：仍 401，防止无效凭据借匿名通道提权
    if (clientTok || bearer) {
      throw new UnauthorizedException('未登录或登录已过期, 请重新登录');
    }

    // 匿名：仅允许现场大屏固定标识
    const body = (req.body ?? {}) as { ownerId?: unknown };
    const ownerId = typeof body.ownerId === 'string' ? body.ownerId.trim() : '';
    if (ownerId === PARK_OPS_LOCAL_OWNER_ID) return true;

    throw new UnauthorizedException('未登录或登录已过期, 请重新登录');
  }
}
