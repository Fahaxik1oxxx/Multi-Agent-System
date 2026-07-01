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
    apiClient.get<{ pipeline: any; enabled_agents: string[]; disabled_agents: string[] }>(`/projects/${projectId}/agent-config`),

  updateAgentConfig: (projectId: string, data: any) => {
    if (Array.isArray(data)) {
      return apiClient.put<{ status: string }>(`/projects/${projectId}/agent-config`, { enabled_agents: data });
    }
    if (data && 'agent_states' in data) {
      const payload: any = { agent_states: data.agent_states };
      if (data.pipeline) {
        payload.pipeline = data.pipeline;
      }
      return apiClient.put<{ status: string }>(`/projects/${projectId}/agent-config`, payload);
    }
    return apiClient.put<{ status: string }>(`/projects/${projectId}/agent-config`, { pipeline: data });
  },
};

export const configsApi = {
  list: (projectId?: string) =>
    apiClient.get('/configs', { params: projectId ? { project_id: projectId } : {} }),

  get: (id: string) =>
    apiClient.get(`/configs/${id}`),

  create: (data: { name: string; agents: string[]; project_id?: string; pipeline?: any; prompts?: Record<string, string> }) =>
    apiClient.post('/configs', data),

  update: (id: string, data: Record<string, any>) =>
    apiClient.put(`/configs/${id}`, data),

  delete: (id: string) =>
    apiClient.delete(`/configs/${id}`),

  publish: (id: string) =>
    apiClient.post(`/configs/${id}/publish`),

  unpublish: (id: string) =>
    apiClient.post(`/configs/${id}/unpublish`),

  export: (id: string) =>
    apiClient.get(`/configs/${id}/export`, { responseType: 'blob' }),
};

export const marketApi = {
  list: (search?: string) =>
    apiClient.get('/market', { params: search ? { search } : {} }),

  get: (id: string) =>
    apiClient.get(`/market/${id}`),

  copy: (id: string) =>
    apiClient.post(`/market/${id}/copy`),
};
