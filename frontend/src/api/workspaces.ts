import apiClient from './client';
import type { Workspace, WorkspaceMember } from '@/types/workspace';

export const workspacesApi = {
  list: () => apiClient.get<Workspace[]>('/workspaces'),

  create: (data: { name: string; description?: string }) =>
    apiClient.post<{ id: string; name: string; status: string }>('/workspaces', data),

  get: (id: string) =>
    apiClient.get<Workspace & { members: WorkspaceMember[]; my_role: string }>(
      `/workspaces/${id}`
    ),

  update: (id: string, data: { name?: string; description?: string; is_public?: number }) =>
    apiClient.put(`/workspaces/${id}`, data),

  delete: (id: string) => apiClient.delete(`/workspaces/${id}`),

  invite: (id: string, data: { user_name: string; role: string }) =>
    apiClient.post(`/workspaces/${id}/members`, data),

  removeMember: (workspaceId: string, userId: string) =>
    apiClient.delete(`/workspaces/${workspaceId}/members/${userId}`),
};
