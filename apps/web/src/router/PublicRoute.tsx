import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { homeRouteForRole } from '@/lib/role-navigation';

interface LocationState {
  from?: {
    pathname?: string;
  };
}

export function PublicRoute() {
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const from =
    (location.state as LocationState | null)?.from?.pathname ??
    homeRouteForRole(user?.role);

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  return <Outlet />;
}
