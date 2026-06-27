import apiClient from './client';
import type { Project } from '@/types/workspace';

export const projectsApi = {
  list: (workspaceId: string) =>
    apiClient.get<Project[]>(`/w/${workspaceId}/projects`),

  create: (workspaceId: string, data: { name: string; description?: string }) =>
    apiClient.post<{ id: string; name: string; status: string }>(
      `/w/${workspaceId}/projects`,
      data
    ),

  get: (id: string) => apiClient.get<Project>(`/projects/${id}`),

  delete: (id: string) => apiClient.delete(`/projects/${id}`),

  getAgentConfig: (projectId: string) =>
    apiClient.get<{ enabled_agents: string[]; disabled_agents: string[]; always_on: string[] }>(`/projects/${projectId}/agent-config`),

  updateAgentConfig: (projectId: string, enabled_agents: string[]) =>
    apiClient.put<{ status: string; enabled_agents: string[] }>(`/projects/${projectId}/agent-config`, { enabled_agents }),
};
