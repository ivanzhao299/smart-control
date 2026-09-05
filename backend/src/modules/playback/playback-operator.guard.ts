import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { assertCanUpload } from '../../common/auth/resource-policy';

/** User control endpoints only. Device endpoints have a separate scoped guard. */
@Injectable()
export class PlaybackOperatorGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const actor = requireActor(req);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) assertCanUpload(actor);
    return true;
  }
}
