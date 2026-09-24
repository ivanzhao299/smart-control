import { AppleAppStoreClient } from './apple-app-store.client';

describe('AppleAppStoreClient TestFlight invitation contract', () => {
  it('resends the phone installation invitation through betaTesterInvitations', async () => {
    const config = {
      getOrThrow: jest.fn(() => ({ appId: '6795375392' })),
    };
    const client = new AppleAppStoreClient(config as never);
    const request = jest
      .spyOn(client as unknown as { request: (...args: unknown[]) => Promise<unknown> }, 'request')
      .mockResolvedValue({ data: { id: 'invitation-1' } });

    await expect(client.sendBetaTesterInvitation('beta-tester-1')).resolves.toEqual({ id: 'invitation-1' });
    expect(request).toHaveBeenCalledWith('POST', '/v1/betaTesterInvitations', {
      data: {
        type: 'betaTesterInvitations',
        relationships: {
          app: { data: { type: 'apps', id: '6795375392' } },
          betaTester: { data: { type: 'betaTesters', id: 'beta-tester-1' } },
        },
      },
    });
  });
});
