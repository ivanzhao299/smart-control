import axios, { type AxiosProgressEvent } from 'axios';

const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export interface MediaItem {
  id: number;
  originalName: string;
  kind: 'video' | 'image';
  mimeType: string;
  sizeBytes: number;
  durationSec: number | null;
  resolution: string | null;
  remark: string | null;
  uploader: string;
  thumbUrl: string | null;
  fileUrl: string;
  lastPlayedAt: string | null;
  createdAt: string;
}

interface ListResult { items: MediaItem[]; total: number }

export const mediaService = {
  async list(opts: { kind?: 'video' | 'image' } = {}): Promise<ListResult> {
    const params: Record<string, string> = {};
    if (opts.kind) params.kind = opts.kind;
    const r = await axios.get(`${baseURL}/media`, { params });
    return r.data?.data ?? { items: [], total: 0 };
  },

  /** 上传, 支持 progress 回调 */
  async upload(
    file: File,
    opts: { remark?: string; onProgress?: (pct: number) => void } = {},
  ): Promise<MediaItem> {
    const fd = new FormData();
    fd.append('file', file);
    if (opts.remark) fd.append('remark', opts.remark);
    const r = await axios.post(`${baseURL}/media/upload`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 30 * 60 * 1000, // 30 分钟 (大视频)
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      onUploadProgress: (e: AxiosProgressEvent) => {
        if (e.total && opts.onProgress) {
          opts.onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    });
    if (!r.data?.data) throw new Error(r.data?.message || '上传失败');
    return r.data.data;
  },

  async remove(id: number): Promise<void> {
    await axios.delete(`${baseURL}/media/${id}`);
  },

  async publish(id: number): Promise<{ id: number; name: string; player: string }> {
    const r = await axios.post(`${baseURL}/media/${id}/publish`);
    if (!r.data?.data) throw new Error(r.data?.message || '推送失败');
    return r.data.data;
  },

  fileUrl(id: number): string {
    return `${baseURL}/media/${id}/file`;
  },
};
