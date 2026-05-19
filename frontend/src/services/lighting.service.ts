import { api } from './http';
import type { AdapterResult } from '@/types/api';

export const lightingService = {
  zoneOn: (zoneId: number) =>
    api.post<AdapterResult>(`/lighting/zone/${zoneId}/on`),
  zoneOff: (zoneId: number) =>
    api.post<AdapterResult>(`/lighting/zone/${zoneId}/off`),
  setBrightness: (zoneId: number, value: number) =>
    api.post<AdapterResult>(`/lighting/zone/${zoneId}/brightness`, { value }),
};
