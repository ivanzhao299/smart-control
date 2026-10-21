import { api } from './http';

/**
 * 设备「应用层就绪」探活 — 开机预热时前端轮询（方案 A）。
 *
 * 后端每次只做一次应用层探活（诺瓦 ReadDeviceID / 融合器 version），不做全量探测；
 * 前端在预热窗口每 3~5s 轮询一次，低频、不影响后台采集。
 */
export const deviceReadyService = {
  /** LED 视频服务器（诺瓦）是否就绪：GET /led/ready。 */
  led: () => api.get<{ ready: boolean }>('/led/ready').then((r) => r.ready),
  /** 投影视频融合器是否就绪：GET /projector/ready。 */
  projector: () => api.get<{ ready: boolean }>('/projector/ready').then((r) => r.ready),
};
