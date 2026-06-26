import apiClient from './client';

export interface LoginRequest {
  name: string;
  password: string;
}

export interface AuthResponse {
  token: string;
  user_id: string;
  name: string;
}

export const authApi = {
  login: (data: LoginRequest) =>
    apiClient.post<AuthResponse>('/auth/login', data),

  register: (data: LoginRequest) =>
    apiClient.post<AuthResponse>('/auth/register', data),

  logout: () => apiClient.post('/auth/logout'),

  me: () => apiClient.get<{ user_id: string; user_name: string }>('/auth/me'),

  verify: () => apiClient.get('/auth/verify'),
};
