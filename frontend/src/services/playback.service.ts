import { api } from './http';
import type { PlaybackChannelView } from '@/types/api';

/**
 * 播控通道 API.
 *
 * - GET /channels — 拿所有通道 (slot=1 LED, slot=2 投影), 公开
 * - GET /channels/:slot — 拿一个 (PlayerPage 启动时按 ?slot=N 拉)
 * - POST /channels/:slot/publish — 推媒体上去, 要 admin token
 * - POST /channels/:slot/stop — 切回待机, 要 admin token
 * - POST /channels/:slot/heartbeat — PlayerPage kiosk 心跳, 公开
 */

export type LoopMode = 'once' | 'loop';

export async function listChannels(): Promise<PlaybackChannelView[]> {
  return api.get<PlaybackChannelView[]>('/playback/channels');
}

export async function getChannel(slot: number): Promise<PlaybackChannelView> {
  return api.get<PlaybackChannelView>(`/playback/channels/${slot}`);
}

// 默认循环 —— 展厅大屏播一遍就停等于没人看的时候黑屏
export async function publishToChannel(slot: number, mediaId: number, loopMode: LoopMode = 'loop'): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/publish`, { mediaId, loopMode });
}

export async function stopChannel(slot: number): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/stop`, null);
}

export async function pauseChannel(slot: number): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/pause`, null);
}

export async function resumeChannel(slot: number): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/resume`, null);
}

export async function channelHeartbeat(slot: number): Promise<void> {
  await api.post<null>(`/playback/channels/${slot}/heartbeat`, null);
}
