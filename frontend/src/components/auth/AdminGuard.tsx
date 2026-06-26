import { Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';

export function AdminGuard({ children }: { children: React.ReactNode }) {
  const { user } = useAuthStore();

  if (!user?.is_admin) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
