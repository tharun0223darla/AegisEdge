import { ROUTES } from '@/constants/app';
import type { UserRole } from '@/types/auth';

export function homeRouteForRole(role?: UserRole | null): string {
  switch (role) {
    case 'CAREGIVER':
      return ROUTES.CARE;
    case 'ADMIN':
      return ROUTES.ADMIN_MEDICINE_REVIEWS;
    case 'DOCTOR':
      return ROUTES.SETTINGS;
    case 'PATIENT':
    default:
      return ROUTES.DASHBOARD;
  }
}

export function isSwitchableAccountRole(
  role?: UserRole | null,
): role is 'PATIENT' | 'CAREGIVER' {
  return role === 'PATIENT' || role === 'CAREGIVER';
}
