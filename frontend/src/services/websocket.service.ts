import type { WsEvent } from '@/types/api';

export type WsHandler = (event: WsEvent) => void;
export type WsStateHandler = (state: WsConnectionState) => void;

export type WsConnectionState = 'connecting' | 'open' | 'closed' | 'error';

export interface WsClientOptions {
  path?: string;
  reconnectMinMs?: number;
  reconnectMaxMs?: number;
  heartbeatMs?: number;
}

class WsClient {
  private socket: WebSocket | null = null;
  private path: string;
  private reconnectMin: number;
  private reconnectMax: number;
  private heartbeatMs: number;
  private reconnectDelay: number;
  private heartbeatTimer?: number;
  private reconnectTimer?: number;
  private destroyed = false;
  private state: WsConnectionState = 'closed';

  private eventHandlers = new Set<WsHandler>();
  private stateHandlers = new Set<WsStateHandler>();

  // PERFORMANCE_AUDIT P2-#15:
  //   25s 心跳 → 10s, 加 pong 等待超时 (12s 没收 pong 就主动 close 重连),
  //   死连接检测从 25-50s → 10-12s.
  private lastPongAt = 0;
  private pongCheckTimer?: number;

  constructor(opts: WsClientOptions = {}) {
    this.path = opts.path ?? '/ws/status';
    this.reconnectMin = opts.reconnectMinMs ?? 1000;
    this.reconnectMax = opts.reconnectMaxMs ?? 15000;
    this.heartbeatMs = opts.heartbeatMs ?? 10_000;
    this.reconnectDelay = this.reconnectMin;
  }

  connect(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.destroyed) return;
    this.setState('connecting');

    // 1) 优先用 VITE_WS_URL 绝对地址 (GK9000 直连场景: ws://192.168.124.11:3200/ws/status)
    // 2) fallback 用 page host + path (cnjinhu.top nginx 反代场景)
    const absUrl = import.meta.env.VITE_WS_URL as string | undefined;
    let url: string;
    if (absUrl && /^wss?:\/\//.test(absUrl)) {
      url = absUrl;
    } else {
      const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
      url = `${proto}://${window.location.host}${this.path}`;
    }

    try {
      const ws = new WebSocket(url);
      this.socket = ws;

      ws.onopen = () => {
        this.reconnectDelay = this.reconnectMin;
        this.setState('open');
        this.startHeartbeat();
      };

      ws.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data) as WsEvent;
          // pong 也走这条 — 收到任何消息都视为对端活着
          this.lastPongAt = Date.now();
          this.eventHandlers.forEach((h) => {
            try {
              h(event);
            } catch (err) {
              // eslint-disable-next-line no-console
              console.warn('ws handler error', err);
            }
          });
        } catch {
          // ignore non-JSON
        }
      };

      ws.onerror = () => {
        this.setState('error');
      };

      ws.onclose = () => {
        this.stopHeartbeat();
        this.setState('closed');
        if (!this.destroyed) this.scheduleReconnect();
      };
    } catch {
      this.scheduleReconnect();
    }
  }

  disconnect(): void {
    this.destroyed = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.stopHeartbeat();
    this.socket?.close();
    this.socket = null;
  }

  on(handler: WsHandler): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  onState(handler: WsStateHandler): () => void {
    this.stateHandlers.add(handler);
    handler(this.state);
    return () => this.stateHandlers.delete(handler);
  }

  getState(): WsConnectionState {
    return this.state;
  }

  private setState(s: WsConnectionState): void {
    this.state = s;
    this.stateHandlers.forEach((h) => h(s));
  }

  private scheduleReconnect(): void {
    if (this.destroyed) return;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = window.setTimeout(() => {
      this.connect();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.reconnectMax);
    }, this.reconnectDelay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.lastPongAt = Date.now();
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify({ event: 'ping' }));
        } catch {
          // ignore
        }
      }
    }, this.heartbeatMs);
    // pong 检测: 2× 心跳间隔没收到任何消息就认为死连接, 主动 close 触发重连
    this.pongCheckTimer = window.setInterval(() => {
      const since = Date.now() - this.lastPongAt;
      const limit = this.heartbeatMs * 2 + 2_000; // 默认 22s
      if (since > limit && this.socket && this.socket.readyState === WebSocket.OPEN) {
        // eslint-disable-next-line no-console
        console.warn(`ws no pong for ${since}ms, force reconnect`);
        try { this.socket.close(); } catch { /* ignore */ }
      }
    }, this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
    if (this.pongCheckTimer) {
      window.clearInterval(this.pongCheckTimer);
      this.pongCheckTimer = undefined;
    }
  }
}

export const wsClient = new WsClient({
  path: import.meta.env.VITE_WS_PATH ?? '/ws/status',
});
