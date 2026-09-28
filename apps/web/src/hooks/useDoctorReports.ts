import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { doctorReportsService } from '@/services/doctor-reports.service';

export const doctorReportKeys = {
  all: ['doctor-reports'] as const,
  list: () => [...doctorReportKeys.all, 'list'] as const,
  detail: (reportId: string) =>
    [...doctorReportKeys.all, reportId, 'detail'] as const,
  history: (reportId: string) =>
    [...doctorReportKeys.all, reportId, 'access-history'] as const,
};

export function useDoctorReports() {
  return useQuery({
    queryKey: doctorReportKeys.list(),
    queryFn: doctorReportsService.list,
    staleTime: 30_000,
  });
}

export function useDoctorReport(reportId: string | null) {
  return useQuery({
    queryKey: doctorReportKeys.detail(reportId ?? 'none'),
    queryFn: () => doctorReportsService.get(reportId!),
    enabled: Boolean(reportId),
    staleTime: 30_000,
  });
}

export function useDoctorReportAccessHistory(reportId: string | null) {
  return useQuery({
    queryKey: doctorReportKeys.history(reportId ?? 'none'),
    queryFn: () => doctorReportsService.accessHistory(reportId!),
    enabled: Boolean(reportId),
  });
}

export function useDoctorReportActions() {
  const queryClient = useQueryClient();
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: doctorReportKeys.all });

  return {
    preview: useMutation({ mutationFn: doctorReportsService.preview }),
    create: useMutation({
      mutationFn: doctorReportsService.create,
      onSuccess: () => void refresh(),
    }),
    archive: useMutation({
      mutationFn: doctorReportsService.archive,
      onSuccess: (_result, reportId) => {
        queryClient.removeQueries({
          queryKey: doctorReportKeys.detail(reportId),
        });
        queryClient.removeQueries({
          queryKey: doctorReportKeys.history(reportId),
        });
        void refresh();
      },
    }),
    createShare: useMutation({
      mutationFn: (variables: { reportId: string; expiresInDays: number }) =>
        doctorReportsService.createShare(variables.reportId, {
          expiresInDays: variables.expiresInDays,
          consentAcknowledged: true,
        }),
      onSuccess: (_result, variables) => {
        void refresh();
        void queryClient.invalidateQueries({
          queryKey: doctorReportKeys.history(variables.reportId),
        });
      },
    }),
    revokeShare: useMutation({
      mutationFn: (variables: { reportId: string; shareId: string }) =>
        doctorReportsService.revokeShare(variables.reportId, variables.shareId),
      onSuccess: (_result, variables) => {
        void refresh();
        void queryClient.invalidateQueries({
          queryKey: doctorReportKeys.history(variables.reportId),
        });
      },
    }),
  };
}
