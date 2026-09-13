export class DeviceError extends Error {
  readonly deviceType: string;
  readonly deviceId?: string;
  readonly cause?: unknown;

  constructor(deviceType: string, message: string, opts: { deviceId?: string; cause?: unknown } = {}) {
    super(message);
    this.name = this.constructor.name;
    this.deviceType = deviceType;
    this.deviceId = opts.deviceId;
    this.cause = opts.cause;
  }
}

export class DeviceConnectionError extends DeviceError {}
export class DeviceTimeoutError extends DeviceError {}
export class DeviceOfflineError extends DeviceError {}
export class DeviceProtocolError extends DeviceError {}

export function classifyError(deviceType: string, err: unknown, deviceId?: string): DeviceError {
  if (err instanceof DeviceError) return err;
  const message = err instanceof Error ? err.message : String(err);
  if (/ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|ECONNRESET|EPIPE/.test(message)) {
    return new DeviceConnectionError(deviceType, message, { deviceId, cause: err });
  }
  if (/timeout|ETIMEDOUT/i.test(message)) {
    return new DeviceTimeoutError(deviceType, message, { deviceId, cause: err });
  }
  return new DeviceProtocolError(deviceType, message, { deviceId, cause: err });
}
