import { Suspense, lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { ROUTES } from '@/constants/app';
import { ProtectedRoute } from './ProtectedRoute';
import { PublicRoute } from './PublicRoute';
import { DashboardLayout } from '@/layouts/DashboardLayout';
import { AuthLayout } from '@/layouts/AuthLayout';
import { LoadingScreen } from '@/components/shared/LoadingScreen';

const LoginPage = lazy(() => import('@/pages/auth/LoginPage'));
const RegisterPage = lazy(() => import('@/pages/auth/RegisterPage'));
const VerifyEmailPage = lazy(() => import('@/pages/auth/VerifyEmailPage'));
const ForgotPasswordPage = lazy(
  () => import('@/pages/auth/ForgotPasswordPage'),
);
const DashboardPage = lazy(() => import('@/pages/dashboard/DashboardPage'));
const AnalyticsPage = lazy(() => import('@/pages/dashboard/AnalyticsPage'));
const MedicinesPage = lazy(() => import('@/pages/medicines/MedicinesPage'));
const MedicineDetailsPage = lazy(
  () => import('@/pages/medicines/MedicineDetailsPage'),
);
const BillsPage = lazy(() => import('@/pages/bills/BillsPage'));
const DoseLogsPage = lazy(() => import('@/pages/doseLogs/DoseLogsPage'));
const RefillsPage = lazy(() => import('@/pages/refills/RefillsPage'));
const CareCirclePage = lazy(() => import('@/pages/care/CareCirclePage'));
const MedicationSafetyPage = lazy(
  () => import('@/pages/safety/MedicationSafetyPage'),
);
const DoctorReportsPage = lazy(
  () => import('@/pages/reports/DoctorReportsPage'),
);
const SharedDoctorReportPage = lazy(
  () => import('@/pages/reports/SharedDoctorReportPage'),
);
const CareInvitationAcceptPage = lazy(
  () => import('@/pages/care/CareInvitationAcceptPage'),
);
const CarePatientDashboardPage = lazy(
  () => import('@/pages/care/CarePatientDashboardPage'),
);
const NotificationsPage = lazy(
  () => import('@/pages/notifications/NotificationsPage'),
);
const PrescriptionUploadPage = lazy(
  () => import('@/pages/prescriptions/PrescriptionUploadPage'),
);
const PrescriptionDetailsPage = lazy(
  () => import('@/pages/prescriptions/PrescriptionDetailsPage'),
);
const ProfilePage = lazy(() => import('@/pages/profile/ProfilePage'));
const SettingsPage = lazy(() => import('@/pages/settings/SettingsPage'));
const MedicineReviewQueuePage = lazy(
  () => import('@/pages/admin/MedicineReviewQueuePage'),
);
const MedicineImportPage = lazy(
  () => import('@/pages/admin/MedicineImportPage'),
);
const HospitalsPage = lazy(() => import('@/pages/emergency/HospitalsPage'));
const EmergencySOSPage = lazy(() => import('@/pages/emergency/EmergencySOSPage'));
const AmbulanceTrackingPage = lazy(
  () => import('@/pages/emergency/AmbulanceTrackingPage'),
);
const VaccinationsPage = lazy(
  () => import('@/pages/vaccinations/VaccinationsPage'),
);
const NotFound = lazy(() => import('@/components/shared/NotFound'));

export function AppRouter() {
  return (
    <Suspense fallback={<LoadingScreen label="Loading…" />}>
      <Routes>
        <Route element={<PublicRoute />}>
          <Route element={<AuthLayout />}>
            <Route path={ROUTES.LOGIN} element={<LoginPage />} />
            <Route path={ROUTES.REGISTER} element={<RegisterPage />} />
            <Route path={ROUTES.VERIFY_EMAIL} element={<VerifyEmailPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          </Route>
        </Route>

        <Route element={<ProtectedRoute />}>
          <Route element={<DashboardLayout />}>
            <Route element={<ProtectedRoute roles={['PATIENT']} />}>
              <Route path={ROUTES.DASHBOARD} element={<DashboardPage />} />
              <Route path={ROUTES.REFILLS} element={<RefillsPage />} />
              <Route
                path={ROUTES.MEDICATION_SAFETY}
                element={<MedicationSafetyPage />}
              />
              <Route
                path={ROUTES.DOCTOR_REPORTS}
                element={<DoctorReportsPage />}
              />
              <Route path="/analytics" element={<AnalyticsPage />} />
              <Route path={ROUTES.MEDICINES} element={<MedicinesPage />} />
              <Route path="/medicines/:id" element={<MedicineDetailsPage />} />
              <Route path={ROUTES.BILLS} element={<BillsPage />} />
              <Route path={ROUTES.DOSE_LOGS} element={<DoseLogsPage />} />
              <Route
                path={ROUTES.PRESCRIPTIONS}
                element={<PrescriptionUploadPage />}
              />
              <Route
                path="/prescriptions/:id"
                element={<PrescriptionDetailsPage />}
              />
            </Route>
            <Route
              element={<ProtectedRoute roles={['PATIENT', 'CAREGIVER']} />}
            >
              <Route path={ROUTES.CARE} element={<CareCirclePage />} />
              <Route
                path={ROUTES.CARE_INVITATION_ACCEPT}
                element={<CareInvitationAcceptPage />}
              />
            </Route>
            <Route element={<ProtectedRoute roles={['CAREGIVER']} />}>
              <Route
                path={ROUTES.CARE_PATIENT()}
                element={<CarePatientDashboardPage />}
              />
            </Route>
            <Route
              path={ROUTES.NOTIFICATIONS}
              element={<NotificationsPage />}
            />
            <Route
              path={ROUTES.VACCINATIONS}
              element={<VaccinationsPage />}
            />
            <Route path={ROUTES.HOSPITALS} element={<HospitalsPage />} />
            <Route path={ROUTES.EMERGENCY} element={<EmergencySOSPage />} />
            <Route path="/ambulance" element={<EmergencySOSPage />} />
            <Route
              path="/ambulance-tracking"
              element={<AmbulanceTrackingPage />}
            />
            <Route
              path="/ambulance-tracking/:id"
              element={<AmbulanceTrackingPage />}
            />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path={ROUTES.SETTINGS} element={<SettingsPage />} />
            <Route element={<ProtectedRoute roles={['ADMIN']} />}>
              <Route
                path={ROUTES.ADMIN_MEDICINE_REVIEWS}
                element={<MedicineReviewQueuePage />}
              />
              <Route
                path={ROUTES.ADMIN_MEDICINE_IMPORTS}
                element={<MedicineImportPage />}
              />
            </Route>
          </Route>
        </Route>

        <Route
          path={ROUTES.SHARED_DOCTOR_REPORT}
          element={<SharedDoctorReportPage />}
        />

        <Route
          path={ROUTES.ROOT}
          element={<Navigate to={ROUTES.DASHBOARD} replace />}
        />
        <Route path={ROUTES.NOT_FOUND} element={<NotFound />} />
      </Routes>
    </Suspense>
  );
}
