import { StatusGateway } from './status.gateway';

describe('status socket identity and disclosure', () => {
  let gateway: StatusGateway;
  let enabled: boolean;
  let client: any;
  beforeEach(() => {
    enabled = true;
    client = { OPEN: 1, readyState: 1, on: jest.fn(), send: jest.fn(), close: jest.fn() };
    gateway = new StatusGateway(
      { getOrThrow: () => ({ path: '/ws/status' }) } as any,
      {} as any,
      { list: () => [{ device: 'led', status: 'online', state: { url: 'private-file' } }] } as any,
      { listRunning: () => [] } as any,
      { info: jest.fn(), warn: jest.fn() } as any,
      { resolveActor: async (token: string) => enabled && token === 'valid' ? { kind: 'user', userId: 1, username: 'alice', role: 'operator' } : null } as any,
      { verifyToken: async (token: string) => enabled && token === 'admin' } as any,
    );
    gateway.server = { clients: new Set([client]) } as any;
  });
  afterEach(() => gateway.onModuleDestroy());
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
});
