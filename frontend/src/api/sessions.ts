import apiClient from './client';
import type { Session } from '@/types/api';

export const sessionsApi = {
  list: () => apiClient.get<Session[]>('/sessions'),

  get: (id: string) =>
    apiClient.get<{ messages: Array<{ role: string; content: string }>; updated: string }>(
      `/sessions/${id}`
    ),

  save: (data: {
    id: string;
    title?: string;
    messages: Array<{ role: string; content: string }>;
  }) => apiClient.post('/sessions', data),

  delete: (id: string) => apiClient.delete(`/sessions/${id}`),

  search: (q: string, limit = 20, offset = 0) =>
    apiClient.get('/sessions/search', { params: { q, limit, offset } }),
};
