import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  Clipboard,
  Download,
  Eye,
  FileText,
  Link2,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { DoctorReportView } from '@/components/reports/DoctorReportView';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Checkbox';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import {
  useDoctorReportAccessHistory,
  useDoctorReportActions,
  useDoctorReport,
  useDoctorReports,
} from '@/hooks/useDoctorReports';
import { extractErrorMessage } from '@/lib/api-client';
import { doctorReportsService } from '@/services/doctor-reports.service';
import type {
  ComposeDoctorReportInput,
  DoctorReportRecord,
  DoctorReportSection,
} from '@/types/doctor-report';

const SECTION_OPTIONS: Array<{
  value: DoctorReportSection;
  label: string;
  description: string;
}> = [
  {
    value: 'MEDICATIONS',
    label: 'Medicines',
    description: 'Identity, composition, and active schedules',
  },
  {
    value: 'ADHERENCE',
    label: 'Adherence',
    description: 'Taken, missed, skipped, and pending dose records',
  },
  {
    value: 'ALLERGIES',
    label: 'Allergies',
    description: 'Saved allergies, reactions, and verification state',
  },
  {
    value: 'SAFETY',
    label: 'Safety prompts',
    description: 'Open deterministic medication review prompts',
  },
  {
    value: 'REFILLS',
    label: 'Stock and refills',
    description: 'Current recorded quantities and refill dates',
  },
  {
    value: 'VITALS',
    label: 'Health readings',
    description: 'Readings with source and quality preserved',
  },
];

function dateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function reportFileName(title: string) {
  return `${
    title
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'doctor-report'
  }.pdf`;
}

export default function DoctorReportsPage() {
  const today = useMemo(() => new Date(), []);
  const thirtyDaysAgo = useMemo(
    () => new Date(today.getTime() - 29 * 86_400_000),
    [today],
  );
  const [startDate, setStartDate] = useState(dateInput(thirtyDaysAgo));
  const [endDate, setEndDate] = useState(dateInput(today));
  const [title, setTitle] = useState('');
  const [sections, setSections] = useState<DoctorReportSection[]>(
    SECTION_OPTIONS.map((item) => item.value),
  );
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [shareConsent, setShareConsent] = useState(false);
  const [shareDays, setShareDays] = useState('7');
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [revokeShareId, setRevokeShareId] = useState<string | null>(null);
  const [archiveReportId, setArchiveReportId] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const reportsQuery = useDoctorReports();
  const selectedReportQuery = useDoctorReport(selectedReportId);
  const actions = useDoctorReportActions();
  const selectedReport = selectedReportQuery.data;
  const historyQuery = useDoctorReportAccessHistory(selectedReport?.id ?? null);

  useEffect(() => {
    if (
      selectedReportId &&
      reportsQuery.data &&
      !reportsQuery.data.some((report) => report.id === selectedReportId)
    ) {
      setSelectedReportId(null);
    }
  }, [reportsQuery.data, selectedReportId]);

  const input = (): ComposeDoctorReportInput => ({
    startDate,
    endDate,
    sections,
    ...(title.trim() ? { title: title.trim() } : {}),
  });

  const validate = () => {
    if (!sections.length) {
      notify.error('Select at least one report section');
      return false;
    }
    if (!startDate || !endDate || startDate > endDate) {
      notify.error('Choose a valid start and end date');
      return false;
    }
    return true;
  };

  const preview = async () => {
    if (!validate()) return;
    setSelectedReportId(null);
    try {
      await actions.preview.mutateAsync(input());
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to preview report'));
    }
  };

  const create = async () => {
    if (!validate()) return;
    try {
      const report = await actions.create.mutateAsync(input());
      setSelectedReportId(report.id);
      actions.preview.reset();
      notify.success('Immutable report snapshot created');
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to create report'));
    }
  };

  const toggleSection = (section: DoctorReportSection) => {
    setSections((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    );
  };

  const download = async (report: DoctorReportRecord) => {
    setDownloading(true);
    try {
      const blob = await doctorReportsService.ownerPdf(report.id);
      saveBlob(blob, reportFileName(report.title));
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to download PDF'));
    } finally {
      setDownloading(false);
    }
  };

  const createShare = async () => {
    if (!selectedReport || !shareConsent) return;
    try {
      const result = await actions.createShare.mutateAsync({
        reportId: selectedReport.id,
        expiresInDays: Number(shareDays),
      });
      setShareUrl(result.shareUrl);
      notify.success('Private expiring link created');
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to create report link'));
    }
  };

  const closeShare = () => {
    setShareOpen(false);
    setShareConsent(false);
    setShareDays('7');
    setShareUrl(null);
  };

  const copyShare = async () => {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      notify.success('Private link copied');
    } catch {
      notify.error('Unable to copy. Select the link and copy it manually.');
    }
  };

  const revoke = async () => {
    if (!selectedReport || !revokeShareId) return;
    try {
      await actions.revokeShare.mutateAsync({
        reportId: selectedReport.id,
        shareId: revokeShareId,
      });
      setRevokeShareId(null);
      notify.success('Report link revoked immediately');
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to revoke report link'));
    }
  };

  const archive = async () => {
    if (!archiveReportId) return;
    try {
      await actions.archive.mutateAsync(archiveReportId);
      if (selectedReportId === archiveReportId) setSelectedReportId(null);
      setArchiveReportId(null);
      notify.success('Report archived and all private links revoked');
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to archive report'));
    }
  };

  const visibleReport = selectedReport ?? actions.preview.data;

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title="Doctor visit reports"
        description="Prepare a bounded, patient-controlled snapshot for a clinician conversation."
        actions={
          <Button
            variant="secondary"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            onClick={() => void reportsQuery.refetch()}
            isLoading={reportsQuery.isFetching}
          >
            Refresh
          </Button>
        }
      />

      <div className="mb-6 rounded-lg border border-info/30 bg-info-soft p-4 text-sm text-text-secondary">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-info" />
          <p>
            Preview uses current saved data. Creating a report freezes an
            immutable snapshot. Sharing is optional, expires automatically, and
            can be revoked at any time.
          </p>
        </div>
      </div>

      <section className="mb-8 border-y border-border bg-surface px-4 py-5 sm:px-6">
        <div className="grid gap-4 lg:grid-cols-3">
          <Input
            label="Start date"
            type="date"
            value={startDate}
            max={dateInput(today)}
            onChange={(event) => setStartDate(event.target.value)}
          />
          <Input
            label="End date"
            type="date"
            value={endDate}
            max={dateInput(today)}
            onChange={(event) => setEndDate(event.target.value)}
          />
          <Input
            label="Report title (optional)"
            value={title}
            maxLength={80}
            placeholder="e.g. Cardiology follow-up"
            onChange={(event) => setTitle(event.target.value)}
          />
        </div>
        <div className="mt-5">
          <h2 className="text-sm font-semibold text-text-primary">
            Include sections
          </h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {SECTION_OPTIONS.map((option) => (
              <Checkbox
                key={option.value}
                checked={sections.includes(option.value)}
                onChange={() => toggleSection(option.value)}
                label={option.label}
                description={option.description}
              />
            ))}
          </div>
        </div>
        <div className="mt-5 flex flex-wrap justify-end gap-3">
          <Button
            variant="secondary"
            leftIcon={<Eye className="h-4 w-4" />}
            isLoading={actions.preview.isPending}
            onClick={preview}
          >
            Preview current data
          </Button>
          <Button
            leftIcon={<FileText className="h-4 w-4" />}
            isLoading={actions.create.isPending}
            onClick={create}
          >
            Create immutable report
          </Button>
        </div>
      </section>

      {reportsQuery.isLoading && (
        <div className="flex min-h-40 items-center justify-center">
          <Spinner size="lg" />
        </div>
      )}

      {reportsQuery.error && (
        <EmptyState
          icon={<FileText className="h-6 w-6" />}
          title="Reports unavailable"
          description={extractErrorMessage(
            reportsQuery.error,
            'Saved reports could not be loaded.',
          )}
          action={
            <Button
              variant="secondary"
              onClick={() => void reportsQuery.refetch()}
            >
              Try again
            </Button>
          }
        />
      )}

      {reportsQuery.data && reportsQuery.data.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-text-primary">
              Saved snapshots
            </h2>
            <span className="text-xs text-text-muted">Newest first</span>
          </div>
          <div className="divide-y divide-border border-y border-border">
            {reportsQuery.data.map((report) => {
              const activeLinks = report.shares.filter(
                (share) => share.status === 'ACTIVE',
              ).length;
              return (
                <div
                  key={report.id}
                  className="flex flex-col gap-3 bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-text-primary">
                        {report.title}
                      </h3>
                      <Badge tone="success">Immutable</Badge>
                      {activeLinks > 0 && (
                        <Badge tone="info">
                          {activeLinks} active link
                          {activeLinks === 1 ? '' : 's'}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      Created{' '}
                      {new Intl.DateTimeFormat('en-IN', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      }).format(new Date(report.createdAt))}{' '}
                      | {report.sections.length} sections
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant={
                        selectedReportId === report.id
                          ? 'primary'
                          : 'secondary'
                      }
                      onClick={() => {
                        setSelectedReportId(report.id);
                        actions.preview.reset();
                      }}
                    >
                      Open
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      leftIcon={<Archive className="h-4 w-4" />}
                      onClick={() => setArchiveReportId(report.id)}
                    >
                      Archive
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {visibleReport && (
        <section className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-text-primary">
                {selectedReport ? 'Saved immutable snapshot' : 'Live preview'}
              </h2>
              <p className="text-xs text-text-muted">
                {selectedReport
                  ? 'This data will not change when your account records change.'
                  : 'This preview is not saved or shared yet.'}
              </p>
            </div>
            {selectedReport && (
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  leftIcon={<Download className="h-4 w-4" />}
                  isLoading={downloading}
                  onClick={() => void download(selectedReport)}
                >
                  Download PDF
                </Button>
                <Button
                  leftIcon={<Link2 className="h-4 w-4" />}
                  onClick={() => setShareOpen(true)}
                >
                  Share securely
                </Button>
              </div>
            )}
          </div>
          <DoctorReportView
            title={visibleReport.title}
            snapshot={visibleReport.snapshot}
          />
        </section>
      )}

      {selectedReport && (
        <section className="mt-8 border-t border-border pt-6">
          <h2 className="text-base font-semibold text-text-primary">
            Private links and access history
          </h2>
          <p className="mt-1 text-xs text-text-muted">
            Only successful views and PDF downloads are recorded. No IP address
            is stored here.
          </p>
          {selectedReport.shares.length ? (
            <div className="mt-4 divide-y divide-border border-y border-border">
              {selectedReport.shares.map((share) => (
                <div
                  key={share.id}
                  className="flex flex-col gap-3 bg-surface px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge
                        tone={share.status === 'ACTIVE' ? 'success' : 'muted'}
                      >
                        {share.status.toLowerCase()}
                      </Badge>
                      <span className="text-sm text-text-secondary">
                        Expires{' '}
                        {new Intl.DateTimeFormat('en-IN', {
                          dateStyle: 'medium',
                          timeStyle: 'short',
                        }).format(new Date(share.expiresAt))}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-text-muted">
                      {share.accessCount} access event
                      {share.accessCount === 1 ? '' : 's'}
                      {share.lastAccessedAt
                        ? ` | Last ${new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(share.lastAccessedAt))}`
                        : ''}
                    </p>
                  </div>
                  {share.status === 'ACTIVE' && (
                    <Button
                      size="sm"
                      variant="danger"
                      leftIcon={<Trash2 className="h-4 w-4" />}
                      onClick={() => setRevokeShareId(share.id)}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-4 text-sm text-text-muted">
              No private links have been created for this snapshot.
            </p>
          )}
          {historyQuery.data &&
            historyQuery.data.shares.some(
              (share) => share.accesses.length > 0,
            ) && (
              <div className="mt-5">
                <h3 className="text-sm font-semibold text-text-primary">
                  Recent successful access
                </h3>
                <div className="mt-2 divide-y divide-border text-sm">
                  {historyQuery.data.shares.flatMap((share) =>
                    share.accesses.map((access) => (
                      <div
                        key={access.id}
                        className="flex items-center justify-between gap-3 py-2"
                      >
                        <span className="text-text-secondary">
                          {access.action === 'VIEWED'
                            ? 'Report viewed'
                            : 'PDF downloaded'}
                        </span>
                        <span className="text-xs text-text-muted">
                          {new Intl.DateTimeFormat('en-IN', {
                            dateStyle: 'medium',
                            timeStyle: 'short',
                          }).format(new Date(access.accessedAt))}
                        </span>
                      </div>
                    )),
                  )}
                </div>
              </div>
            )}
        </section>
      )}

      <Modal
        open={shareOpen}
        onClose={closeShare}
        title="Create a private clinician link"
        description="The link is read-only, expires automatically, and can be revoked immediately."
      >
        {shareUrl ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-success/30 bg-success-soft p-4 text-sm text-text-secondary">
              The link was created and is shown only in this dialog. Send it
              only to the intended clinician.
            </div>
            <Input label="Private link" value={shareUrl} readOnly />
            <Button
              fullWidth
              leftIcon={<Clipboard className="h-4 w-4" />}
              onClick={copyShare}
            >
              Copy private link
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            <Select
              label="Link expiry"
              value={shareDays}
              onChange={(event) => setShareDays(event.target.value)}
              options={[
                { value: '1', label: '1 day' },
                { value: '7', label: '7 days' },
                { value: '14', label: '14 days' },
                { value: '30', label: '30 days (maximum)' },
              ]}
            />
            <Checkbox
              checked={shareConsent}
              onChange={(event) => setShareConsent(event.target.checked)}
              label="I consent to sharing this exact snapshot"
              description="I understand anyone with the link can view it until it expires or I revoke it."
            />
            <Button
              fullWidth
              disabled={!shareConsent}
              isLoading={actions.createShare.isPending}
              onClick={createShare}
            >
              Create private link
            </Button>
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={Boolean(revokeShareId)}
        onClose={() => setRevokeShareId(null)}
        onConfirm={revoke}
        title="Revoke this report link?"
        description="Anyone using this link will immediately lose access. The immutable report remains in your account."
        confirmLabel="Revoke link"
        destructive
        isLoading={actions.revokeShare.isPending}
      />

      <ConfirmDialog
        open={Boolean(archiveReportId)}
        onClose={() => setArchiveReportId(null)}
        onConfirm={archive}
        title="Archive this report?"
        description="The immutable snapshot and its access history will be retained, but it will leave this list and every active private link will stop working."
        confirmLabel="Archive report"
        destructive
        isLoading={actions.archive.isPending}
      />
    </div>
  );
}
