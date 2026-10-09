import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ParkOpsControlController } from './park-ops-control.controller';
import {
  ClaimParkOpsControlDto,
  GotoParkOpsPageDto,
  ToggleParkOpsAutoDto,
} from './dto/park-ops-control.dto';
import { ParkOpsControlService } from './park-ops-control.service';

describe('ParkOpsControlService', () => {
  afterEach(() => jest.restoreAllMocks());

  it('starts from safe defaults: home page, no autoplay, not claimed', () => {
    const service = new ParkOpsControlService();
    expect(service.getState()).toMatchObject({
      page: 0,
      autoPlay: false,
      totalPages: 6,
      refreshRequested: false,
      claimed: false,
      claim: null,
    });
  });

  it('ignores navigation/autoplay mutations while nobody has claimed control', () => {
    const service = new ParkOpsControlService();
    expect(service.nextPage()).toMatchObject({ page: 0, claimed: false });
    expect(service.prevPage()).toMatchObject({ page: 0, claimed: false });
    expect(service.gotoPage(3)).toMatchObject({ page: 0, claimed: false });
    expect(service.toggleAuto(true)).toMatchObject({ autoPlay: false, claimed: false });
  });

  it('lets the claim owner navigate and control autoplay, renewing the claim', () => {
    const service = new ParkOpsControlService();
    const claimed = service.claimControl('owner-1', '操作员A');
    expect(claimed).toMatchObject({ claimed: true });
    expect(claimed.claim).toMatchObject({ ownerId: 'owner-1', ownerName: '操作员A' });

    expect(service.nextPage('owner-1').page).toBe(1);
    expect(service.prevPage('owner-1').page).toBe(0);
    expect(service.gotoPage(4, 'owner-1').page).toBe(4);
    expect(service.toggleAuto(true, 'owner-1').autoPlay).toBe(true);
  });

  it('rejects navigation from a non-owner even while another client holds the claim', () => {
    const service = new ParkOpsControlService();
    service.claimControl('owner-1', '操作员A');
    service.gotoPage(2, 'owner-1');

    expect(service.nextPage('owner-2')).toMatchObject({ page: 2 });
    expect(service.toggleAuto(false, 'owner-2')).toMatchObject({ autoPlay: false });
  });

  it('releases control and stops autoplay when the owner releases', () => {
    const service = new ParkOpsControlService();
    service.claimControl('owner-1', '操作员A');
    service.toggleAuto(true, 'owner-1');

    const released = service.releaseControl('owner-1');
    expect(released).toMatchObject({ claimed: false, autoPlay: false, claim: null });
  });

  it('auto-returns control to the site and stops autoplay after the 90s TTL', () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const service = new ParkOpsControlService();
    service.claimControl('owner-1', '操作员A');
    service.toggleAuto(true, 'owner-1');

    now += 90_001;
    expect(service.getState()).toMatchObject({ claimed: false, autoPlay: false, claim: null });
  });

  it('renews the TTL on each owner action so active use is not interrupted', () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const service = new ParkOpsControlService();
    service.claimControl('owner-1');

    now += 80_000;
    service.nextPage('owner-1'); // renews at t=81000
    now += 80_000; // t=161000, only 80s since the last action
    expect(service.getState()).toMatchObject({ claimed: true });
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
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, ParkOpsControlController.prototype.getState),
    ).toBe(true);
    for (const action of [
      'claim',
      'release',
      'nextPage',
      'prevPage',
      'gotoPage',
      'toggleAuto',
      'requestRefresh',
    ]) {
      expect(
        Reflect.getMetadata(
          IS_PUBLIC_KEY,
          ParkOpsControlController.prototype[action as keyof ParkOpsControlController],
        ),
      ).not.toBe(true);
    }
  });

  it('rejects out-of-range pages, a missing claim owner, and non-boolean autoplay', async () => {
    const invalidPage = plainToInstance(GotoParkOpsPageDto, { page: 6 });
    const missingOwner = plainToInstance(ClaimParkOpsControlDto, { ownerName: 'x' });
    const invalidAuto = plainToInstance(ToggleParkOpsAutoDto, { enabled: 'false' });

    await expect(validate(invalidPage)).resolves.not.toHaveLength(0);
    await expect(validate(missingOwner)).resolves.not.toHaveLength(0);
    await expect(validate(invalidAuto)).resolves.not.toHaveLength(0);
    await expect(
      validate(plainToInstance(GotoParkOpsPageDto, { page: 5 })),
    ).resolves.toHaveLength(0);
    await expect(
      validate(plainToInstance(ClaimParkOpsControlDto, { ownerId: 'o1', ownerName: 'A' })),
    ).resolves.toHaveLength(0);
  });
});
