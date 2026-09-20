import { summarizeBuild } from './testflight.service';
import type { AppleLatestBuild } from './apple-app-store.client';

const base: AppleLatestBuild = {
  id: 'b1',
  version: '1.0.0',
  build: '40',
  processingState: 'VALID',
  uploadedDate: '2026-09-09T22:37:19-07:00',
  expired: false,
  expirationDate: '2026-12-08T21:37:19-08:00',
};

describe('summarizeBuild (TestFlight 90 天到期倒计时)', () => {
  it('对有效构建计算剩余天数', () => {
    const now = new Date('2026-12-01T00:00:00-08:00').getTime();
    const s = summarizeBuild({ ...base }, now)!;
    expect(s.state).toBe('VALID');
    expect(s.daysRemaining).toBe(8); // 12-01 00:00 → 12-08 21:37，向上取整 8 天
  });

  it('ASC 标记 expired 或到期时间已过 → EXPIRED 且天数为负', () => {
    const now = new Date('2026-12-20T00:00:00-08:00').getTime();
    const s = summarizeBuild({ ...base, expired: true }, now)!;
    expect(s.state).toBe('EXPIRED');
    expect(s.daysRemaining).toBeLessThan(0);
  });

  it('处理中的构建 → PROCESSING', () => {
    const now = Date.now();
    const s = summarizeBuild({ ...base, processingState: 'PROCESSING' }, now)!;
    expect(s.state).toBe('PROCESSING');
  });

  it('缺少 expirationDate 时 daysRemaining 为 null', () => {
    const s = summarizeBuild({ ...base, expirationDate: null }, Date.now())!;
    expect(s.daysRemaining).toBeNull();
    expect(s.state).toBe('VALID');
  });

  it('入参为 null 返回 null', () => {
    expect(summarizeBuild(null)).toBeNull();
  });
});
