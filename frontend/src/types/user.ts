export interface User {
  user_id: string;
  user_name: string;
  is_admin: boolean;
}

export interface AuthState {
  token: string | null;
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}
