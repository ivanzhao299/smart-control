import { normalizeParkOpsConfig } from './park-ops-config';

const valid = () => ({
  version: 1,
  fitMode: 'stretch',
  phases: [{ id: '1', name: '一期', zoneName: '智造区', color: '#63d9ff', fontSize: 15, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] }],
  buildings: [{ id: 'b1', phase: '1', number: '01#', company: '示范企业', x: 10, y: 20, fontSize: 12, color: '#ffffff' }],
  textOverrides: { title: { text: '园区大屏', fontSize: 54, color: '#ffffff' } },
});

describe('park ops shared config validation', () => {
  it('accepts a bounded calibration document', () => {
    expect(normalizeParkOpsConfig(valid())).toMatchObject({ version: 1, fitMode: 'stretch' });
  });

  it('rejects invalid phase coordinates and unknown building phases', () => {
    const badPoint = valid();
    badPoint.phases[0].points[0].x = 1001;
    expect(() => normalizeParkOpsConfig(badPoint)).toThrow(/0–1000/);

    const badPhase = valid();
    badPhase.buildings[0].phase = 'missing';
    expect(() => normalizeParkOpsConfig(badPhase)).toThrow(/不存在的分区/);
  });

  it('rejects unsafe style values and oversized text', () => {
    const badColor = valid();
    badColor.buildings[0].color = 'red;display:none';
    expect(() => normalizeParkOpsConfig(badColor)).toThrow(/#RRGGBB/);

    const badText = valid();
    badText.textOverrides.title.text = 'x'.repeat(201);
    expect(() => normalizeParkOpsConfig(badText)).toThrow(/200/);
  });
});
