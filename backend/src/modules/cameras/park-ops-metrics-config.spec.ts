import { normalizeParkOpsMetrics } from './park-ops-metrics-config';

const fixture = () => ({
  version: 1,
  source: '  园区月报  ',
  updatedAt: '2026-09-16T00:00:00+08:00',
  placeholderKeys: ['occupancy'],
  metrics: { occupancy: 95, visitors: null },
  content: { headline: '运营正常', notices: ['消防巡检完成'] },
});

describe('park operations metrics normalization', () => {
  it('normalizes the persisted document without changing business values', () => {
    expect(normalizeParkOpsMetrics(fixture())).toEqual({
      ...fixture(),
      source: '园区月报',
    });
  });

  it.each([
    [{ ...fixture(), version: 2 }, /version=1/],
    [{ ...fixture(), source: '' }, /数据来源/],
    [{ ...fixture(), updatedAt: 'invalid' }, /数据日期/],
    [{ ...fixture(), metrics: { occupancy: -1 } }, /非负数字/],
    [{ ...fixture(), content: { notices: [1] } }, /文字或文字列表/],
  ])('rejects malformed documents', (input, message) => {
    expect(() => normalizeParkOpsMetrics(input)).toThrow(message);
  });
});
