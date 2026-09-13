import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PlayerDeviceAuthService } from './player-device-auth.service';

@Injectable()
export class PlayerDeviceGuard implements CanActivate {
  constructor(private readonly devices: PlayerDeviceAuthService) {}
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    delete req.playerDevice;
    req.playerDevice = this.devices.authenticate(req.headers['x-player-token'], Number(req.params.slot));
    return true;
  }
}
