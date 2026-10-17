import {
  canWritePowerDomain,
  readablePowerDomains,
  POWER_DOMAIN,
} from './rbac';

/**
 * 第五轮「电源域划分」角色 × 域授权矩阵（2026-10-17）。
 * admin 全域；hardware 全域后台排障；config 仅园区；operator 仅展厅；viewer 只读展厅。
 * 新域默认只归 admin（矩阵写在代码里，后台无法误授权）。
 */
describe('power domain RBAC matrix (role × domain)', () => {
  describe('canWritePowerDomain (single-circuit on/off)', () => {
    it('admin writes every domain including future ones', () => {
      expect(canWritePowerDomain('admin', POWER_DOMAIN.HALL)).toBe(true);
      expect(canWritePowerDomain('admin', POWER_DOMAIN.PARK)).toBe(true);
      expect(canWritePowerDomain('admin', 'future-building')).toBe(true);
    });

    it('hardware (device engineer) writes all domains including future ones (full-domain troubleshooting)', () => {
      expect(canWritePowerDomain('hardware', POWER_DOMAIN.HALL)).toBe(true);
      expect(canWritePowerDomain('hardware', POWER_DOMAIN.PARK)).toBe(true);
      expect(canWritePowerDomain('hardware', 'future-building')).toBe(true);
    });

    it('config (operations) only writes park — hall LED master is reclaimed', () => {
      expect(canWritePowerDomain('config', POWER_DOMAIN.PARK)).toBe(true);
      expect(canWritePowerDomain('config', POWER_DOMAIN.HALL)).toBe(false);
      expect(canWritePowerDomain('config', 'future-building')).toBe(false);
    });

    it('operator only writes hall — park circuits are invisible/immovable', () => {
      expect(canWritePowerDomain('operator', POWER_DOMAIN.HALL)).toBe(true);
      expect(canWritePowerDomain('operator', POWER_DOMAIN.PARK)).toBe(false);
      expect(canWritePowerDomain('operator', 'future-building')).toBe(false);
    });

    it('viewer never writes any domain', () => {
      expect(canWritePowerDomain('viewer', POWER_DOMAIN.HALL)).toBe(false);
      expect(canWritePowerDomain('viewer', POWER_DOMAIN.PARK)).toBe(false);
    });

    it('denies when role or domain code is missing', () => {
      expect(canWritePowerDomain(undefined, POWER_DOMAIN.HALL)).toBe(false);
      expect(canWritePowerDomain('admin', undefined)).toBe(false);
    });
  });

  describe('readablePowerDomains (list/detail data scope)', () => {
    it('admin and hardware see all domains (null = unrestricted)', () => {
      expect(readablePowerDomains('admin')).toBeNull();
      expect(readablePowerDomains('hardware')).toBeNull();
    });

    it('config sees only park', () => {
      expect(readablePowerDomains('config')).toEqual([POWER_DOMAIN.PARK]);
    });

    it('operator and viewer see only hall', () => {
      expect(readablePowerDomains('operator')).toEqual([POWER_DOMAIN.HALL]);
      expect(readablePowerDomains('viewer')).toEqual([POWER_DOMAIN.HALL]);
    });

    it('future domain is hidden from every non-admin role until explicitly granted', () => {
      for (const role of ['config', 'operator', 'viewer'] as const) {
        const scope = readablePowerDomains(role)!;
        expect(scope).not.toContain('future-building');
      }
    });
  });
});
