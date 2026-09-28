import { apiClient, http } from '@/lib/api-client';
import type {
  ComposeDoctorReportInput,
  DoctorReportAccessHistory,
  DoctorReportPreview,
  DoctorReportRecord,
  DoctorReportSummary,
  SharedDoctorReport,
} from '@/types/doctor-report';

export const doctorReportsService = {
  preview: (input: ComposeDoctorReportInput) =>
    http.post<DoctorReportPreview, ComposeDoctorReportInput>(
      '/doctor-reports/preview',
      input,
    ),
  create: (input: ComposeDoctorReportInput) =>
    http.post<DoctorReportRecord, ComposeDoctorReportInput>(
      '/doctor-reports',
      input,
    ),
  list: () => http.get<DoctorReportSummary[]>('/doctor-reports'),
  get: (reportId: string) =>
    http.get<DoctorReportRecord>(`/doctor-reports/${reportId}`),
  archive: (reportId: string) =>
    http.delete<{
      reportId: string;
      archivedAt: string;
      revokedLinks: number;
    }>(`/doctor-reports/${reportId}`),
  createShare: (
    reportId: string,
    input: { expiresInDays: number; consentAcknowledged: true },
  ) =>
    http.post<{
      share: DoctorReportRecord['shares'][number];
      shareUrl: string;
      message: string;
    }>(`/doctor-reports/${reportId}/shares`, input),
  revokeShare: (reportId: string, shareId: string) =>
    http.delete<DoctorReportRecord['shares'][number]>(
      `/doctor-reports/${reportId}/shares/${shareId}`,
    ),
  accessHistory: (reportId: string) =>
    http.get<DoctorReportAccessHistory>(
      `/doctor-reports/${reportId}/access-history`,
    ),
  ownerPdf: (reportId: string) =>
    apiClient
      .get<Blob>(`/doctor-reports/${reportId}/pdf`, { responseType: 'blob' })
      .then((response) => response.data),
  sharedView: (token: string) =>
    http.post<SharedDoctorReport, { token: string }>('/shared-reports/view', {
      token,
    }),
  sharedPdf: (token: string) =>
    apiClient
      .post<Blob>('/shared-reports/pdf', { token }, { responseType: 'blob' })
      .then((response) => response.data),
};
