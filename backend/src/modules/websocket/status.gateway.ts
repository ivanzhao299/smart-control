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
import { ClientAuthService } from '../client-auth/client-auth.service';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { Actor } from '../../common/auth/actor';
import { PlayerDeviceAuthService } from '../playback/player-device-auth.service';
import { join, resolve } from 'path';
import { resolveRuntimeDataDir } from '../../common/storage/runtime-data-path';
import { FrontendRelease, FrontendReleaseWatcher } from './frontend-release';

type SocketSession =
  | { kind: 'user'; token: string; admin: boolean }
  | { kind: 'player'; token: string; slot: number }
  | { kind: 'public' };
type SocketIdentity = Actor | { kind: 'player'; slot: number };

interface ClientHello {
  type: 'hello';
  message: string;
  serverTime: string;
  frontendBuildId?: string;
}

interface PongMessage {
  type: 'pong';
  at: string;
}

@WebSocketGateway({ path: '/ws/status', maxPayload: 16384 })
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
  private readonly sessions = new WeakMap<WebSocket, SocketSession>();
  private readonly authTimers = new Map<WebSocket, NodeJS.Timeout>();
  private releaseWatcher?: FrontendReleaseWatcher;

  constructor(
    config: ConfigService,
    private readonly bus: ControlBus,
    private readonly deviceStatus: DeviceStatusService,
    private readonly engine: SceneEngineService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly clientAuth: ClientAuthService,
    private readonly adminAuth: AdminAuthService,
    private readonly playerAuth: PlayerDeviceAuthService,
  ) {
    this.wsCfg = config.getOrThrow<WebSocketConfig>('websocket');
  }

  onModuleInit(): void {
    this.unsubscribe = this.bus.subscribe((event) => this.broadcast(event));
    this.releaseWatcher = new FrontendReleaseWatcher(
      resolve(process.env.RELEASE_MANIFEST_PATH?.trim() || join(resolveRuntimeDataDir(), 'release.json')),
      release => this.broadcast(release),
      message => this.logger.warn(message, { context: 'StatusGateway' }),
    );
    this.releaseWatcher.start();
    if (Number.isFinite(this.heartbeatMs) && this.heartbeatMs > 0) {
      this.heartbeatTimer = setInterval(() => this.sweepDeadClients(), this.heartbeatMs);
      this.heartbeatTimer.unref?.();
    }
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
    this.releaseWatcher?.stop();
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const timer of this.authTimers.values()) clearTimeout(timer);
    this.authTimers.clear();
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
    const timer = setTimeout(() => client.close(4401, 'Authentication required'), 5000);
    timer.unref?.();
    this.authTimers.set(client, timer);
  }

  @SubscribeMessage('authenticate')
  async authenticate(@ConnectedSocket() client: WebSocket, @MessageBody() data: unknown): Promise<void> {
    if (this.sessions.has(client)) { client.close(4401, 'Reconnect to change identity'); return; }
    const input = data as { token?: unknown; admin?: unknown } | null;
    if (!input || typeof input.token !== 'string' || input.token.length > 8192 || typeof input.admin !== 'boolean') {
      client.close(4401, 'Invalid authentication'); return;
    }
    this.sessions.set(client, { kind: 'user', token: input.token, admin: input.admin });
    const actor = await this.resolve(client);
    if (!actor || actor.kind === 'player' || client.readyState !== client.OPEN) return;
    this.sendHello(client);
    this.snapshot(client, actor);
  }

  @SubscribeMessage('authenticate_player')
  async authenticatePlayer(@ConnectedSocket() client: WebSocket, @MessageBody() data: unknown): Promise<void> {
    if (this.sessions.has(client)) { client.close(4401, 'Reconnect to change identity'); return; }
    const input = data as { token?: unknown; slot?: unknown } | null;
    try {
      this.playerAuth.authenticate(input?.token, input?.slot as number);
    } catch { client.close(4401, 'Invalid player authentication'); return; }
    this.sessions.set(client, { kind: 'player', token: input!.token as string, slot: input!.slot as number });
    // Devices never receive user, scene, or adapter snapshots. On hello they fetch
    // their scoped REST state, which independently enforces media/user permissions.
    this.sendHello(client);
  }

  /**
   * 匿名公共频道（供无人值守运营大屏，无登录态）。
   * 大屏人车管理页只需要“过车/道闸状态”这两类本就公开的事件（REST recent/stats 同为 @Public，
   * 车牌信息本就在门岗大屏公开展示）。公共频道：
   *   - 不接受任何 token、不解析任何身份；
   *   - 服务端仅向其广播 lpr_pass / lpr_gate_status，其余事件一律不下发（见 sendAuthorized）；
   *   - 不订阅任何指令类消息，无法通过该连接写操作。
   */
  @SubscribeMessage('subscribe_public')
  subscribePublic(@ConnectedSocket() client: WebSocket): void {
    if (this.sessions.has(client)) {
      client.close(4401, 'Reconnect to change identity');
      return;
    }
    this.sessions.set(client, { kind: 'public' });
    this.sendHello(client);
  }

  private sendHello(client: WebSocket): void {
    clearTimeout(this.authTimers.get(client));
    this.authTimers.delete(client);
    const hello: ClientHello = {
      type: 'hello',
      message: 'smart-control status stream',
      serverTime: new Date().toISOString(),
      frontendBuildId: this.releaseWatcher?.refresh()?.frontendBuildId,
    };
    this.safeSend(client, hello);
    this.logger.info(`WS client connected (total=${this.server.clients.size})`, {
      context: 'StatusGateway',
    });
  }

  handleDisconnect(_client: WebSocket): void {
    this.sessions.delete(_client);
    clearTimeout(this.authTimers.get(_client));
    this.authTimers.delete(_client);
    this.logger.info(`WS client disconnected (total=${this.server.clients.size})`, {
      context: 'StatusGateway',
    });
  }

  @SubscribeMessage('ping')
  async handlePing(@ConnectedSocket() client: WebSocket, @MessageBody() _data: unknown): Promise<PongMessage | undefined> {
    if (!await this.resolve(client)) return;
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

  private snapshot(client: WebSocket, actor: Actor): void {
    for (const snap of this.deviceStatus.list()) {
      this.safeSend(client, {
        type: 'device_status',
        device: snap.device,
        status: snap.status,
        state: actor.role === 'admin' ? snap.state : undefined,
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

  private broadcast(event: ControlEvent | FrontendRelease): void {
    if (!this.server) return;
    for (const client of this.server.clients) {
      if (client.readyState === client.OPEN && this.sessions.has(client)) void this.sendAuthorized(client, event);
    }
  }

  private async resolve(client: WebSocket): Promise<SocketIdentity | null> {
    const session = this.sessions.get(client);
    try {
      if (session) {
        if (session.kind === 'player') {
          this.playerAuth.authenticate(session.token, session.slot);
          if (this.sessions.get(client) === session) return { kind: 'player', slot: session.slot };
          return null;
        }
        if (session.kind === 'public') return null; // 公共频道匿名连接，无身份可解析
        let actor: Actor | null = null;
        if (session.admin) {
          // ① 收敛前的共享后台令牌 (admin_auth_v1 签名, 无 uid) 仍兼容;
          if (await this.adminAuth.verifyToken(session.token)) {
            actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
          } else {
            // ② 后台登录 (loginAdministrator) 已统一为个人账号, 令牌由 client_auth_v1
            //    签发且 payload 带 uid。按真实 role 解析 (admin/operator…), 不会因标记
            //    admin=true 而提权——权限仍由下方 actor.role 分流。
            actor = await this.clientAuth.resolveActor(session.token);
          }
        } else {
          actor = await this.clientAuth.resolveActor(session.token);
        }
        if (actor && this.sessions.get(client) === session) return actor;
      }
    } catch { /* Fail closed on authentication storage errors. */ }
    this.sessions.delete(client);
    client.close(4401, 'Authentication expired');
    return null;
  }

  private async sendAuthorized(client: WebSocket, event: ControlEvent | FrontendRelease): Promise<void> {
    const session = this.sessions.get(client);
    // 公共频道：仅放行两类本就公开的 LPR 事件，其余（含设备状态/控制/快照等）一律不下发。
    if (session?.kind === 'public') {
      if (event.type === 'lpr_pass' || event.type === 'lpr_gate_status') {
        this.safeSend(client, event);
      }
      return;
    }
    const actor = await this.resolve(client);
    if (!actor) return;
    if (event.type === 'frontend_release') { this.safeSend(client, event); return; }
    if (actor.kind === 'player') {
      if (event.type === 'playback_channel_changed' && event.slot === actor.slot) {
        this.safeSend(client, { type: event.type, slot: event.slot, at: event.at });
      } else if (event.type === 'playback_seek' && event.slot === actor.slot) {
        // 拖拽进度条指令只下发给对应 slot 的大屏播放器; 播放器不接收 progress(避免回环)。
        this.safeSend(client, { type: event.type, slot: event.slot, nonce: event.nonce, time: event.time, at: event.at });
      }
      return;
    }
    if (actor.role === 'admin') { this.safeSend(client, event); return; }
    // Never relay arbitrary adapter state, error messages or test results across users.
    if (event.type === 'playback_channel_changed') this.safeSend(client, { type: event.type, slot: event.slot, at: event.at });
    else if (event.type === 'playback_progress') this.safeSend(client, { type: event.type, slot: event.slot, mediaId: event.mediaId, currentTime: event.currentTime, duration: event.duration, paused: event.paused, ended: event.ended, at: event.at });
    else if (event.type === 'device_status') this.safeSend(client, { type: event.type, device: event.device, status: event.status, at: event.at });
    else if (event.type === 'power_reading') this.safeSend(client, { type: event.type, circuitId: event.circuitId, code: event.code, reading: event.reading, at: event.at });
    else if (event.type === 'scene') this.safeSend(client, { type: event.type, scene: event.scene, executionId: event.executionId, status: event.status, at: event.at });
    else if (event.type === 'lpr_pass') this.safeSend(client, { type: event.type, serialno: event.serialno, license: event.license, passDirection: event.passDirection, releaseResult: event.releaseResult, isFake: event.isFake, isDanger: event.isDanger, recordId: event.recordId, at: event.at });
    else if (event.type === 'lpr_gate_status') this.safeSend(client, { type: event.type, serialno: event.serialno, gateStatus: event.gateStatus, connectStatus: event.connectStatus, at: event.at });
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
