import { Socket } from 'net';
import { classifyError, DeviceConnectionError, DeviceTimeoutError } from '../errors';

export interface TcpClientOptions {
  host: string;
  port: number;
  deviceType: string;
  timeoutMs?: number;
}

/**
 * 短连接 TCP: 每次 sendAndExpect 新建 socket 发送数据并等待响应。
 * 适合大多数厂商 TCP 控制协议 (一问一答, 无持久会话)。
 */
export class TcpClient {
  constructor(private readonly opts: TcpClientOptions) {}

  async ping(timeoutMs?: number, signal?: AbortSignal): Promise<void> {
    await this.connectOnce(timeoutMs ?? this.opts.timeoutMs ?? 3000, signal).then((sock) => {
      sock.destroy();
    });
  }

  async send(payload: Buffer | string, signal?: AbortSignal): Promise<void> {
    const sock = await this.connectOnce(this.opts.timeoutMs ?? 3000, signal);
    try {
      await this.writeAsync(sock, payload);
    } finally {
      sock.end();
    }
  }

  async sendAndExpect(
    payload: Buffer | string,
    expectBytes: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const timeoutMs = this.opts.timeoutMs ?? 3000;
    const sock = await this.connectOnce(timeoutMs, signal);
    try {
      await this.writeAsync(sock, payload);
      return await this.readBytes(sock, expectBytes, timeoutMs, signal);
    } finally {
      sock.destroy();
    }
  }

  private connectOnce(timeoutMs: number, signal?: AbortSignal): Promise<Socket> {
    return new Promise<Socket>((resolve, reject) => {
      const sock = new Socket();
      sock.setNoDelay(true);
      let settled = false;

      const cleanup = (): void => {
        sock.removeAllListeners('connect');
        sock.removeAllListeners('error');
        sock.setTimeout(0);
        if (abortHandler && signal) signal.removeEventListener('abort', abortHandler);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        sock.destroy();
        reject(
          new DeviceTimeoutError(
            this.opts.deviceType,
            `tcp connect timed out after ${timeoutMs}ms to ${this.opts.host}:${this.opts.port}`,
          ),
        );
      }, timeoutMs);

      const abortHandler = signal
        ? (): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            cleanup();
            sock.destroy();
            reject(new DeviceConnectionError(this.opts.deviceType, 'aborted'));
          }
        : undefined;
      if (signal && abortHandler) signal.addEventListener('abort', abortHandler, { once: true });

      sock.once('connect', () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        resolve(sock);
      });
      sock.once('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        cleanup();
        reject(classifyError(this.opts.deviceType, err));
      });

      sock.connect(this.opts.port, this.opts.host);
    });
  }

  private writeAsync(sock: Socket, payload: Buffer | string): Promise<void> {
    return new Promise((resolve, reject) => {
      sock.write(payload, (err) => {
        if (err) reject(classifyError(this.opts.deviceType, err));
        else resolve();
      });
    });
  }

  private readBytes(
    sock: Socket,
    expectBytes: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        sock.removeAllListeners('data');
        sock.removeAllListeners('error');
        sock.removeAllListeners('end');
        reject(
          new DeviceTimeoutError(
            this.opts.deviceType,
            `tcp read timed out after ${timeoutMs}ms (expect ${expectBytes} bytes)`,
          ),
        );
      }, timeoutMs);

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new DeviceConnectionError(this.opts.deviceType, 'aborted'));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      sock.on('data', (chunk) => {
        chunks.push(chunk);
        received += chunk.length;
        if (received >= expectBytes) {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve(Buffer.concat(chunks).subarray(0, expectBytes));
        }
      });
      sock.on('error', (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(classifyError(this.opts.deviceType, err));
      });
      sock.on('end', () => {
        if (settled) return;
        if (received >= expectBytes) return;
        settled = true;
        clearTimeout(timer);
        if (signal) signal.removeEventListener('abort', onAbort);
        reject(
          new DeviceConnectionError(
            this.opts.deviceType,
            `tcp closed before ${expectBytes} bytes received (got ${received})`,
          ),
        );
      });
    });
  }
}
