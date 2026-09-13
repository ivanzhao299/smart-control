import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { PlayerDeviceAuthService } from './player-device-auth.service';
import { PlayerDeviceGuard } from './player-device.guard';

describe('dedicated player credentials', () => {
  const token = 'test-only-player-token-longer-than-32-bytes';
  const entry = { id: 'bgm', slots: [3], enabled: true, sha256: createHash('sha256').update(token).digest('hex') };
  let config: ConfigService, auth: PlayerDeviceAuthService;
  const originalConfig = process.env.PLAYER_DEVICE_CREDENTIALS;
  beforeEach(() => {
    delete process.env.PLAYER_DEVICE_CREDENTIALS;
    config = new ConfigService({ PLAYER_DEVICE_CREDENTIALS: JSON.stringify([entry]) });
    auth = new PlayerDeviceAuthService(config);
  });
  afterEach(() => {
    if (originalConfig === undefined) delete process.env.PLAYER_DEVICE_CREDENTIALS;
    else process.env.PLAYER_DEVICE_CREDENTIALS = originalConfig;
  });
  it('accepts only the configured channel and returns no user authority', () => {
    expect(auth.authenticate(token, 3)).toEqual({ id: 'bgm', slots: [3] });
    expect(() => auth.authenticate(token, 1)).toThrow('设备无权访问此通道');
    expect(() => auth.authenticate(token, 4)).toThrow();
    expect(() => auth.authenticate('forged-token-longer-than-thirty-two-bytes', 3)).toThrow();
  });
  it('rejects missing/duplicate headers, disabled credentials and invalid config', () => {
    for (const header of [undefined, '', [token, token], 'short']) expect(() => auth.authenticate(header, 3)).toThrow();
    for (const value of ['invalid json', '{}', JSON.stringify([{ ...entry, enabled: false }]), JSON.stringify([{ ...entry, slots: [0, 3] }])]) {
      config.set('PLAYER_DEVICE_CREDENTIALS', value);
      expect(() => auth.authenticate(token, 3)).toThrow();
    }
  });
  it('rechecks configuration on each request and attaches a separate device identity', () => {
    const req = { params: { slot: '3' }, headers: { 'x-player-token': token } };
    const ctx = { switchToHttp: () => ({ getRequest: () => req }) } as any;
    expect(new PlayerDeviceGuard(auth).canActivate(ctx)).toBe(true);
    expect(req).toHaveProperty('playerDevice.id', 'bgm');
    expect(req).not.toHaveProperty('actor');
    config.set('PLAYER_DEVICE_CREDENTIALS', '[]');
    expect(() => new PlayerDeviceGuard(auth).canActivate(ctx)).toThrow();
  });
});
