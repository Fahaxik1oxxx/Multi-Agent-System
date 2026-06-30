import apiClient from './client';

export interface UserProfile {
  user_id: string;
  user_name: string;
  is_admin: boolean;
  created_at: string;
  avatar_seed: string;
  bio: string;
  email: string;
}

export const userApi = {
  getProfile: () =>
    apiClient.get<UserProfile>('/user/profile'),

  updateProfile: (data: {
    name?: string;
    password?: string;
    bio?: string;
    email?: string;
    avatar_seed?: string;
  }) =>
    apiClient.put('/user/profile', data),

  getConfig: () =>
    apiClient.get<{ roles: Record<string, string>; models: any[]; system_models: any[] }>(
      '/user/config'
    ),

  getApiKeyStatus: () =>
    apiClient.get<{ has_custom_key: boolean; key_prefix: string }>(
      '/user/api-key'
    ),

  saveApiKey: (api_key: string) =>
    apiClient.put('/user/api-key', { api_key }),

  deleteApiKey: () => apiClient.delete('/user/api-key'),

  addCustomModel: (data: { key: string; model: string; base_url: string; api_key: string }) =>
    apiClient.post('/user/custom-models', data),

  deleteCustomModel: (key: string) =>
    apiClient.delete(`/user/custom-models/${key}`),
};
