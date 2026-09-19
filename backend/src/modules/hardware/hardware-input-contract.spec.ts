import { ValidationPipe } from '@nestjs/common';
import { CreateHardwareDto, QueryHardwareDto, UpdateHardwareDto } from './dto/hardware.dto';

const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
const run = (value: unknown, metatype: new () => unknown) =>
  pipe.transform(value, { type: 'body', metatype });

describe('hardware input contract', () => {
  it('accepts network and serial addressing forms', async () => {
    await expect(run({ code: 'GW-1', name: 'gateway', category: 'hvac-gateway', vendor: 'v', model: 'm', ip: '127.0.0.1', addressing: '{"port":502}' }, CreateHardwareDto)).resolves.toBeDefined();
    await expect(run({ code: 'SEQ-1', name: 'sequencer', category: 'power-seq55', vendor: 'v', model: 'm', ip: 'COM2', addressing: '{"baud":9600}' }, CreateHardwareDto)).resolves.toBeDefined();
  });

  it.each([
    { category: 'unknown' },
    { status: 'online' },
    { addressing: '{broken' },
    { channels: '[broken' },
    { serialNo: 'x'.repeat(129) },
    { location: 'x'.repeat(129) },
    { id: 1 },
    { configRevision: 2 },
  ])('rejects invalid or server-owned fields', async (value) => {
    await expect(run(value, UpdateHardwareDto)).rejects.toThrow();
  });

  it('requires a revision for patches and validates query enums', async () => {
    await expect(run({}, UpdateHardwareDto)).rejects.toThrow();
    await expect(run({ expectedRevision: 1 }, UpdateHardwareDto)).resolves.toBeDefined();
    await expect(run({ category: 'audio-dsp', status: 'offline' }, QueryHardwareDto)).resolves.toBeDefined();
    await expect(run({ category: 'unknown' }, QueryHardwareDto)).rejects.toThrow();
  });
});
