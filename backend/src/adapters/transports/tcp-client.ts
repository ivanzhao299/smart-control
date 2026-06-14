import { Socket } from 'net';
import { classifyError, DeviceConnectionError, DeviceTimeoutError } from '../errors';

export interface TcpClientOptions {
  host: string;
  port: number;
  deviceType: string;
  timeoutMs?: number;
  /**
   * 长连接模式 (PERFORMANCE_AUDIT P0-#1):
   *   true  = 复用同一 socket, 空闲 idleTimeoutMs 后断开. 用于 Modbus/中弘等
   *           长会话协议, 单次命令省 20-40ms TCP 重建开销.
   *   false = 每次新建+销毁 socket (默认). 用于 Nova VX/V 等"对端发完就关"
   *           的协议.
   */
  keepAlive?: boolean;
  /** keepAlive=true 时, socket 空闲多久断开. 默认 30s. */
  idleTimeoutMs?: number;
}

/**
 * TCP 客户端 - 支持短连接 (默认) 和长连接 (keepAlive=true).
 * 长连接模式下用 socketMutex 串行化, 防止 read 流交叠.
 */
export class TcpClient {
  private persistentSocket: Socket | null = null;
  private socketMutex: Promise<unknown> = Promise.resolve();
  private idleTimer?: NodeJS.Timeout;

  constructor(private readonly opts: TcpClientOptions) {}

  async ping(timeoutMs?: number, signal?: AbortSignal): Promise<void> {
    await this.connectOnce(timeoutMs ?? this.opts.timeoutMs ?? 3000, signal).then((sock) => {
      sock.destroy();
    });
  }

  async send(payload: Buffer | string, signal?: AbortSignal): Promise<void> {
    if (this.opts.keepAlive) {
      return this.serialized(async () => {
        const sock = await this.acquirePersistent(signal);
        try {
          await this.writeAsync(sock, payload);
        } catch (err) {
          this.killPersistent();
          throw err;
        } finally {
          this.resetIdleTimer();
        }
      });
    }
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
    opts: { minBytes?: number } = {},
  ): Promise<Buffer> {
    const timeoutMs = this.opts.timeoutMs ?? 3000;

    if (this.opts.keepAlive) {
      return this.serialized(async () => {
        const sock = await this.acquirePersistent(signal);
        try {
          await this.writeAsync(sock, payload);
          return await this.readBytes(sock, expectBytes, timeoutMs, signal, opts.minBytes, true);
        } catch (err) {
          // 写/读失败认为 socket 状态坏掉, 杀掉强制下次重连
          this.killPersistent();
          throw err;
        } finally {
          this.resetIdleTimer();
        }
      });
    }

    const sock = await this.connectOnce(timeoutMs, signal);
    try {
      await this.writeAsync(sock, payload);
      return await this.readBytes(sock, expectBytes, timeoutMs, signal, opts.minBytes);
    } finally {
      sock.destroy();
    }
  }

  /** 手动关闭长连接 (host/port 变更 / shutdown 时调) */
  dispose(): void {
    this.killPersistent();
  }

  // ============ keepAlive 内部 ============

  private async acquirePersistent(signal?: AbortSignal): Promise<Socket> {
    if (this.persistentSocket && !this.persistentSocket.destroyed && this.persistentSocket.writable) {
      return this.persistentSocket;
    }
    const sock = await this.connectOnce(this.opts.timeoutMs ?? 3000, signal);
    sock.setKeepAlive(true, 10_000);
    sock.on('error', () => this.killPersistent());
    sock.on('close', () => { this.persistentSocket = null; });
    sock.on('end', () => this.killPersistent());
    this.persistentSocket = sock;
    return sock;
  }

  private resetIdleTimer(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    const idleMs = this.opts.idleTimeoutMs ?? 30_000;
    this.idleTimer = setTimeout(() => this.killPersistent(), idleMs);
  }

  private killPersistent(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
    if (this.persistentSocket) {
      try {
        this.persistentSocket.removeAllListeners();
        this.persistentSocket.destroy();
      } catch { /* ignore */ }
      this.persistentSocket = null;
    }
  }

  /** 串行队列: 防止多个 sendAndExpect 在同一 socket 上 read 流交叠 */
  private serialized<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.socketMutex;
    const next: Promise<T> = prev.then(fn, fn);
    this.socketMutex = next.catch(() => undefined);
    return next;
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
    minBytes?: number,
    persistent = false,  // true 时退出前彻底清 listener, 不能让残留干扰下次 read
  ): Promise<Buffer> {
    // minBytes: 接受 "对端关连接 + 已收到 ≥ minBytes" 为成功 (返回实际拿到的内容).
    // 用于响应长度不固定的协议 (如 NovaStar V/VX 系列, 同一命令在不同型号上响应长度
    // 差几字节). 默认 minBytes = expectBytes (严格模式).
    const minOk = Math.max(0, minBytes ?? expectBytes);
    return new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let received = 0;
      let settled = false;

      // 清掉只属于这次 read 的 listener (用具名 ref, 不动 socket 上其它 listener)
      const onData = (chunk: Buffer): void => {
        chunks.push(chunk);
        received += chunk.length;
        if (received >= expectBytes && !settled) {
          settled = true;
          cleanup();
          resolve(Buffer.concat(chunks).subarray(0, expectBytes));
        }
      };
      const onError = (err: Error): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(classifyError(this.opts.deviceType, err));
      };
      const onEnd = (): void => {
        if (settled) return;
        if (received >= expectBytes) return;
        settled = true;
        cleanup();
        if (received >= minOk && minOk < expectBytes) {
          resolve(Buffer.concat(chunks));
          return;
        }
        reject(
          new DeviceConnectionError(
            this.opts.deviceType,
            `tcp closed before ${expectBytes} bytes received (got ${received})`,
          ),
        );
      };

      const cleanup = (): void => {
        clearTimeout(timer);
        sock.off('data', onData);
        sock.off('error', onError);
        sock.off('end', onEnd);
        if (signal) signal.removeEventListener('abort', onAbort);
      };

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        if (received >= minOk && minOk < expectBytes) {
          resolve(Buffer.concat(chunks));
          return;
        }
        reject(
          new DeviceTimeoutError(
            this.opts.deviceType,
            `tcp read timed out after ${timeoutMs}ms (expect ${expectBytes} bytes, got ${received})`,
          ),
        );
      }, timeoutMs);

      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(new DeviceConnectionError(this.opts.deviceType, 'aborted'));
      };
      if (signal) signal.addEventListener('abort', onAbort, { once: true });

      sock.on('data', onData);
      sock.on('error', onError);
      sock.on('end', onEnd);

      // persistent 是个 hint, 真正决定要不要清是 cleanup() 自带
      void persistent;
    });
  }

  /**
   * 短连接: 发 payload, 等一个"安静窗口"收齐所有返回字节, 然后关连接.
   *
   * 用于响应**变长且无帧边界**的协议 (得胜 EKX-808: readGain 返 4 字节,
   * readMute 3 字节, 写命令返 "OK" 2 字节, readPreset 1 字节, 全是裸数据
   * 没有 7B7D 帧头帧尾). sendAndExpect 那种"等固定 N 字节"在这里会死等 timeout.
   *
   * 策略: 写完后, 每收到数据就重置 settleMs 计时; settleMs 内没有新数据
   * 就认为对端发完了, 返回已收字节. 整体不超过 maxWaitMs.
   */
  async sendAndReadAll(
    payload: Buffer | string,
    settleMs = 250,
    maxWaitMs?: number,
    signal?: AbortSignal,
  ): Promise<Buffer> {
    const connectTimeout = this.opts.timeoutMs ?? 3000;
    const hardMax = maxWaitMs ?? connectTimeout;
    const sock = await this.connectOnce(connectTimeout, signal);
    try {
      await this.writeAsync(sock, payload);
      return await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        let settled = false;
        let settleTimer: NodeJS.Timeout | undefined;

        const finish = (): void => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(Buffer.concat(chunks));
        };
        const onData = (chunk: Buffer): void => {
          chunks.push(chunk);
          if (settleTimer) clearTimeout(settleTimer);
          settleTimer = setTimeout(finish, settleMs);  // 收到数据 → 重置安静计时
        };
        const onError = (err: Error): void => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(classifyError(this.opts.deviceType, err));
        };
        const onEnd = (): void => finish();  // 对端关连接 = 发完了
        const onAbort = (): void => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new DeviceConnectionError(this.opts.deviceType, 'aborted'));
        };
        const cleanup = (): void => {
          if (settleTimer) clearTimeout(settleTimer);
          clearTimeout(hardTimer);
          sock.off('data', onData);
          sock.off('error', onError);
          sock.off('end', onEnd);
          if (signal) signal.removeEventListener('abort', onAbort);
        };
        // 兜底: 不管有没有数据, hardMax 后强制返回已收 (可能是 0 字节)
        const hardTimer = setTimeout(finish, hardMax);

        if (signal) signal.addEventListener('abort', onAbort, { once: true });
        sock.on('data', onData);
        sock.on('error', onError);
        sock.on('end', onEnd);
      });
    } finally {
      sock.destroy();
    }
  }
}
