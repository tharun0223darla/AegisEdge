import { useParams } from 'react-router-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  PackageSearch,
  Pill,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { useCareDashboard } from '@/hooks/useCare';
import { useCaregiverMedicationSafety } from '@/hooks/useMedicationSafety';
import { extractErrorMessage } from '@/lib/api-client';

const statusMeta = {
  TAKEN: { label: 'Taken', tone: 'success' as const, icon: CheckCircle2 },
  MISSED: { label: 'Missed', tone: 'danger' as const, icon: XCircle },
  SNOOZED: { label: 'Snoozed', tone: 'warning' as const, icon: Clock3 },
  SKIPPED: { label: 'Skipped', tone: 'muted' as const, icon: XCircle },
  PENDING: { label: 'Pending', tone: 'info' as const, icon: Clock3 },
};

export default function CarePatientDashboardPage() {
  const { patientId = '' } = useParams();
  const query = useCareDashboard(patientId);
  const safetyShared = Boolean(
    query.data?.relationship.permissions.includes('VIEW_MEDICATION_SAFETY'),
  );
  const safetyQuery = useCaregiverMedicationSafety(patientId, safetyShared);

  if (query.isLoading) {
    return (
      <div className="flex min-h-80 items-center justify-center">
        <Spinner size="lg" />
      </div>
    );
  }
  if (query.error || !query.data) {
    return (
      <EmptyState
        icon={<ShieldCheck className="h-6 w-6" />}
        title="Shared status unavailable"
        description={extractErrorMessage(
          query.error,
          'Access may have expired or been revoked.',
        )}
      />
    );
  }

  const data = query.data;
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={data.patient.displayName}
        description={`Shared medication status for ${data.day.date} (${data.day.timezone})`}
      />

      <div className="mb-6 rounded-lg border border-info/25 bg-info-soft p-4 text-sm text-text-secondary">
        {data.disclaimer}
      </div>

      {data.adherence ? (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-text-primary">
            Today&apos;s adherence
          </h2>
          <div className="grid grid-cols-2 border border-border sm:grid-cols-4">
            <div className="border-b border-r border-border p-4 sm:border-b-0">
              <div className="text-2xl font-semibold text-text-primary">
                {data.adherence.completionPercent}%
              </div>
              <div className="text-xs text-text-muted">Taken</div>
            </div>
            <div className="border-b border-border p-4 sm:border-b-0 sm:border-r">
              <div className="text-2xl font-semibold text-success">
                {data.adherence.taken}
              </div>
              <div className="text-xs text-text-muted">Completed</div>
            </div>
            <div className="border-r border-border p-4">
              <div className="text-2xl font-semibold text-danger">
                {data.adherence.missed}
              </div>
              <div className="text-xs text-text-muted">Missed</div>
            </div>
            <div className="p-4">
              <div className="text-2xl font-semibold text-text-primary">
                {data.adherence.total}
              </div>
              <div className="text-xs text-text-muted">Scheduled</div>
            </div>
          </div>

          <div className="mt-4 divide-y divide-border border border-border">
            {data.doses?.map((dose) => {
              const meta = statusMeta[dose.status];
              const Icon = meta.icon;
              return (
                <div
                  key={dose.id}
                  className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-start gap-3">
                    <Icon className="mt-0.5 h-4 w-4 text-text-muted" />
                    <div>
                      <div className="text-sm font-medium text-text-primary">
                        {dose.medicine
                          ? `${dose.medicine.name}${dose.medicine.strength ? ` ${dose.medicine.strength}` : ''}`
                          : 'Scheduled dose'}
                      </div>
                      <div className="text-xs text-text-muted">
                        {new Date(dose.scheduledAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}{' '}
                        · {dose.dose.quantity} {dose.dose.unit}
                      </div>
                    </div>
                  </div>
                  <Badge tone={meta.tone}>{meta.label}</Badge>
                </div>
              );
            })}
            {!data.doses?.length && (
              <p className="p-4 text-sm text-text-muted">
                No doses are scheduled today.
              </p>
            )}
          </div>
        </section>
      ) : (
        <p className="mb-8 border border-dashed border-border p-5 text-sm text-text-muted">
          Adherence details were not shared.
        </p>
      )}

      {data.medicines && (
        <section className="mb-8">
          <h2 className="mb-3 text-base font-semibold text-text-primary">
            Shared medicines
          </h2>
          {data.medicines.length ? (
            <div className="grid gap-3 md:grid-cols-2">
              {data.medicines.map((medicine) => (
                <Card key={medicine.id} className="p-4">
                  <div className="flex items-start gap-3">
                    <Pill className="mt-0.5 h-5 w-5 text-brand-400" />
                    <div>
                      <h3 className="font-medium text-text-primary">
                        {medicine.name} {medicine.strength}
                      </h3>
                      <p className="mt-1 text-xs text-text-muted">
                        {medicine.genericName || medicine.form}
                      </p>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">No active medicines.</p>
          )}
        </section>
      )}

      {data.refills && (
        <section>
          <h2 className="mb-3 text-base font-semibold text-text-primary">
            Shared refill status
          </h2>
          {data.refills.length ? (
            <div className="divide-y divide-border border border-border">
              {data.refills.map((refill) => (
                <div
                  key={refill.id}
                  className="flex items-center justify-between gap-4 p-4"
                >
                  <div className="flex items-start gap-3">
                    <PackageSearch className="mt-0.5 h-5 w-5 text-text-muted" />
                    <div>
                      <div className="text-sm font-medium text-text-primary">
                        {refill.name} {refill.strength}
                      </div>
                      <div className="text-xs text-text-muted">
                        {refill.remainingQuantity == null
                          ? 'Stock not recorded'
                          : `${refill.remainingQuantity} ${refill.unit ?? 'units'} remaining`}
                      </div>
                    </div>
                  </div>
                  {refill.needsAttention && (
                    <Badge tone="warning">
                      <AlertTriangle className="h-3 w-3" />
                      Needs attention
                    </Badge>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">No active medicines.</p>
          )}
        </section>
      )}

      {safetyShared && (
        <section className="mt-8 border-t border-border pt-6">
          <h2 className="mb-3 text-base font-semibold text-text-primary">
            Shared medication safety
          </h2>
          {safetyQuery.isLoading ? (
            <div className="flex min-h-24 items-center justify-center">
              <Spinner />
            </div>
          ) : safetyQuery.error || !safetyQuery.data ? (
            <p className="rounded-lg border border-danger/25 bg-danger-soft p-4 text-sm text-text-secondary">
              Shared safety information is temporarily unavailable.
            </p>
          ) : safetyQuery.data.findings.length ? (
            <div className="space-y-3">
              {safetyQuery.data.findings.map((finding) => (
                <article
                  key={finding.id}
                  className="rounded-lg border border-border bg-surface p-4"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-medium text-text-primary">
                      {finding.title}
                    </h3>
                    <Badge
                      tone={
                        finding.severity === 'HIGH'
                          ? 'danger'
                          : finding.severity === 'WARNING'
                            ? 'warning'
                            : 'info'
                      }
                    >
                      {finding.severity === 'HIGH'
                        ? 'Prompt review'
                        : finding.severity === 'WARNING'
                          ? 'Check'
                          : 'Information'}
                    </Badge>
                  </div>
                  <p className="mt-2 text-sm text-text-secondary">
                    {finding.summary}
                  </p>
                </article>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              No current medication safety findings were shared.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
