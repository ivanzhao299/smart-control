import {
  validateChargeAmount,
  validateRefundAmount,
  validateReductionAmount,
  validateSwitchControl,
  validateNamedConfirm,
  isSwitchControl,
  canRemoteControl,
} from './em123.write-rules';

describe('em123 现金/补量金额校验 validateChargeAmount', () => {
  const base = { limit: 30000, threshold: 5000, confirm: false, mode: 'cash' as const };

  it('放行正常小额现金', () => {
    expect(validateChargeAmount({ ...base, amount: 100 })).toBeNull();
  });

  it('拒绝 0、负数、非数字', () => {
    expect(validateChargeAmount({ ...base, amount: 0 })).toContain('大于 0');
    expect(validateChargeAmount({ ...base, amount: -50 })).toContain('大于 0');
    expect(validateChargeAmount({ ...base, amount: NaN })).toContain('大于 0');
  });

  it('超过硬上限直接拒绝（即使 confirm 也不放行）', () => {
    expect(validateChargeAmount({ ...base, amount: 30001, confirm: true })).toContain('硬上限');
    expect(validateChargeAmount({ ...base, amount: 50000, confirm: true })).toContain('硬上限');
  });

  it('达到大额门槛但未确认 → 拒绝', () => {
    expect(validateChargeAmount({ ...base, amount: 5000 })).toContain('二次确认');
    expect(validateChargeAmount({ ...base, amount: 12000 })).toContain('二次确认');
  });

  it('达到大额门槛且已确认 → 放行', () => {
    expect(validateChargeAmount({ ...base, amount: 12000, confirm: true })).toBeNull();
    expect(validateChargeAmount({ ...base, amount: 30000, confirm: true })).toBeNull();
  });

  it('补量模式提示文案随模式变化', () => {
    expect(
      validateChargeAmount({ ...base, amount: 0, mode: 'replienish' }),
    ).toContain('补量');
    expect(
      validateChargeAmount({ ...base, amount: 6000, mode: 'replienish' }),
    ).toContain('补量');
  });
});

describe('em123 退费金额校验 validateRefundAmount', () => {
  const base = { original: 1000, threshold: 5000, confirm: false };

  it('放行不超过原额的正常退费', () => {
    expect(validateRefundAmount({ ...base, money: 100 })).toBeNull();
    expect(validateRefundAmount({ ...base, money: 1000 })).toBeNull();
  });

  it('拒绝非正数与原额缺失', () => {
    expect(validateRefundAmount({ ...base, money: 0 })).toContain('大于 0');
    expect(validateRefundAmount({ ...base, money: 100, original: null })).toContain('原充值');
  });

  it('退费不得超过原充值额', () => {
    expect(validateRefundAmount({ ...base, money: 1000.01 })).toContain('不得超过');
    expect(validateRefundAmount({ ...base, money: 2000 })).toContain('不得超过');
  });

  it('大额退费需二次确认', () => {
    expect(validateRefundAmount({ original: 8000, threshold: 5000, confirm: false, money: 6000 })).toContain(
      '二次确认',
    );
    expect(validateRefundAmount({ original: 8000, threshold: 5000, confirm: true, money: 6000 })).toBeNull();
  });
});

describe('em123 减免金额校验 validateReductionAmount', () => {
  const base = { threshold: 5000, confirm: false };

  it('放行正数小额减免', () => {
    expect(validateReductionAmount({ ...base, money: 10 })).toBeNull();
    expect(validateReductionAmount({ ...base, money: 4999.99 })).toBeNull();
  });

  it('拒绝非正数', () => {
    expect(validateReductionAmount({ ...base, money: 0 })).toContain('大于 0');
    expect(validateReductionAmount({ ...base, money: -50 })).toContain('大于 0');
    expect(validateReductionAmount({ ...base, money: NaN })).toContain('大于 0');
  });

  it('大额减免需二次确认', () => {
    expect(validateReductionAmount({ threshold: 5000, confirm: false, money: 5000 })).toContain('二次确认');
    expect(validateReductionAmount({ threshold: 5000, confirm: true, money: 5000 })).toBeNull();
    expect(validateReductionAmount({ threshold: 5000, confirm: true, money: 20000 })).toBeNull();
  });
});

describe('em123 拉合闸强二次确认 validateSwitchControl', () => {
  it('校时/多费率不属于开关控制，无需强确认', () => {
    expect(isSwitchControl('settime')).toBe(false);
    expect(isSwitchControl('setrate')).toBe(false);
    expect(
      validateSwitchControl({ action: 'settime', reason: '', confirmName: '', expectName: 'A2' }),
    ).toBeNull();
  });

  it('拉闸/合闸原因至少 2 个字', () => {
    expect(isSwitchControl('wattoff')).toBe(true);
    expect(
      validateSwitchControl({ action: 'wattoff', reason: 'x', confirmName: 'A2栋', expectName: 'A2栋' }),
    ).toContain('原因');
  });

  it('住房名必须逐字一致，否则拒绝', () => {
    expect(
      validateSwitchControl({ action: 'wattoff', reason: '欠费', confirmName: 'A2', expectName: 'A2栋' }),
    ).toContain('二次确认失败');
  });

  it('真实住房名为空时拒绝，避免空对空绕过', () => {
    expect(
      validateSwitchControl({ action: 'watton', reason: '恢复', confirmName: '', expectName: '' }),
    ).toContain('二次确认失败');
  });

  it('原因充分且住房名一致 → 放行', () => {
    expect(
      validateSwitchControl({ action: 'wattoff', reason: '欠费催缴', confirmName: 'A2栋--1楼电表', expectName: 'A2栋--1楼电表' }),
    ).toBeNull();
  });

  it('确认名两端空格可容忍，但住房名本体须一致', () => {
    expect(
      validateSwitchControl({ action: 'watton', reason: '已缴费', confirmName: '  A2栋  ', expectName: 'A2栋' }),
    ).toBeNull();
  });
});

describe('em123 高危命名强确认 validateNamedConfirm（多费率复用）', () => {
  const base = { confirmName: 'A2栋--1楼电表', expectName: 'A2栋--1楼电表' };

  it('原因不足或户名不一致 → 拒绝', () => {
    expect(validateNamedConfirm({ ...base, reason: 'x', verb: '多费率设置' })).toContain('原因');
    expect(validateNamedConfirm({ ...base, reason: '调整费率', confirmName: 'A2', verb: '多费率设置' })).toContain(
      '二次确认失败',
    );
  });

  it('真实住房名为空时拒绝，防空对空', () => {
    expect(
      validateNamedConfirm({ reason: '调整', confirmName: '', expectName: '', verb: '多费率设置' }),
    ).toContain('二次确认失败');
  });

  it('原因充分且户名一致 → 放行', () => {
    expect(
      validateNamedConfirm({ ...base, reason: '改尖峰平谷费率', verb: '多费率设置' }),
    ).toBeNull();
  });
});

describe('em123 远程控制仅管理员 canRemoteControl', () => {
  it('仅 admin 放行', () => {
    expect(canRemoteControl('admin')).toBe(true);
    expect(canRemoteControl('property')).toBe(false);
    expect(canRemoteControl('finance')).toBe(false);
    expect(canRemoteControl('operator')).toBe(false);
    expect(canRemoteControl(undefined)).toBe(false);
  });
});
