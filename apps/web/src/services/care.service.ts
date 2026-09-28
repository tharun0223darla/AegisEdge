import { http } from '@/lib/api-client';
import type {
  CareAccessLogEntry,
  CareCircle,
  CareDashboard,
  CareInvitationPreview,
  CarePermission,
  CareRelationship,
  CreateCareInvitationInput,
  DoseHelpRequestResult,
} from '@/types/care';

export const careService = {
  circle: () => http.get<CareCircle>('/care/invitations'),
  supportedPeople: () =>
    http.get<CareRelationship[]>('/care/relationships/as-caregiver'),
  accessLog: () => http.get<CareAccessLogEntry[]>('/care/access-log'),
  createInvitation: (input: CreateCareInvitationInput) =>
    http.post<{
      invitation: unknown;
      inviteUrl: string;
      delivery: 'EMAIL' | 'COPY_LINK';
      message: string;
    }>('/care/invitations', input),
  previewInvitation: (token: string) =>
    http.post<CareInvitationPreview>('/care/invitations/preview', { token }),
  acceptInvitation: (token: string) =>
    http.post<CareRelationship>('/care/invitations/accept', {
      token,
      caregiverAcknowledged: true,
    }),
  revokeInvitation: (id: string) => http.delete(`/care/invitations/${id}`),
  updatePermissions: (id: string, permissions: CarePermission[]) =>
    http.patch<CareRelationship>(`/care/relationships/${id}`, { permissions }),
  revokeRelationship: (id: string) => http.delete(`/care/relationships/${id}`),
  dashboard: (patientId: string) =>
    http.get<CareDashboard>(`/care/patients/${patientId}/dashboard`),
  requestDoseHelp: (doseLogId: string) =>
    http.post<DoseHelpRequestResult>(`/care/doses/${doseLogId}/help`, {}),
};
