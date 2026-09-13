/**
 * Sprint-08 统一错误体系
 * 设备层错误从 adapters/errors.ts 重新导出 (避免大改 import 路径)；
 * 业务层错误 (SceneExecutionError) 在此定义。
 */
export {
  DeviceError,
  DeviceConnectionError,
  DeviceTimeoutError,
  DeviceOfflineError,
  DeviceProtocolError,
  classifyError,
} from '../../adapters/errors';

/** Adapter 通讯/协议层错误别名 (spec Task-012 要求名) */
export { DeviceProtocolError as AdapterProtocolError } from '../../adapters/errors';

export class SceneExecutionError extends Error {
  readonly sceneCode: string;
  readonly executionId?: string;
  readonly cause?: unknown;

  constructor(
    sceneCode: string,
    message: string,
    opts: { executionId?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = 'SceneExecutionError';
    this.sceneCode = sceneCode;
    this.executionId = opts.executionId;
    this.cause = opts.cause;
  }
}
