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
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }

  afterInit(_server: Server): void {
    this.logger.info(`WebSocket gateway ready at ${this.wsCfg.path}`, {
      context: 'StatusGateway',
    });
  }

  handleConnection(client: WebSocket): void {
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
  handlePing(@ConnectedSocket() _client: WebSocket, @MessageBody() _data: unknown): PongMessage {
    return { type: 'pong', at: new Date().toISOString() };
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
