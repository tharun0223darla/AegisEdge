import { http } from '@/lib/api-client';

export interface PatientProfile {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  dateOfBirth?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  height?: number | null;
  weight?: number | null;
  allergies: string[];
  conditions: string[];
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  notes?: string | null;
  avatarUrl?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdatePatientProfilePayload {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string | null;
  gender?: string | null;
  bloodGroup?: string | null;
  height?: number | null;
  weight?: number | null;
  allergies?: string[];
  conditions?: string[];
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  notes?: string | null;
  avatarUrl?: string | null;
}

export const patientService = {
  getProfile: () => http.get<PatientProfile>('/patients/profile/me'),
  createProfile: (payload: UpdatePatientProfilePayload) =>
    http.post<PatientProfile, UpdatePatientProfilePayload>('/patients/profile', payload),
  updateProfile: (payload: UpdatePatientProfilePayload) =>
    http.patch<PatientProfile, UpdatePatientProfilePayload>('/patients/profile/me', payload),
};
