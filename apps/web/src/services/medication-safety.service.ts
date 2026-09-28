import { http } from '@/lib/api-client';
import type {
  AllergyIntolerance,
  CreateAllergyInput,
  MedicationSafetyFinding,
  MedicationSafetyOverview,
  PatientSafetyProfile,
  SafetyConditionStatus,
} from '@/types/medication-safety';

export const medicationSafetyService = {
  overview: () =>
    http.get<MedicationSafetyOverview>('/medication-safety/overview'),
  reconcile: () =>
    http.post<MedicationSafetyOverview>('/medication-safety/reconcile'),
  updateProfile: (input: {
    pregnancyStatus: SafetyConditionStatus;
    kidneyCondition: SafetyConditionStatus;
    liverCondition: SafetyConditionStatus;
  }) => http.patch<PatientSafetyProfile>('/medication-safety/profile', input),
  createAllergy: (input: CreateAllergyInput) =>
    http.post<AllergyIntolerance>('/medication-safety/allergies', input),
  removeAllergy: (id: string) =>
    http.delete<{ id: string; removed: true }>(
      `/medication-safety/allergies/${id}`,
    ),
  acknowledge: (id: string, note?: string) =>
    http.patch<MedicationSafetyFinding>(
      `/medication-safety/findings/${id}/acknowledge`,
      note ? { note } : {},
    ),
  caregiverOverview: (patientId: string) =>
    http.get<MedicationSafetyOverview>(
      `/medication-safety/care/patients/${patientId}/overview`,
    ),
};
