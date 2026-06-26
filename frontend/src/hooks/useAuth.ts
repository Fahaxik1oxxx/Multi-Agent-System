import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';

export function useAuth() {
  const { token, user, isLoading, setAuth, logout, setLoading } = useAuthStore();

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    authApi
      .me()
      .then((res) => {
        setAuth(token, {
          user_id: res.data.user_id,
          user_name: res.data.user_name,
          is_admin: false, // me() 不返回 is_admin, 需要额外请求
        });
      })
      .catch(() => {
        logout();
      });
  }, []);

  return { user, isLoading, isAuthenticated: !!token && !!user, logout };
}
