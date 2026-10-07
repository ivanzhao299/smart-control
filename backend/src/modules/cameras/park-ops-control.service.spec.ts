import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ParkOpsControlController } from './park-ops-control.controller';
import { GotoParkOpsPageDto, ToggleParkOpsAutoDto } from './dto/park-ops-control.dto';
import { ParkOpsControlService } from './park-ops-control.service';

describe('ParkOpsControlService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('starts from safe defaults and wraps page navigation', () => {
    const service = new ParkOpsControlService();
    expect(service.getState()).toMatchObject({
      page: 0,
      autoPlay: false,
      totalPages: 7,
      refreshRequested: false,
    });

    expect(service.prevPage().page).toBe(6);
    expect(service.nextPage().page).toBe(0);
    expect(service.gotoPage(4).page).toBe(4);
    expect(service.toggleAuto().autoPlay).toBe(true);
    expect(service.toggleAuto(false).autoPlay).toBe(false);
  });

  it('returns a refresh request once when the dashboard consumes it', () => {
    const service = new ParkOpsControlService();
    service.requestRefresh();

    expect(service.getState(true).refreshRequested).toBe(true);
    expect(service.getState(true).refreshRequested).toBe(false);
  });

  it('expires an unconsumed refresh request after ten seconds', () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const service = new ParkOpsControlService();
    service.requestRefresh();

    now += 10_001;
    expect(service.getState()).toMatchObject({
      refreshRequested: false,
      refreshTimestamp: 1_000,
      timestamp: 11_001,
    });
  });

  it('keeps only the display poll public and protects every mutation', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, ParkOpsControlController.prototype.getState)).toBe(
      true,
    );
    for (const action of ['nextPage', 'prevPage', 'gotoPage', 'toggleAuto', 'requestRefresh']) {
      expect(
        Reflect.getMetadata(
          IS_PUBLIC_KEY,
          ParkOpsControlController.prototype[action as keyof ParkOpsControlController],
        ),
      ).not.toBe(true);
    }
  });

  it('rejects out-of-range pages and non-boolean autoplay input', async () => {
    const invalidPage = plainToInstance(GotoParkOpsPageDto, { page: 7 });
    const invalidAuto = plainToInstance(ToggleParkOpsAutoDto, { enabled: 'false' });

    await expect(validate(invalidPage)).resolves.not.toHaveLength(0);
    await expect(validate(invalidAuto)).resolves.not.toHaveLength(0);
    await expect(validate(plainToInstance(GotoParkOpsPageDto, { page: 6 }))).resolves.toHaveLength(
      0,
    );
  });
});
