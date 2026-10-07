import { absUrl } from './http';
import type { PlaybackChannelView } from '@/types/api';

export type PlayerDeviceState = PlaybackChannelView & { playbackSession: string };
const key = (slot: number) => `sc.player.credential:${absUrl('/api')}:${slot}`;
export function configurePlayer(slot: number, token: string, rememberDevice = false): void {
  const value = token.trim();
  if (value.length < 32 || value.length > 512) throw new Error('设备凭据长度无效');
  // Opt-in only for the dedicated kiosk profile. Personal browsers stay session-only.
  if (rememberDevice) localStorage.setItem(key(slot), value);
  else localStorage.removeItem(key(slot));
  sessionStorage.setItem(key(slot), value);
}
function playerCredential(slot: number): string | null {
  return sessionStorage.getItem(key(slot)) || localStorage.getItem(key(slot));
}
export function hasPlayerCredential(slot: number): boolean { return !!playerCredential(slot); }
export function playerSocketAuthentication(slot: number) {
  const token = playerCredential(slot);
  return token ? { event: 'authenticate_player', data: { token, slot } } : null;
}

async function request<T>(slot: number, action: string, body?: unknown): Promise<T> {
  const token = playerCredential(slot);
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
export const playerHeartbeat = (slot: number, payload?: unknown) =>
  request<null>(slot, 'heartbeat', payload ?? {});
export const playerAdvance = (slot: number, playbackSession: string) => request<PlayerDeviceState>(slot, 'advance', { playbackSession });
