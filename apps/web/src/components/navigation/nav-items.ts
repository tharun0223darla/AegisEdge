import {
  LayoutDashboard,
  Pill,
  CalendarClock,
  ClipboardList,
  Bell,
  DatabaseZap,
  ReceiptText,
  PackageSearch,
  ScanLine,
  BarChart3,
  UsersRound,
  ShieldAlert,
  ShieldCheck,
  Settings,
  FileText,
  Building2,
  Siren,
  Syringe,
  type LucideIcon,
} from 'lucide-react';
import { ROUTES } from '@/constants/app';
import type { UserRole } from '@/types/auth';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Match nested routes (e.g. /medicines/:id) as active too. */
  matchPrefix?: boolean;
  roles?: UserRole[];
}

/** Single source of truth for primary navigation. */
export const PRIMARY_NAV: NavItem[] = [
  {
    to: ROUTES.DASHBOARD,
    label: 'Dashboard',
    icon: LayoutDashboard,
    roles: ['PATIENT'],
  },
  {
    to: '/analytics',
    label: 'Analytics',
    icon: BarChart3,
    roles: ['PATIENT'],
  },
  {
    to: ROUTES.MEDICINES,
    label: 'Medicines',
    icon: Pill,
    matchPrefix: true,
    roles: ['PATIENT'],
  },
  {
    to: ROUTES.MEDICATION_SAFETY,
    label: 'Medication Safety',
    icon: ShieldAlert,
    roles: ['PATIENT'],
  },
  {
    to: ROUTES.REFILLS,
    label: 'Refills',
    icon: PackageSearch,
    roles: ['PATIENT'],
  },
  {
    to: ROUTES.BILLS,
    label: 'Bills',
    icon: ReceiptText,
    matchPrefix: true,
    roles: ['PATIENT'],
  },
  {
    to: ROUTES.DOSE_LOGS,
    label: 'Dose logs',
    icon: CalendarClock,
    roles: ['PATIENT'],
  },
  {
    to: ROUTES.PRESCRIPTIONS,
    label: 'Prescriptions',
    icon: ScanLine,
    matchPrefix: true,
    roles: ['PATIENT'],
  },
  {
    to: ROUTES.NOTIFICATIONS,
    label: 'Notifications',
    icon: Bell,
    roles: ['PATIENT', 'CAREGIVER', 'DOCTOR', 'ADMIN'],
  },
  {
    to: ROUTES.CARE,
    label: 'Care Circle',
    icon: UsersRound,
    matchPrefix: true,
    roles: ['PATIENT', 'CAREGIVER'],
  },
  {
    to: ROUTES.DOCTOR_REPORTS,
    label: 'Doctor Reports',
    icon: FileText,
    matchPrefix: true,
    roles: ['PATIENT'],
  },
  {
    to: ROUTES.VACCINATIONS,
    label: 'Vaccinations',
    icon: Syringe,
    matchPrefix: true,
    roles: ['PATIENT', 'CAREGIVER', 'DOCTOR', 'ADMIN'],
  },
  {
    to: ROUTES.HOSPITALS,
    label: 'Nearby Hospitals',
    icon: Building2,
    roles: ['PATIENT', 'CAREGIVER', 'DOCTOR', 'ADMIN'],
  },
  {
    to: ROUTES.EMERGENCY,
    label: 'Emergency SOS',
    icon: Siren,
    roles: ['PATIENT', 'CAREGIVER', 'DOCTOR', 'ADMIN'],
  },
];

export const SECONDARY_NAV: NavItem[] = [
  {
    to: ROUTES.ADMIN_MEDICINE_REVIEWS,
    label: 'Medicine Reviews',
    icon: ShieldCheck,
    roles: ['ADMIN'],
  },
  {
    to: ROUTES.ADMIN_MEDICINE_IMPORTS,
    label: 'Medicine Imports',
    icon: DatabaseZap,
    roles: ['ADMIN'],
  },
  { to: ROUTES.SETTINGS, label: 'Settings', icon: Settings },
];

/** Used by the TopNavbar to show the current page title. */
export const ALL_NAV: NavItem[] = [
  ...PRIMARY_NAV,
  ...SECONDARY_NAV,
  { to: '/profile', label: 'Profile', icon: ClipboardList },
];
