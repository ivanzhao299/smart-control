import { api } from './http';
import type { Paged, Scene, SceneExecution, SceneSummary } from '@/types/api';

export const sceneService = {
  list: () => api.get<Paged<SceneSummary>>('/scenes', { params: { pageSize: 100 } }),
  detail: (id: number) => api.get<Scene>(`/scenes/${id}`),
  execute: (code: string) => api.post<SceneExecution>(`/scenes/${code}/execute`),
  stop: (code: string) => api.post<SceneExecution>(`/scenes/${code}/stop`),
  running: () => api.get<SceneExecution[]>('/scenes/runtime/running'),
};
