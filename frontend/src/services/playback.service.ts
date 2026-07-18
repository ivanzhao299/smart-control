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

// ============ 播放列表 / 历史 / 上下曲 (2026-07-17) ============
// 业主: "平时经常播放的内容应该在播放列表里面, 随时可以切换... 可以更改文件名字"
//       "媒体文件夹内容默认不加入播放列表, 需经管理员确认后再手工加入"

export interface PlaylistItemView {
  id: number;
  mediaId: number;
  /** 业主起的别名; 空则是媒体原名 */
  title: string;
  sortOrder: number;
  kind: string | null;
  durationSec: number | null;
  /** 媒体已被删 —— 仍然列出来, 让业主看得到并能删掉它, 而不是默默藏起来 */
  missing: boolean;
}

export interface PlaybackHistoryView {
  mediaId: number;
  mediaName: string;
  playedAt: string;
  missing: boolean;
}

export const listPlaylist = (slot: number) =>
  api.get<PlaylistItemView[]>(`/playback/playlist/${slot}`);

/** 加入播放列表 —— 只能人工触发 (媒体库内容默认不进列表) */
export const addToPlaylist = (slot: number, mediaId: number, title?: string) =>
  api.post<{ id: number }>(`/playback/playlist/${slot}`, { mediaId, title });

/** 改别名 —— 只改列表显示名, 不动媒体库原文件 */
export const renamePlaylistItem = (id: number, title: string) =>
  api.put<{ id: number; title: string }>(`/playback/playlist/item/${id}`, { title });

export const removeFromPlaylist = (id: number) =>
  api.del<{ id: number }>(`/playback/playlist/item/${id}`);

export const reorderPlaylist = (slot: number, ids: number[]) =>
  api.put<{ count: number }>(`/playback/playlist/${slot}/reorder`, { ids });

export const listHistory = (slot: number) =>
  api.get<PlaybackHistoryView[]>(`/playback/history/${slot}`);

/** 上一个 / 下一个 — 在播放列表里环形切换 */
export const nextInPlaylist = (slot: number) =>
  api.post<PlaybackChannelView>(`/playback/channels/${slot}/next`);
export const prevInPlaylist = (slot: number) =>
  api.post<PlaybackChannelView>(`/playback/channels/${slot}/prev`);

/** 设背景音乐播放模式 (顺序/单曲/列表/随机) — 存后端, bgm-player 播完 advance 时读它 */
export const setChannelPlayMode = (slot: number, mode: 'seq' | 'loop1' | 'loopAll' | 'shuffle') =>
  api.post<PlaybackChannelView>(`/playback/channels/${slot}/play-mode`, { mode });
