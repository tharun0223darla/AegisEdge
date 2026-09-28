import type { MedicineForm } from '@/types/medicine';
import type { Frequency } from '@/types/schedule';

export const APP_NAME = 'MediTrack AI';
export const APP_TAGLINE = 'Smart medication adherence, powered by AI';

export const ROUTES = {
  ROOT: '/',
  LOGIN: '/login',
  REGISTER: '/register',
  VERIFY_EMAIL: '/verify-email',
  DASHBOARD: '/dashboard',
  MEDICINES: '/medicines',
  MEDICINE_NEW: '/medicines/new',
  MEDICINE_DETAIL: (id = ':id') => `/medicines/${id}`,
  SCHEDULES: '/schedules',
  TODAY: '/today',
  DOSE_LOGS: '/dose-logs',
  PRESCRIPTIONS: '/prescriptions',
  BILLS: '/bills',
  REFILLS: '/refills',
  CARE: '/care',
  MEDICATION_SAFETY: '/medication-safety',
  ANALYTICS: '/dose-logs',
  DOCTOR_REPORTS: '/doctor-reports',
  SHARED_DOCTOR_REPORT: '/shared/report',
  CARE_INVITATION_ACCEPT: '/care/invitations/accept',
  CARE_PATIENT: (patientId = ':patientId') => `/care/patients/${patientId}`,
  NOTIFICATIONS: '/notifications',
  VACCINATIONS: '/vaccinations',
  HOSPITALS: '/hospitals',
  EMERGENCY: '/emergency',
  AMBULANCE_TRACKING: (id = ':id') => `/ambulance-tracking/${id}`,
  SETTINGS: '/settings',
  ADMIN_MEDICINE_REVIEWS: '/admin/medicine-reviews',
  ADMIN_MEDICINE_IMPORTS: '/admin/medicine-imports',
  NOT_FOUND: '*',
} as const;

export const MEDICINE_FORMS: {
  value: MedicineForm;
  label: string;
  emoji: string;
}[] = [
  { value: 'TABLET', label: 'Tablet', emoji: '💊' },
  { value: 'CAPSULE', label: 'Capsule', emoji: '💊' },
  { value: 'SYRUP', label: 'Syrup', emoji: '🧴' },
  { value: 'INJECTION', label: 'Injection', emoji: '💉' },
  { value: 'DROPS', label: 'Drops', emoji: '💧' },
  { value: 'INHALER', label: 'Inhaler', emoji: '🌬️' },
  { value: 'PATCH', label: 'Patch', emoji: '🩹' },
  { value: 'CREAM', label: 'Cream', emoji: '🧴' },
  { value: 'OINTMENT', label: 'Ointment', emoji: '🧴' },
  { value: 'POWDER', label: 'Powder', emoji: '🥄' },
  { value: 'OTHER', label: 'Other', emoji: '🩺' },
];

export const FREQUENCIES: {
  value: Frequency;
  label: string;
  description: string;
}[] = [
  { value: 'DAILY', label: 'Daily', description: 'Once daily' },
  {
    value: 'TWICE_DAILY',
    label: 'Twice daily',
    description: 'Two times daily',
  },
  {
    value: 'THREE_TIMES_DAILY',
    label: 'Three times daily',
    description: 'Three times daily',
  },
  {
    value: 'FOUR_TIMES_DAILY',
    label: 'Four times daily',
    description: 'Four times daily',
  },
  {
    value: 'WEEKLY',
    label: 'Weekly',
    description: 'On selected days of the week',
  },
  { value: 'CUSTOM', label: 'Custom', description: 'Custom schedule pattern' },
  {
    value: 'AS_NEEDED',
    label: 'As needed',
    description: 'Take only when required',
  },
];

export const DAYS_OF_WEEK = [
  { value: 0, short: 'S', label: 'Sun' },
  { value: 1, short: 'M', label: 'Mon' },
  { value: 2, short: 'T', label: 'Tue' },
  { value: 3, short: 'W', label: 'Wed' },
  { value: 4, short: 'T', label: 'Thu' },
  { value: 5, short: 'F', label: 'Fri' },
  { value: 6, short: 'S', label: 'Sat' },
];

export const DOSE_STATUS_META = {
  TAKEN: { label: 'Taken', color: 'success', icon: 'CheckCircle2' },
  MISSED: { label: 'Missed', color: 'danger', icon: 'XCircle' },
  SNOOZED: { label: 'Snoozed', color: 'warning', icon: 'Clock' },
  SKIPPED: { label: 'Skipped', color: 'muted', icon: 'MinusCircle' },
  PENDING: { label: 'Pending', color: 'accent', icon: 'Circle' },
} as const;
