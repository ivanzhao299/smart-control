import { DeviceConnectionError } from '../errors';

/**
 * 本地串口客户端 (COM 口直连设备用).
 *
 * 为什么单独包一层:
 *   1. `serialport` 是**原生模块**. 万一某台机器上装不上/绑定加载失败, 直接
 *      顶层 import 会让**整个 backend 起不来** —— 一个电源时序器不该有这种权力。
 *      这里用动态 require + 缓存, 加载失败只让电源功能报错, 其余照跑。
 *   2. 现场 GK9000 是 COM 口直连时序器 (不是串口服务器转 TCP), 所以要这条通路。
 *      2026-07-16 实测: serialport 13.0.0 在 GK9000 (Win, node 20) 预编译绑定
 *      可用, COM1 打开/收发正常。
 *
 * 串口是独占资源: 一个口同一时刻只能被一个进程打开。所以采用**短连接** ——
 * 每次命令开-发-收-关, 不长期占着 COM 口 (否则现场想用厂家工具调试就打不开了)。
 */

interface SerialPortLike {
  open(cb: (err?: Error | null) => void): void;
  close(cb?: (err?: Error | null) => void): void;
  write(data: Buffer): boolean;
  on(event: 'data', cb: (chunk: Buffer) => void): void;
  removeAllListeners(): void;
  isOpen: boolean;
}

type SerialPortCtor = new (opts: {
  path: string;
  baudRate: number;
  dataBits?: 8 | 7 | 6 | 5;
  parity?: 'none' | 'even' | 'odd';
  stopBits?: 1 | 2;
  autoOpen?: boolean;
}) => SerialPortLike;

let ctorCache: SerialPortCtor | null = null;
let loadError: string | null = null;

/** 动态取 SerialPort 构造器; 装不上时抛可读错误, 不影响 backend 其余部分 */
function getSerialPortCtor(): SerialPortCtor {
  if (ctorCache) return ctorCache;
  if (loadError) throw new DeviceConnectionError('power', `serialport 不可用: ${loadError}`);
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires, global-require
    const mod = require('serialport') as { SerialPort: SerialPortCtor };
    ctorCache = mod.SerialPort;
    return ctorCache;
  } catch (err) {
    loadError = (err as Error).message;
    throw new DeviceConnectionError(
      'power',
      `serialport 原生模块加载失败 (电源时序器不可用, 其余功能不受影响): ${loadError}`,
    );
  }
}

export interface SerialClientOptions {
  path: string;
  baudRate: number;
  deviceType: string;
  timeoutMs?: number;
}

export class SerialPortClient {
  constructor(private readonly opts: SerialClientOptions) {}

  /** serialport 能不能用 (给健康检查/诊断提示语用) */
  static probeAvailable(): { ok: boolean; error?: string } {
    try {
      getSerialPortCtor();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: (err as Error).message };
    }
  }

  /**
   * 开-发-收-关 一次往返.
   * @param expectReply false 时不等回复, 发完就关
   * @param settleMs 收包静默时间: 串口没有帧边界, 靠"多久没新数据"判定收完
   */
  async request(
    frame: Buffer,
    opts: { expectReply?: boolean; settleMs?: number; signal?: AbortSignal } = {},
  ): Promise<Buffer> {
    const Ctor = getSerialPortCtor();
    const timeoutMs = this.opts.timeoutMs ?? 3000;
    const settleMs = opts.settleMs ?? 250;

    const port = new Ctor({
      path: this.opts.path,
      baudRate: this.opts.baudRate,
      dataBits: 8,
      parity: 'none',
      stopBits: 1,
      autoOpen: false,
    });

    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new DeviceConnectionError(this.opts.deviceType, `打开 ${this.opts.path} 超时`)),
        timeoutMs,
      );
      port.open((err) => {
        clearTimeout(t);
        if (err) {
          // 串口被别人占着是最常见的现场问题 (厂家调试软件 / 另一个进程)
          reject(new DeviceConnectionError(
            this.opts.deviceType,
            `打开 ${this.opts.path} 失败 (是否被其它程序占用?): ${err.message}`,
          ));
        } else resolve();
      });
    });

    try {
      const chunks: Buffer[] = [];
      port.on('data', (c) => chunks.push(c));
      port.write(frame);

      if (!opts.expectReply) {
        // 写命令: 给设备一点时间把字节送出去再关口
        await this.sleep(120);
        return Buffer.alloc(0);
      }

      const deadline = Date.now() + timeoutMs;
      let lastLen = 0;
      let quietSince = Date.now();
      for (;;) {
        if (opts.signal?.aborted) {
          throw new DeviceConnectionError(this.opts.deviceType, 'aborted');
        }
        await this.sleep(50);
        const len = chunks.reduce((n, c) => n + c.length, 0);
        if (len > lastLen) {
          lastLen = len;
          quietSince = Date.now();
        } else if (len > 0 && Date.now() - quietSince >= settleMs) {
          break; // 静默够久 = 收完了
        }
        if (Date.now() > deadline) {
          if (len > 0) break; // 收到了一些, 先用着
          throw new DeviceConnectionError(
            this.opts.deviceType,
            `${this.opts.path} 读超时 (${timeoutMs}ms 无响应)`,
          );
        }
      }
      return Buffer.concat(chunks);
    } finally {
      port.removeAllListeners();
      if (port.isOpen) {
        await new Promise<void>((resolve) => port.close(() => resolve()));
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }
}
