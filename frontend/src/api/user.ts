import apiClient from './client';

export const userApi = {
  getProfile: () =>
    apiClient.get<{ user_id: string; user_name: string; is_admin: boolean }>(
      '/user/profile'
    ),

  updateProfile: (data: { name?: string; password?: string }) =>
    apiClient.put('/user/profile', data),

  getApiKeyStatus: () =>
    apiClient.get<{ has_custom_key: boolean; key_prefix: string }>(
      '/user/api-key'
    ),

  saveApiKey: (api_key: string) =>
    apiClient.put('/user/api-key', { api_key }),

  deleteApiKey: () => apiClient.delete('/user/api-key'),
};
