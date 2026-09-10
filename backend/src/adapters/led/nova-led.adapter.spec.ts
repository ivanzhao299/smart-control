import { ConfigService } from '@nestjs/config';
import { NovaLedAdapter } from './nova-led.adapter';
import { frameSetLayer, VX_CARD_SLOT, VX_SOURCE } from './nova-vx1000-protocol';

const asResponse = (request: Buffer): Buffer =>
  Buffer.concat([Buffer.from([0xaa, 0x55]), request.subarray(2)]);

describe('Nova V2460 variable-length response timing', () => {
  it('finishes a layer switch after a short quiet window instead of waiting for 64 bytes', async () => {
    const config = {
      getOrThrow: jest.fn(() => ({ mock: false, mockLatencyMs: 0 })),
    } as unknown as ConfigService;
    const logger = { info: jest.fn(), warn: jest.fn() } as never;
    const registry = { register: jest.fn(), markOnline: jest.fn(), markFailure: jest.fn() } as never;
    const adapter = new NovaLedAdapter(config, logger, registry);
    const sendAndReadAll = jest.fn(async (request: Buffer) => asResponse(request));
    const sendAndExpect = jest.fn();
    (adapter as unknown as { tcp: { sendAndReadAll: typeof sendAndReadAll; sendAndExpect: typeof sendAndExpect } }).tcp = {
      sendAndReadAll,
      sendAndExpect,
    };

    await expect(adapter.switchInput('LED-NOVA-1', { input: 'video' })).resolves.toMatchObject({ ok: true });
    expect(sendAndReadAll).toHaveBeenCalledWith(
      frameSetLayer({
        layerNo: 1,
        source: VX_SOURCE.HDMI20,
        cardSlot: VX_CARD_SLOT.HDMI20,
        width: 3612,
        height: 1462,
        startX: 0,
        startY: 0,
        priority: 0,
        opacity: 0x64,
        switchOn: true,
      }),
      120,
      3000,
      undefined,
    );
    expect(sendAndExpect).not.toHaveBeenCalled();
  });
});
