import { api, HttpError } from './http';
import { mediaService } from './media.service';
import { assertCurrentIdentity, identityGeneration } from './identity-boundary';
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

export async function stopChannel(slot: number, expectedSession?: string): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/stop`, expectedSession ? { expectedSession } : null);
}

/** 欢迎页一键投放: editable=动态欢迎页(称谓后台可编辑) / default=本屏内置静态欢迎图 */
export type WelcomeVariant = 'editable' | 'default';
export async function publishWelcome(slot: number, variant: WelcomeVariant): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/welcome`, { variant });
}

/** 一键投放内置园区智慧运营大屏，不依赖环境里的媒体数字 ID。 */
export async function publishParkDashboard(slot: number): Promise<PlaybackChannelView> {
  const generation = identityGeneration();
  try {
    return await api.post<PlaybackChannelView>(`/playback/channels/${slot}/park-dashboard`, null);
  } catch (error) {
    assertCurrentIdentity(generation);
    if (!(error instanceof HttpError) || error.status !== 404) throw error;

    // 现场前后端可能按零停机方式错峰切换。旧后端还没有专用快捷接口时，
    // 用既有媒体列表 + 通道投放接口完成同一动作；仍按稳定名称定位，不写死数据库 ID。
    const name = '金湖科创产业园·智慧运营总览(DEMO)';
    const result = await mediaService.list({
      kind: 'webpage', scope: 'shared', keyword: name, limit: 100,
    });
    assertCurrentIdentity(generation);
    const asset = result.items.find((item) => item.originalName === name);
    if (!asset) throw new Error(`媒体库里找不到内置素材「${name}」`);
    return publishToChannel(slot, asset.id, 'loop');
  }
}

export async function pauseChannel(slot: number): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/pause`, null);
}

export async function resumeChannel(slot: number): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/resume`, null);
}

export type DisplayFit = 'fill' | 'contain' | 'cover';

/** 画面铺放模式 (fill/contain/cover) — 后端持久 + WS 广播 kiosk 即时生效 */
export async function setDisplayFit(slot: number, fit: DisplayFit): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/display-fit`, { fit });
}

/** 文档翻页 (2026-07-25 文档投屏) */
export async function setDocPage(slot: number, page: number, expectedSession: string): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/doc-page`, { page, expectedSession });
}

/** 文档画面缩放 (2026-07-29): 100=铺满, 50-200; PPT 放映窗口/kiosk PDF 都跟随 */
export async function setDocZoom(slot: number, zoom: number, expectedSession: string): Promise<PlaybackChannelView> {
  return api.post<PlaybackChannelView>(`/playback/channels/${slot}/doc-zoom`, { zoom, expectedSession });
}

export async function channelHeartbeat(slot: number): Promise<void> {
  await api.post<null>(`/playback/channels/${slot}/heartbeat`, null);
}

// ============ 播放列表 / 历史 / 上下曲 (2026-07-17) ============
// 业主: "平时经常播放的内容应该在播放列表里面, 随时可以切换... 可以更改文件名字"
//       "媒体文件夹内容默认不加入播放列表, 需经管理员确认后再手工加入"

export interface PlaylistItemView {
  id: number;
  ownerUserId: number | null;
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
  api.get<PlaylistItemView[]>(`/playback/playlist/${slot}?scope=visible`);

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
