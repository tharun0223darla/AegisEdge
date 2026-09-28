import React, { useState } from 'react';
import {
  CalendarClock,
  Download,
  ChevronLeft,
  ChevronRight,
  Search,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { useDoseLogs } from '@/hooks/useDoseLogs';
import { useMedicines } from '@/hooks/useMedicines';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/Table';
import { Tabs } from '@/components/ui/Tabs';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { format, parseISO } from 'date-fns';
import { DoseStatus } from '@/types/dose-log';
import { TodayDoseTimeline } from '@/components/doseLogs/TodayDoseTimeline';
import { AdherenceBarriersPanel } from '@/components/doseLogs/AdherenceBarriersPanel';
import { DoseBarrierReasonPicker } from '@/components/doseLogs/DoseBarrierReasonPicker';
import { doseBarrierLabel } from '@/constants/adherence-barriers';
import type { DoseLog } from '@/types/dose-log';

export default function DoseLogsPage() {
  // Filter States
  const [status, setStatus] = useState<string>('ALL');
  const [medicineId, setMedicineId] = useState<string>('');
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');
  const [search, setSearch] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const [barrierDose, setBarrierDose] = useState<DoseLog | null>(null);
  const limit = 10;

  // Fetch Dose Logs
  const activeStatus = status === 'ALL' ? undefined : (status as DoseStatus);
  const {
    data: logsData,
    isLoading,
    error,
  } = useDoseLogs({
    status: activeStatus,
    medicineId: medicineId || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
    page,
    limit,
  });

  // Fetch medicines list for dropdown filter
  const { data: medicines } = useMedicines({ activeOnly: false });

  // Status map helper
  const statusMeta = {
    TAKEN: { tone: 'success' as const, label: 'Taken' },
    MISSED: { tone: 'danger' as const, label: 'Missed' },
    SNOOZED: { tone: 'warning' as const, label: 'Snoozed' },
    SKIPPED: { tone: 'muted' as const, label: 'Skipped' },
    PENDING: { tone: 'info' as const, label: 'Pending' },
  };

  // Status Tab options
  const statusTabs = [
    { value: 'ALL', label: 'All Logs' },
    { value: 'TAKEN', label: 'Taken' },
    { value: 'MISSED', label: 'Missed' },
    { value: 'SNOOZED', label: 'Snoozed' },
    { value: 'SKIPPED', label: 'Skipped' },
  ];

  // Local filtering by search query (medicine name)
  const allLogs = logsData?.data || [];
  const filteredLogs = allLogs.filter((log) => {
    if (!search) return true;
    const medName = log.medicine?.name?.toLowerCase() || '';
    const notes = log.notes?.toLowerCase() || '';
    return (
      medName.includes(search.toLowerCase()) ||
      notes.includes(search.toLowerCase())
    );
  });

  const totalPages = logsData?.meta?.totalPages || 1;

  // CSV Export utility
  const exportToCSV = () => {
    if (!logsData?.data?.length) return;

    const headers = [
      'Medication Name',
      'Scheduled Time',
      'Action Time',
      'Status',
      'Barrier Reason',
      'Notes',
    ];
    const rows = logsData.data.map((log) => [
      log.medicine?.name || 'Unknown',
      log.scheduledAt
        ? format(parseISO(log.scheduledAt), 'yyyy-MM-dd HH:mm')
        : '',
      log.actionAt ? format(parseISO(log.actionAt), 'yyyy-MM-dd HH:mm') : 'N/A',
      log.status,
      log.barrierReason ? doseBarrierLabel(log.barrierReason) : '',
      log.notes || '',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) =>
        row.map((val) => `"${val.replace(/"/g, '""')}"`).join(','),
      ),
    ].join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute(
      'download',
      `meditrack_dose_logs_${format(new Date(), 'yyyy-MM-dd')}.csv`,
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Dose Logs"
          description="View history of your taken, missed, and snoozed medications."
        />
        <Button
          onClick={exportToCSV}
          disabled={!logsData?.data?.length}
          className="self-start sm:self-auto gap-2 bg-gradient-brand text-text-inverse hover:shadow-glow transition-all"
        >
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      <TodayDoseTimeline />
      <AdherenceBarriersPanel />

      {/* Filters card */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4 shadow-xl">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <Tabs
            items={statusTabs}
            value={status}
            onChange={(val) => {
              setStatus(val);
              setPage(1);
            }}
          />

          <div className="relative max-w-xs w-full">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-text-muted" />
            <input
              type="text"
              placeholder="Search by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-slate-950 border border-slate-800 rounded-xl pl-9 pr-4 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 w-full text-text-primary"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              Medication
            </label>
            <select
              value={medicineId}
              onChange={(e) => {
                setMedicineId(e.target.value);
                setPage(1);
              }}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 w-full text-text-primary"
            >
              <option value="">All Medications</option>
              {medicines?.map((med) => (
                <option key={med.id} value={med.id}>
                  {med.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              From Date
            </label>
            <input
              type="date"
              value={fromDate}
              onChange={(e) => {
                setFromDate(e.target.value);
                setPage(1);
              }}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 w-full text-text-primary"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-text-muted uppercase tracking-wider">
              To Date
            </label>
            <input
              type="date"
              value={toDate}
              onChange={(e) => {
                setToDate(e.target.value);
                setPage(1);
              }}
              className="bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500 w-full text-text-primary"
            />
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-12 space-y-3">
            <Spinner size="lg" className="text-brand-500" />
            <span className="text-text-muted text-sm">
              Fetching dose records...
            </span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-danger">
            Error loading dose logs. Please try again.
          </div>
        ) : filteredLogs.length === 0 ? (
          <EmptyState
            title="No dose records found"
            description={
              search || medicineId || fromDate || toDate
                ? 'Try adjusting your filters to find records.'
                : 'Your medication action history will appear here once doses are logged.'
            }
            icon={<CalendarClock className="h-6 w-6" />}
          />
        ) : (
          <>
            <Table>
              <THead>
                <TR>
                  <TH>Medication</TH>
                  <TH>Form & Strength</TH>
                  <TH>Scheduled Time</TH>
                  <TH>Logged Time</TH>
                  <TH>Status</TH>
                  <TH>Reason</TH>
                  <TH>Notes</TH>
                </TR>
              </THead>
              <TBody>
                {filteredLogs.map((log) => {
                  const meta = statusMeta[log.status] || {
                    tone: 'muted',
                    label: log.status,
                  };
                  return (
                    <TR key={log.id}>
                      <TD className="font-semibold text-text-primary">
                        {log.medicine?.name || 'Unknown Medicine'}
                      </TD>
                      <TD>
                        {log.medicine?.form && (
                          <span className="capitalize">
                            {log.medicine.form.toLowerCase()}
                          </span>
                        )}
                        {(log.medicine as any)?.strength
                          ? ` • ${(log.medicine as any).strength}`
                          : ''}
                      </TD>
                      <TD className="text-text-primary">
                        {log.scheduledAt
                          ? format(
                              parseISO(log.scheduledAt),
                              'MMM dd, yyyy • hh:mm a',
                            )
                          : 'N/A'}
                      </TD>
                      <TD>
                        {log.actionAt
                          ? format(
                              parseISO(log.actionAt),
                              'MMM dd, yyyy • hh:mm a',
                            )
                          : 'N/A'}
                      </TD>
                      <TD>
                        <Badge tone={meta.tone} dot>
                          {meta.label}
                        </Badge>
                      </TD>
                      <TD>
                        {log.status === 'MISSED' || log.status === 'SKIPPED' ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setBarrierDose(log)}
                          >
                            {doseBarrierLabel(log.barrierReason)}
                          </Button>
                        ) : (
                          <span className="text-text-muted">-</span>
                        )}
                      </TD>
                      <TD
                        className="max-w-xs truncate text-text-muted"
                        title={log.notes || undefined}
                      >
                        {log.notes || '—'}
                      </TD>
                    </TR>
                  );
                })}
              </TBody>
            </Table>

            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between border-t border-slate-800 px-6 py-4 bg-slate-950/40">
                <span className="text-sm text-text-muted">
                  Page{' '}
                  <span className="font-medium text-text-primary">{page}</span>{' '}
                  of{' '}
                  <span className="font-medium text-text-primary">
                    {totalPages}
                  </span>
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(p - 1, 1))}
                    disabled={page === 1}
                    className="border-slate-800 hover:bg-slate-900"
                  >
                    <ChevronLeft className="h-4 w-4 mr-1" />
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(p + 1, totalPages))}
                    disabled={page === totalPages}
                    className="border-slate-800 hover:bg-slate-900"
                  >
                    Next
                    <ChevronRight className="h-4 w-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {barrierDose ? (
        <DoseBarrierReasonPicker
          doseLogId={barrierDose.id}
          currentReason={barrierDose.barrierReason}
          open
          onClose={() => setBarrierDose(null)}
        />
      ) : null}
    </div>
  );
}
