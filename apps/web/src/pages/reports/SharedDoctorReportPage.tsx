import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileLock2 } from 'lucide-react';
import { DoctorReportView } from '@/components/reports/DoctorReportView';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { extractErrorMessage } from '@/lib/api-client';
import { doctorReportsService } from '@/services/doctor-reports.service';

function tokenFromHash() {
  return new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
}

function saveBlob(blob: Blob, title: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${title.replace(/[^a-zA-Z0-9]+/g, '-').toLowerCase() || 'doctor-report'}.pdf`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function SharedDoctorReportPage() {
  const [token] = useState(tokenFromHash);
  const [downloading, setDownloading] = useState(false);
  const query = useQuery({
    queryKey: ['shared-doctor-report', token ? 'provided' : 'missing'],
    queryFn: () => doctorReportsService.sharedView(token),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (token && window.location.hash) {
      window.history.replaceState(null, '', window.location.pathname);
    }
    const meta = document.createElement('meta');
    meta.name = 'referrer';
    meta.content = 'no-referrer';
    document.head.appendChild(meta);
    return () => meta.remove();
  }, [token]);

  const download = async () => {
    if (!query.data) return;
    setDownloading(true);
    try {
      saveBlob(await doctorReportsService.sharedPdf(token), query.data.title);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg-base px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-col gap-3 border-b border-border pb-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
              <FileLock2 className="h-5 w-5" />
            </span>
            <div>
              <p className="font-semibold text-text-primary">MediTrack AI</p>
              <p className="text-xs text-text-muted">
                Private, read-only clinical snapshot
              </p>
            </div>
          </div>
          {query.data && (
            <Button
              variant="secondary"
              leftIcon={<Download className="h-4 w-4" />}
              isLoading={downloading}
              onClick={download}
            >
              Download PDF
            </Button>
          )}
        </header>

        {!token && (
          <EmptyState
            icon={<FileLock2 className="h-6 w-6" />}
            title="Report link is incomplete"
            description="Open the complete private link provided by the patient."
          />
        )}
        {query.isLoading && (
          <div className="flex min-h-80 items-center justify-center">
            <Spinner size="lg" />
          </div>
        )}
        {query.error && (
          <EmptyState
            icon={<FileLock2 className="h-6 w-6" />}
            title="Report unavailable"
            description={extractErrorMessage(
              query.error,
              'This private link is invalid, expired, or revoked. Ask the patient for a new link.',
            )}
          />
        )}
        {query.data && (
          <>
            <div className="mb-4 rounded-lg border border-info/30 bg-info-soft p-4 text-sm text-text-secondary">
              This snapshot was shared by the patient and expires{' '}
              {new Intl.DateTimeFormat('en-IN', {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(new Date(query.data.expiresAt))}
              . It is not a live medical record.
            </div>
            <DoctorReportView
              title={query.data.title}
              snapshot={query.data.snapshot}
            />
          </>
        )}
      </div>
    </main>
  );
}
