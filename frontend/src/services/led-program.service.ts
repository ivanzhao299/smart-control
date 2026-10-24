import { api, getApiBaseURL, getClientToken, getAdminToken } from './http';

export interface LedProgramListItem {
  id: number;
  name: string;
  fileSize: number;
  md5: string;
  cycles: number;
  fps: number;
  durationS: number;
  createdBy: string;
  createdAt: string;
  segments?: Array<{ type: string; text?: string | null; template?: string | null }>;
}

export interface LedProgramIngestResult {
  program: LedProgramListItem;
  md5: string;
  frames: number;
  pushed: boolean;
  pushMsg?: string;
}

export interface LedProgramStatus {
  reachable: boolean;
  detail?: Record<string, unknown>;
  error?: string;
  base?: string;
}

/**
 * LED 节目制作 API：
 *  - ingest: 浏览器端生成的 bin（Uint8Array）multipart 上传入库
 *  - push:   后端按 id 把 bin 转发 PVE receiver 触发推流
 *  - status: PVE receiver 探活
 *  - history: 最近节目登记
 */
export const ledProgramService = {
  async ingest(
    binBytes: Uint8Array,
    fileName: string,
    segments: Array<{ type: string; text?: string; template?: string; color?: string; durationMs?: number }>,
    extra?: { name?: string; templateType?: string },
  ): Promise<LedProgramIngestResult> {
    const fd = new FormData();
    const blob = new Blob([binBytes as BlobPart], { type: 'application/octet-stream' });
    fd.append('file', blob, fileName);
    fd.append('meta', JSON.stringify({
      name: extra?.name || fileName.replace(/\.bin$/i, ''),
      segments,
      autoPush: false,
      cycles: 1,
      fps: 25,
      templateType: extra?.templateType || 'custom',
    }));
    const headers: Record<string, string> = {};
    const adminTok = getAdminToken();
    const clientTok = getClientToken();
    if (adminTok) headers['Authorization'] = `Bearer ${adminTok}`;
    if (clientTok) headers['X-Client-Token'] = clientTok;
    // 注意：不手动 set Content-Type，交给浏览器为 FormData 自动带 boundary。
    const res = await fetch(`${getApiBaseURL()}/led-program/ingest`, {
      method: 'POST',
      headers,
      body: fd,
    });
    const json = (await res.json().catch(() => ({}))) as { message?: string; data?: LedProgramIngestResult; error?: string };
    if (!res.ok || !json.data) {
      throw new Error(json.error || json.message || `上传失败 HTTP ${res.status}`);
    }
    return json.data;
  },

  push: (id: number) =>
    api.post<{ ok: boolean; msg?: string }>(`/led-program/${id}/push`),

  status: () => api.get<LedProgramStatus>('/led-program/status'),

  history: () => api.get<LedProgramListItem[]>('/led-program/history'),

  templates: () => api.get<Array<{ type: string; name: string; description: string; segments: any[] }>>('/led-program/templates'),

  festivalToday: () => api.get<{ templateType: string | null; isFestival: boolean }>('/led-program/festival/today'),

  // 全年播放日历计划
  yearCalendar: (year: number) => api.get<{ year: number; days: Array<{ date: string; month: number; day: number; weekday: number; isWeekend: boolean; templateType: string; label: string }> }>(`/led-program/calendar/${year}`),

  // PVE 主机电源控制
  pvePowerStatus: () => api.get<{ online: boolean; method: string }>('/led-program/pve-power/status'),
  pveWake: () => api.post<{ ok: boolean; message: string }>('/led-program/pve-power/wake'),
  pveShutdown: () => api.post<{ ok: boolean; message: string }>('/led-program/pve-power/shutdown'),

  // 节目重命名
  rename: (id: number, name: string) => api.post(`/led-program/${id}/rename`, { name }),
};
