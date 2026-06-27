import apiClient from './client';

export interface AdminUser {
  id: string;
  name: string;
  is_admin: number;
  created_at: string;
}

export const adminApi = {
  listUsers: () => apiClient.get<AdminUser[]>('/admin/users'),
  toggleAdmin: (userId: string, isAdmin: boolean) =>
    apiClient.put<{ status: string }>(`/admin/users/${userId}/admin`, { is_admin: isAdmin }),
};
