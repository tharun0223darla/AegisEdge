import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '@/store/auth.store';
import { ROUTES } from '@/constants/app';
import type { UserRole } from '@/types/auth';
import { homeRouteForRole } from '@/lib/role-navigation';

interface ProtectedRouteProps {
  roles?: UserRole[];
}

export function ProtectedRoute({ roles }: ProtectedRouteProps) {
  const location = useLocation();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace state={{ from: location }} />;
  }

  if (roles?.length && (!user || !roles.includes(user.role))) {
    return <Navigate to={homeRouteForRole(user?.role)} replace />;
  }

  return <Outlet />;
}
