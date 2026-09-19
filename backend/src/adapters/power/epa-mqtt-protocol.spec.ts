import {
  childToMeasurements,
  controlMessage,
  parseMessage,
  readOneMessage,
  switchState,
} from './epa-mqtt-protocol';

describe('ePa MQTT protocol', () => {
  it('builds the documented control and single-device read messages', () => {
    expect(controlMessage('EP001', 1, 'MID-1')).toEqual({
      bid: 202,
      mid: 'MID-1',
      Children: [{ ClientID: 'EP001', MoterOperation: 1 }],
    });
    expect(readOneMessage('EP001', 'MID-2')).toEqual({
      bid: 208,
      mid: 'MID-2',
      Children: [{ ClientID: 'EP001' }],
    });
  });

  it('converts cloud raw units and status/alarm bits to the common measurement model', () => {
    const m = childToMeasurements({
      ClientID: 'EP001',
      Voltage: [220000, 221000, 219000, 0],
      Current: [1200, 1300, 1100, 3],
      Power: [250, 260, 240, 750],
      Energy: [1000, 2000, 3000, 6000],
      Temperature: [2512, 2600, 2499, 2400],
      ElectricStatus: 1 << 11,
      SwitchStatus: 1,
      Mode: 0,
    });
    expect(m.voltages).toEqual([220, 221, 219]);
    expect(m.currents).toEqual([1.2, 1.3, 1.1]);
    expect(m.leakageCurrent).toBe(0.003);
    expect(m.powers).toEqual([250, 260, 240, 750]);
    expect(m.energies).toEqual([1, 2, 3, 6]);
    expect(m.temperatures).toEqual([25.12, 26, 24.99, 24]);
    expect(m.switchState).toBe('closed');
    expect(m.alarms.leakage).toBe(true);
    expect(m.alarms.any).toBe(true);
  });

  it('maps single-phase scalar power and energy into both phase A and total', () => {
    const m = childToMeasurements({
      Voltage: 220000,
      Current: 1500,
      Power: 330,
      Energy: 12500,
      Temperature: 2530,
      SwitchStatus: 0,
    });
    expect(m.voltages).toEqual([220, 0, 0]);
    expect(m.currents).toEqual([1.5, 0, 0]);
    expect(m.powers).toEqual([330, 0, 0, 330]);
    expect(m.energies).toEqual([12.5, 0, 0, 12.5]);
    expect(m.switchState).toBe('open');
  });

  it('parses JSON and rejects non-object payloads', () => {
    expect(parseMessage(Buffer.from('{"bid":101}'))).toEqual({ bid: 101 });
    expect(() => parseMessage('null')).toThrow('JSON 对象');
  });

  it('maps the three documented switch states', () => {
    expect([switchState(0), switchState(1), switchState(2), switchState(9)]).toEqual([
      'open',
      'closed',
      'locked',
      'unknown',
    ]);
  });
});
