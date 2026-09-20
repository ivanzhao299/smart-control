import { api } from './http';

export type TestFlightEffectiveStatus = 'PENDING' | 'EXPIRED' | 'ACCEPTED' | 'FAILED';

export interface TestFlightTester {
  id: number;
  appleInvitationId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  appId: string;
  status: 'PENDING' | 'ACCEPTED' | 'FAILED';
  effectiveStatus: TestFlightEffectiveStatus;
  expirationDate: string | null;
  lastError: string | null;
  invitedBy: string | null;
  invitedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TestFlightBuild {
  id: string;
  version: string;
  build: string;
  processingState: string;
  uploadedDate: string | null;
  expired: boolean;
  expirationDate: string | null;
  daysRemaining: number | null;
  state: 'VALID' | 'PROCESSING' | 'EXPIRED' | 'UNKNOWN';
}

export type RenewalStage =
  | 'idle'
  | 'dispatching'
  | 'queued'
  | 'building'
  | 'uploading'
  | 'processing'
  | 'succeeded'
  | 'failed';

export interface TestFlightRenewal {
  configured: boolean;
  repository: string;
  workflow: string;
  ref: string;
  status: 'idle' | 'running' | 'succeeded' | 'failed';
  stage: RenewalStage;
  message: string;
  startedAt: string | null;
  updatedAt: string | null;
  finishedAt: string | null;
  fromBuild: string | null;
  targetBuild: string | null;
  runId: number | null;
  runUrl: string | null;
  error: string | null;
}

export interface TestFlightOverview {
  configured: boolean;
  enabled: boolean;
  keyId: string;
  issuerId: string;
  appId: string;
  bundleId: string;
  testerRole: string;
  internalGroupName: string;
  app: { id: string; name: string; bundleId: string } | null;
  internalGroup: { id: string; name: string } | null;
  latestBuild: TestFlightBuild | null;
  renewal: { configured: boolean; repository: string; workflow: string; ref: string };
  counts: { total: number; pending: number; accepted: number; failed: number };
  error: string | null;
}

export interface InviteTesterPayload {
  email: string;
  firstName: string;
  lastName: string;
}

export interface InviteTesterResult {
  state: 'invited' | 'pending' | 'accepted';
  tester: TestFlightTester;
}

export interface ResendTesterResult {
  /** invited=已重新发起；accepted=已是团队成员；pending=原邀请仍有效（无权撤销，见 notice） */
  state: 'invited' | 'accepted' | 'pending';
  tester: TestFlightTester;
  /** state=pending 时的引导说明（App Manager 密钥无权撤销团队邀请） */
  notice?: string;
}

/** 与 App Store Connect 单向对账结果 */
export interface TestFlightSyncResult {
  syncedAt: string;
  accepted: number;
  pending: number;
  imported: string[];
  totalLocal: number;
  throttled: boolean;
}

export const testflightService = {
  /** 配置/密钥状态 + App、内部组、最新构建 + 计数 */
  overview: () => api.get<TestFlightOverview>('/testflight/overview'),
  /** 邀请记录列表（进页面后端自动与 App Store Connect 对账一次，60s 节流） */
  testers: () => api.get<TestFlightTester[]>('/testflight/testers'),
  /** 手动强制与 App Store Connect 同步（绕过节流） */
  sync: () => api.post<TestFlightSyncResult>('/testflight/sync'),
  /** 查询一键续期任务状态（触发后轮询） */
  renewal: () => api.get<TestFlightRenewal>('/testflight/renewal'),
  /** 一键续期：触发 GitHub Actions 重新签名归档并上传新 TestFlight build */
  renew: () => api.post<TestFlightRenewal>('/testflight/renew'),
  /** 邀请内部测试员（幂等：已邀请/已接受直接回到对应状态） */
  invite: (payload: InviteTesterPayload) =>
    api.post<InviteTesterResult>('/testflight/testers', payload),
  /** 重发邀请 */
  resend: (id: number) => api.post<ResendTesterResult>(`/testflight/testers/${id}/resend`),
};
