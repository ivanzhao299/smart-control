import { StatusGateway } from './status.gateway';
import { PlayerDeviceAuthService } from '../playback/player-device-auth.service';
import { createHash } from 'crypto';

describe('status socket identity and disclosure', () => {
  let gateway: StatusGateway;
  let enabled: boolean;
  let client: any;
  const deviceToken = 'synthetic-device-token-for-tests-only-0001';
  let devices: any[];
  beforeEach(() => {
    enabled = true;
    devices = [{ id: 'test-led', sha256: createHash('sha256').update(deviceToken).digest('hex'), slots: [1], enabled: true }];
    client = { OPEN: 1, readyState: 1, on: jest.fn(), send: jest.fn(), close: jest.fn() };
    gateway = new StatusGateway(
      { getOrThrow: () => ({ path: '/ws/status' }) } as any,
      {} as any,
      { list: () => [{ device: 'led', status: 'online', state: { url: 'private-file' } }] } as any,
      { listRunning: () => [] } as any,
      { info: jest.fn(), warn: jest.fn() } as any,
      { resolveActor: async (token: string) => enabled && token === 'valid' ? { kind: 'user', userId: 1, username: 'alice', role: 'operator' } : null } as any,
      { verifyToken: async (token: string) => enabled && token === 'admin' } as any,
      new PlayerDeviceAuthService({ get: () => JSON.stringify(devices) } as any),
    );
    gateway.server = { clients: new Set([client]) } as any;
  });
  afterEach(() => gateway.onModuleDestroy());
  it('sends content-free release notifications to authenticated devices and rejects revoked devices', async () => {
    await gateway.authenticatePlayer(client, { token: deviceToken, slot: 1 });
    client.send.mockClear();
    const release = { type: 'frontend_release', frontendBuildId: '11111111-1111-4111-8111-111111111111' };
    await (gateway as any).sendAuthorized(client, release);
    expect(JSON.parse(client.send.mock.calls[0][0])).toEqual(release);
    devices[0].enabled = false; client.send.mockClear();
    await (gateway as any).sendAuthorized(client, release);
    expect(client.send).not.toHaveBeenCalled();
  });
  it('authenticates a dedicated player without any personal login and sends no global snapshot', async () => {
    await gateway.authenticatePlayer(client, { token: deviceToken, slot: 1 });
    expect(client.close).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(client.send.mock.calls[0][0]).type).toBe('hello');
    expect(await gateway.handlePing(client, undefined)).toMatchObject({ type: 'pong' });
  });
  it('sends only content-free invalidations for the authenticated player slot', async () => {
    await gateway.authenticatePlayer(client, { token: deviceToken, slot: 1 });
    client.send.mockClear();
    for (const event of [
      { type: 'alarm', message: 'private' },
      { type: 'device_status', device: 'other', status: 'online' },
      { type: 'playback_channel_changed', slot: 2, at: 'now' },
      { type: 'playback_channel_changed', slot: 1, view: { url: 'private' }, at: 'now' },
    ]) await (gateway as any).sendAuthorized(client, event);
    expect(client.send.mock.calls.map((args: any[]) => JSON.parse(args[0]))).toEqual([
      { type: 'playback_channel_changed', slot: 1, at: 'now' },
    ]);
  });
  it.each([{}, { token: 'bad', slot: 1 }, { token: deviceToken, slot: 2 }, { token: deviceToken, slot: '1' }])(
    'rejects invalid or cross-slot device authentication: %j', async input => {
      await gateway.authenticatePlayer(client, input);
      expect(client.close).toHaveBeenCalledWith(4401, expect.any(String));
      expect(client.send).not.toHaveBeenCalled();
    },
  );
  it.each(['disable', 'rotate', 'rescope'])('rechecks device credentials before events: %s', async change => {
    await gateway.authenticatePlayer(client, { token: deviceToken, slot: 1 });
    client.send.mockClear();
    if (change === 'disable') devices[0].enabled = false;
    if (change === 'rotate') devices[0].sha256 = '0'.repeat(64);
    if (change === 'rescope') devices[0].slots = [2];
    await (gateway as any).sendAuthorized(client, { type: 'playback_channel_changed', slot: 1 });
    expect(client.send).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledWith(4401, expect.any(String));
  });
  it('does not allow a player connection to change into an administrator', async () => {
    await gateway.authenticatePlayer(client, { token: deviceToken, slot: 1 });
    client.send.mockClear();
    await gateway.authenticate(client, { token: 'admin', admin: true });
    expect(client.close).toHaveBeenCalledWith(4401, expect.any(String));
    expect(client.send).not.toHaveBeenCalled();
  });
  it('does not send a snapshot to anonymous connections', () => {
    gateway.handleConnection(client);
    (gateway as any).broadcast({ type: 'alarm', message: 'private-file' });
    expect(client.send).not.toHaveBeenCalled();
  });
  it('rejects malformed and invalid credentials', async () => {
    await gateway.authenticate(client, { token: 'invalid', admin: false });
    expect(client.close).toHaveBeenCalledWith(4401, expect.any(String));
    expect(client.send).not.toHaveBeenCalled();
  });
  it('authenticates before snapshot and strips arbitrary device state for users', async () => {
    await gateway.authenticate(client, { token: 'valid', admin: false });
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(client.send.mock.calls)).not.toContain('private-file');
  });
  it('rechecks revocation before sending events', async () => {
    await gateway.authenticate(client, { token: 'valid', admin: false });
    client.send.mockClear(); enabled = false;
    await (gateway as any).sendAuthorized(client, { type: 'playback_channel_changed', slot: 1 });
    expect(client.send).not.toHaveBeenCalled();
    expect(client.close).toHaveBeenCalledWith(4401, expect.any(String));
  });
  it('filters rich events but preserves playback invalidations for users', async () => {
    await gateway.authenticate(client, { token: 'valid', admin: false });
    client.send.mockClear();
    await (gateway as any).sendAuthorized(client, { type: 'alarm', message: 'private-file' });
    await (gateway as any).sendAuthorized(client, { type: 'playback_channel_changed', slot: 1, view: { url: 'private-file' }, at: 'now' });
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(client.send.mock.calls[0][0])).toEqual({ type: 'playback_channel_changed', slot: 1, at: 'now' });
  });
  it('retains full administrator events after verification', async () => {
    await gateway.authenticate(client, { token: 'admin', admin: true });
    client.send.mockClear();
    await (gateway as any).sendAuthorized(client, { type: 'alarm', message: 'details' });
    expect(client.send).toHaveBeenCalledWith(JSON.stringify({ type: 'alarm', message: 'details' }));
  });
  it('accepts an admin-flagged PERSONAL token via client auth after the shared-secret check fails', async () => {
    // 后台登录已收敛为个人账号 (loginAdministrator 用 client_auth_v1 签发, payload 带 uid)。
    // 前端管理端仍以 admin=true 连接, 旧共享令牌校验失败后必须回退到个人 token 解析,
    // 否则管理端 WS 永远 4401、收不到实时进度/状态推送。
    await gateway.authenticate(client, { token: 'valid', admin: true });
    expect(client.close).not.toHaveBeenCalled();
    expect(client.send).toHaveBeenCalledTimes(2); // hello + snapshot
    // 该个人 token 的真实角色是 operator, 不能因 admin=true 标记而提权:
    // 富文本 alarm 仍按 operator 白名单被过滤。
    client.send.mockClear();
    await (gateway as any).sendAuthorized(client, { type: 'alarm', message: 'details' });
    expect(client.send).not.toHaveBeenCalled();
  });
});
