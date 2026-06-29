import { useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { authApi } from '@/api/auth';

export function useAuth() {
  const { token, user, isLoading, isGuest, setAuth, logout, setLoading, enterGuest } = useAuthStore();

  useEffect(() => {
    if (!token) {
      // 如果有游客标记则自动进入游客模式，否则只是无登录状态
      if (isGuest) {
        // 已经标记为游客，无需额外操作
        setLoading(false);
      } else {
        setLoading(false);
      }
      return;
    }
    authApi
      .me()
      .then((res) => {
        setAuth(token, {
          user_id: res.data.user_id,
          user_name: res.data.user_name,
          is_admin: false,
        });
      })
      .catch(() => {
        logout();
      });
  }, []);

  return { user, isLoading, isAuthenticated: !!token && !!user, isGuest, logout };
}
