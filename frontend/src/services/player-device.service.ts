import { absUrl } from './http';
import type { PlaybackChannelView } from '@/types/api';

export type PlayerDeviceState = PlaybackChannelView & { playbackSession: string };
const key = (slot: number) => `sc.player.credential:${absUrl('/api')}:${slot}`;
export function configurePlayer(slot: number, token: string): void {
  const value = token.trim();
  if (value.length < 32 || value.length > 512) throw new Error('设备凭据长度无效');
  sessionStorage.setItem(key(slot), value);
}
export function hasPlayerCredential(slot: number): boolean { return !!sessionStorage.getItem(key(slot)); }

async function request<T>(slot: number, action: string, body?: unknown): Promise<T> {
  const token = sessionStorage.getItem(key(slot));
  if (!token) throw new Error('请配置此通道的设备凭据');
  const response = await fetch(absUrl(`/api/player-device/${slot}/${action}`), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-Player-Token': token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store', credentials: 'omit', redirect: 'error', referrerPolicy: 'no-referrer',
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? '设备授权无效，请联系管理员' : '播放状态暂不可用');
  return (await response.json()).data as T;
}
export const getPlayerState = (slot: number) => request<PlayerDeviceState>(slot, 'state');
export const playerHeartbeat = (slot: number) => request<null>(slot, 'heartbeat', {});
export const playerAdvance = (slot: number, playbackSession: string) => request<PlayerDeviceState>(slot, 'advance', { playbackSession });
