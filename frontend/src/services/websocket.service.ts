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

  constructor(opts: WsClientOptions = {}) {
    this.path = opts.path ?? '/ws/status';
    this.reconnectMin = opts.reconnectMinMs ?? 1000;
    this.reconnectMax = opts.reconnectMaxMs ?? 15000;
    this.heartbeatMs = opts.heartbeatMs ?? 25000;
    this.reconnectDelay = this.reconnectMin;
  }

  connect(): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return;
    if (this.destroyed) return;
    this.setState('connecting');

    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${window.location.host}${this.path}`;

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
    this.heartbeatTimer = window.setInterval(() => {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) {
        try {
          this.socket.send(JSON.stringify({ event: 'ping' }));
        } catch {
          // ignore
        }
      }
    }, this.heartbeatMs);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      window.clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }
}

export const wsClient = new WsClient({
  path: import.meta.env.VITE_WS_PATH ?? '/ws/status',
});
