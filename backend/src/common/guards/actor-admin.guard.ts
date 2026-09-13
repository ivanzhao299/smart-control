import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { requireAdmin } from '../auth/actor';

@Injectable()
export class ActorAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    requireAdmin(context.switchToHttp().getRequest());
    return true;
  }
}
