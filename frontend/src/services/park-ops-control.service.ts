import { api } from './http';

export interface ControlClaimInfo {
  ownerId: string;
  ownerName: string;
  claimedAt: number;
  lastActiveAt: number;
  remainingMs: number;
}

export interface ParkOpsControlState {
  page: number;
  autoPlay: boolean;
  timestamp: number;
  totalPages: number;
  refreshRequested: boolean;
  refreshTimestamp: number;
  claimed: boolean;
  claim: ControlClaimInfo | null;
}

const OWNER_ID_KEY = 'park_ops_owner_id';

/** 本客户端的稳定标识：首次访问生成并持久化，作为接管大屏的 ownerId。 */
export function getParkOpsOwnerId(): string {
  const fallback = `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  try {
    let id = localStorage.getItem(OWNER_ID_KEY);
    if (!id) {
      id = fallback;
      localStorage.setItem(OWNER_ID_KEY, id);
    }
    return id;
  } catch {
    return fallback;
  }
}

export const parkOpsControlService = {
  state: () =>
    api.get<ParkOpsControlState>('/park-ops-control/state', { params: { _: Date.now() } }),
  claim: (ownerName?: string) =>
    api.post<ParkOpsControlState>('/park-ops-control/claim', {
      ownerId: getParkOpsOwnerId(),
      ownerName,
    }),
  release: () =>
    api.post<ParkOpsControlState>('/park-ops-control/release', {
      ownerId: getParkOpsOwnerId(),
    }),
  next: () =>
    api.post<ParkOpsControlState>('/park-ops-control/next', { ownerId: getParkOpsOwnerId() }),
  prev: () =>
    api.post<ParkOpsControlState>('/park-ops-control/prev', { ownerId: getParkOpsOwnerId() }),
  goto: (page: number) =>
    api.post<ParkOpsControlState>('/park-ops-control/goto', {
      page,
      ownerId: getParkOpsOwnerId(),
    }),
  setAuto: (enabled: boolean) =>
    api.post<ParkOpsControlState>('/park-ops-control/auto', {
      enabled,
      ownerId: getParkOpsOwnerId(),
    }),
  refresh: () => api.post<ParkOpsControlState>('/park-ops-control/refresh'),
};
