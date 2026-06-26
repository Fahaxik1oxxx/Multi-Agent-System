import { create } from 'zustand';
import type { User } from '@/types/user';

interface AuthStore {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  setAuth: (token: string, user: User) => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  token: localStorage.getItem('auth_token'),
  user: null,
  isLoading: true,
  setAuth: (token, user) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('mc_uname', user.user_name);
    set({ token, user, isLoading: false });
  },
  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('mc_uname');
    set({ token: null, user: null, isLoading: false });
  },
  setLoading: (isLoading) => set({ isLoading }),
}));
