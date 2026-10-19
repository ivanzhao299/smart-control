/**
 * em123 写操作安全校验纯函数（无副作用、可单测）。
 *
 * 资金/远程断电属高危操作，校验规则在此集中维护，作为 service 与前端提示的
 * 单一事实源；controller/service 负责把返回的错误消息转成 400 并落留痕。
 * 约定：返回 string 表示校验失败（即错误消息），返回 null 表示通过。
 */

export type Em123ChargeMode = 'cash' | 'replienish';
export type Em123ControlAction = 'wattoff' | 'watton' | 'settime' | 'setrate';

/** 现金/补量金额校验：必须为正、不超硬上限、达大额门槛须二次确认。 */
export function validateChargeAmount(opts: {
  amount: number;
  limit: number;
  threshold: number;
  confirm: boolean;
  mode: Em123ChargeMode;
}): string | null {
  const label = opts.mode === 'replienish' ? '补量' : '现金充值';
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) {
    return `${label}金额必须为大于 0 的数字`;
  }
  if (opts.amount > opts.limit) {
    return `单笔${label} ${opts.amount} 超过硬上限 ${opts.limit}，请核对或走线下`;
  }
  if (opts.amount >= opts.threshold && !opts.confirm) {
    return `大额${label}（≥${opts.threshold}）需二次确认，请勾选确认后再提交`;
  }
  return null;
}

/** 退费金额校验：必须为正、不得超原充值、达大额门槛须二次确认。 */
export function validateRefundAmount(opts: {
  money: number;
  original: number | null;
  threshold: number;
  confirm: boolean;
}): string | null {
  if (!Number.isFinite(opts.money) || opts.money <= 0) {
    return '退费金额必须为大于 0 的数字';
  }
  if (opts.original === null) {
    return '未取到原充值金额，无法退费';
  }
  if (opts.money > opts.original) {
    return `退费金额 ${opts.money} 不得超过原充值金额 ${opts.original}`;
  }
  if (opts.money >= opts.threshold && !opts.confirm) {
    return `大额退费（≥${opts.threshold}）需二次确认，请勾选确认后再提交`;
  }
  return null;
}

/**
 * 减免金额校验：必须为正、达大额门槛须二次确认。
 * 减免按"住房 + 表类型"核销应收，平台本身不设硬上限，故仅做强校验与大额确认。
 */
export function validateReductionAmount(opts: {
  money: number;
  threshold: number;
  confirm: boolean;
}): string | null {
  if (!Number.isFinite(opts.money) || opts.money <= 0) {
    return '减免金额必须为大于 0 的数字';
  }
  if (opts.money >= opts.threshold && !opts.confirm) {
    return `大额减免（≥${opts.threshold}）需二次确认，请勾选确认后再提交`;
  }
  return null;
}

/** 是否为会改变供电状态的高危控制（拉闸/合闸），需要强二次确认。 */
export function isSwitchControl(action: Em123ControlAction): boolean {
  return action === 'wattoff' || action === 'watton';
}

/**
 * 高危写操作强二次确认（拉合闸/多费率共用）：
 *  - 原因至少 2 个字；
 *  - 必须逐字输入与该表一致的住房名（confirmName）。
 */
export function validateNamedConfirm(opts: {
  reason: string;
  confirmName: string;
  expectName: string;
  verb: string;
}): string | null {
  const reason = String(opts.reason ?? '').trim();
  if (reason.length < 2) {
    return `${opts.verb}必须填写原因（至少 2 个字）`;
  }
  const got = String(opts.confirmName ?? '').trim();
  const expect = String(opts.expectName ?? '').trim();
  if (!expect || got !== expect) {
    return `二次确认失败：请准确输入该表的住房名以继续（应为「${expect}」）`;
  }
  return null;
}

/**
 * 拉闸/合闸强二次确认校验：
 *  - 原因至少 2 个字；
 *  - 必须逐字输入与该表一致的住房名（confirmName）。
 */
export function validateSwitchControl(opts: {
  action: Em123ControlAction;
  reason: string;
  confirmName: string;
  expectName: string;
}): string | null {
  if (!isSwitchControl(opts.action)) return null;
  return validateNamedConfirm({
    reason: opts.reason,
    confirmName: opts.confirmName,
    expectName: opts.expectName,
    verb: '拉合闸',
  });
}

/** 远程控制仅管理员（service 据此抛 403；独立成函数便于统一口径）。 */
export function canRemoteControl(role: string | undefined): boolean {
  return role === 'admin';
}
