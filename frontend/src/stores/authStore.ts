import { create } from 'zustand';
import type { User } from '@/types/user';

const GUEST_KEY = 'guest_mode';

interface AuthStore {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  isGuest: boolean;
  setAuth: (token: string, user: User) => void;
  enterGuest: () => void;
  exitGuest: () => void;
  logout: () => void;
  setLoading: (loading: boolean) => void;
}

export const useAuthStore = create<AuthStore>((set) => ({
  token: localStorage.getItem('auth_token'),
  user: null,
  isLoading: true,
  isGuest: sessionStorage.getItem(GUEST_KEY) === 'true',

  setAuth: (token, user) => {
    localStorage.setItem('auth_token', token);
    localStorage.setItem('mc_uname', user.user_name);
    sessionStorage.removeItem(GUEST_KEY);
    set({ token, user, isLoading: false, isGuest: false });
  },

  enterGuest: () => {
    sessionStorage.setItem(GUEST_KEY, 'true');
    set({ token: null, user: null, isGuest: true, isLoading: false });
  },

  exitGuest: () => {
    sessionStorage.removeItem(GUEST_KEY);
    sessionStorage.removeItem('guest_messages');
    sessionStorage.removeItem('guest_session_id');
    set({ isGuest: false, isLoading: false });
  },

  logout: () => {
    localStorage.removeItem('auth_token');
    localStorage.removeItem('mc_uname');
    sessionStorage.removeItem(GUEST_KEY);
    sessionStorage.removeItem('guest_messages');
    sessionStorage.removeItem('guest_session_id');
    set({ token: null, user: null, isLoading: false, isGuest: false });
  },

  setLoading: (isLoading) => set({ isLoading }),
}));
