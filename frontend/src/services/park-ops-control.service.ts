import { api } from './http';

export interface ParkOpsControlState {
  page: number;
  autoPlay: boolean;
  timestamp: number;
  totalPages: number;
  refreshRequested: boolean;
  refreshTimestamp: number;
}

export const parkOpsControlService = {
  state: () =>
    api.get<ParkOpsControlState>('/park-ops-control/state', { params: { _: Date.now() } }),
  next: () => api.post<ParkOpsControlState>('/park-ops-control/next'),
  prev: () => api.post<ParkOpsControlState>('/park-ops-control/prev'),
  goto: (page: number) => api.post<ParkOpsControlState>('/park-ops-control/goto', { page }),
  setAuto: (enabled: boolean) =>
    api.post<ParkOpsControlState>('/park-ops-control/auto', { enabled }),
  refresh: () => api.post<ParkOpsControlState>('/park-ops-control/refresh'),
};
