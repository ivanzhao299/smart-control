import { Inject, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { Server, WebSocket } from 'ws';
import { ControlBus, ControlEvent } from '../../services/control-bus';
import { DeviceStatusService } from '../../services/device-status.service';
import { SceneEngineService } from '../../services/scene-engine.service';
import { WebSocketConfig } from '../../common/config/configuration';

interface ClientHello {
  type: 'hello';
  message: string;
  serverTime: string;
}

interface PongMessage {
  type: 'pong';
  at: string;
}

@WebSocketGateway({ path: '/ws/status' })
export class StatusGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect, OnModuleInit, OnModuleDestroy
{
  @WebSocketServer()
  server!: Server;

  private unsubscribe?: () => void;
  private readonly wsCfg: WebSocketConfig;

  /**
   * 服务端心跳 — 清理死连接.
   *
   * 之前只有 @SubscribeMessage('ping') 被动回 pong: 客户端**正常**断开时 ws 会触发
   * close, 没问题; 但客户端**异常**掉线 (平板熄屏断网/拔网线/断电) 时 TCP 不会立刻
   * 感知, 那条连接会一直挂在 server.clients 里 —— broadcast 每次都往这些死连接发,
   * 连接数只增不减, 现场平板反复休眠唤醒几天后能攒出一堆.
   *
   * 标准 ws 做法: 定时发协议层 ping, 上一轮没回 pong 的直接 terminate.
   * WS_HEARTBEAT_MS 可调, <=0 关闭.
   */
  private readonly heartbeatMs = Number.parseInt(process.env.WS_HEARTBEAT_MS ?? '30000', 10);
  /** 每条连接上一轮是否回过 pong (WeakMap: 连接被回收时自动清, 不用手动删) */
  private readonly alive = new WeakMap<WebSocket, boolean>();
  private heartbeatTimer?: NodeJS.Timeout;

  constructor(
    config: ConfigService,
    private readonly bus: ControlBus,
    private readonly deviceStatus: DeviceStatusService,
    private readonly engine: SceneEngineService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {
    this.wsCfg = config.getOrThrow<WebSocketConfig>('websocket');
  }

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe((event) => this.broadcast(event));
    if (Number.isFinite(this.heartbeatMs) && this.heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => this.sweepDeadClients(), this.heartbeatMs);
      this.heartbeatTimer.unref?.();
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
  }

  afterInit(_server: Server): void {
    this.logger.info(`WebSocket gateway ready at ${this.wsCfg.path}`, {
      context: 'StatusGateway',
    });
  }

  handleConnection(client: WebSocket): void {
    this.alive.set(client, true);
    // 协议层 pong (浏览器/ws 客户端自动回, 不需要前端配合)
    client.on('pong', () => this.alive.set(client, true));
    const hello: ClientHello = {
      type: 'hello',
      message: 'smart-control status stream',
      serverTime: new Date().toISOString(),
    };
    this.safeSend(client, hello);
    this.snapshot(client);
    this.logger.info(`WS client connected (total=${this.server.clients.size})`, {
      context: 'StatusGateway',
    });
  }

  handleDisconnect(_client: WebSocket): void {
    this.logger.info(`WS client disconnected (total=${this.server.clients.size})`, {
      context: 'StatusGateway',
    });
  }

  @SubscribeMessage('ping')
  handlePing(@ConnectedSocket() client: WebSocket, @MessageBody() _data: unknown): PongMessage {
    // 应用层 ping (前端 websocket.service 每 10s 发) 也算活着
    this.alive.set(client, true);
    return { type: 'pong', at: new Date().toISOString() };
  }

  /**
   * 一轮心跳: 上一轮没回 pong 的判死 terminate, 其余标记待验证并发 ping.
   * terminate 会触发 close → handleDisconnect, 连接从 server.clients 移除.
   */
  private sweepDeadClients(): void {
    if (!this.server) return;
    let killed = 0;
    for (const client of this.server.clients) {
      if (this.alive.get(client) === false) {
        try {
          client.terminate();
        } catch {
          /* 已经死透了, 忽略 */
        }
        killed += 1;
        continue;
      }
      this.alive.set(client, false);
      try {
        client.ping();
      } catch {
        try {
          client.terminate();
        } catch {
          /* ignore */
        }
        killed += 1;
      }
    }
    if (killed > 0) {
      this.logger.warn(
        `WS 心跳清理 ${killed} 条死连接 (剩余 total=${this.server.clients.size})`,
        { context: 'StatusGateway' },
      );
    }
  }

  private snapshot(client: WebSocket): void {
    for (const snap of this.deviceStatus.list()) {
      this.safeSend(client, {
        type: 'device_status',
        device: snap.device,
        status: snap.status,
        state: snap.state,
        at: snap.updatedAt,
      });
    }
    for (const exec of this.engine.listRunning()) {
      this.safeSend(client, {
        type: 'scene',
        scene: exec.sceneCode,
        executionId: exec.executionId,
        status: 'running',
        failures: exec.failed,
        at: exec.startedAt,
      });
    }
  }

  private broadcast(event: ControlEvent): void {
    if (!this.server) return;
    const payload = JSON.stringify(event);
    for (const client of this.server.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload, (err) => {
          if (err) {
            this.logger.warn(`WS send failed: ${err.message}`, { context: 'StatusGateway' });
          }
        });
      }
    }
  }

  private safeSend(client: WebSocket, payload: unknown): void {
    if (client.readyState !== client.OPEN) return;
    try {
      client.send(JSON.stringify(payload));
    } catch (err) {
      this.logger.warn(`WS safeSend failed: ${(err as Error).message}`, {
        context: 'StatusGateway',
      });
    }
  }
}
