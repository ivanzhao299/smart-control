import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { requireActor, requireAdmin } from '../auth/actor';

/** Apply only to configuration controllers, never ordinary device-control routes. */
@Injectable()
export class ConfigurationWriteGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    requireActor(req);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) requireAdmin(req);
    return true;
  }
}
