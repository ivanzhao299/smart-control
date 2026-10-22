import { api } from './http';
import type { AdapterResult } from '@/types/api';

export type LedInput = 'HDMI1' | 'HDMI2' | 'welcome' | 'video';

export const ledService = {
  on: (id: string) => api.post<AdapterResult>(`/led/${id}/on`),
  off: (id: string) => api.post<AdapterResult>(`/led/${id}/off`),
  play: (id: string, media?: string) =>
    api.post<AdapterResult>(`/led/${id}/play`, { media }),
  welcome: (id: string) => api.post<AdapterResult>(`/led/${id}/welcome`),
  switchInput: (id: string, input: LedInput, operationId?: string) =>
    api.post<AdapterResult>(`/led/${id}/input`, { input }, {
      headers: operationId ? { 'X-Operation-Id': operationId } : undefined,
    }),
};
