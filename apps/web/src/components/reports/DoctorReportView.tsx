import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  HeartPulse,
  PackageOpen,
  Pill,
  ShieldAlert,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import type { DoctorReportSnapshot } from '@/types/doctor-report';

interface DoctorReportViewProps {
  title: string;
  snapshot: DoctorReportSnapshot;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium' }).format(
    new Date(value),
  );
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function label(value: string) {
  return value.replace(/_/g, ' ').toLowerCase();
}

function metricValue(value: unknown) {
  if (typeof value === 'number' || typeof value === 'string')
    return String(value);
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .slice(0, 5)
      .map(([key, entry]) => `${label(key)} ${String(entry)}`)
      .join(', ');
  }
  return 'Unavailable';
}

function quantityUnit(quantity: number, unit: string) {
  if (quantity !== 1) return unit;
  const lower = unit.toLowerCase();
  return lower.endsWith('s') && !lower.endsWith('ss')
    ? unit.slice(0, -1)
    : unit;
}

function SectionHeader({
  icon,
  title,
  updatedAt,
}: {
  icon: React.ReactNode;
  title: string;
  updatedAt?: string | null;
}) {
  return (
    <div className="mb-3 flex flex-col gap-1 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-text-primary">
        {icon}
        <h2 className="text-base font-semibold">{title}</h2>
      </div>
      {updatedAt && (
        <span className="text-xs text-text-muted">
          Last updated {formatDateTime(updatedAt)}
        </span>
      )}
    </div>
  );
}

export function DoctorReportView({ title, snapshot }: DoctorReportViewProps) {
  const latestVitals = snapshot.vitals?.items.slice(0, 30) ?? [];
  return (
    <article className="overflow-hidden rounded-lg border border-border bg-surface">
      <header className="border-b border-border bg-bg-elevated px-5 py-5 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase text-brand-400">
              Patient-provided snapshot
            </p>
            <h1 className="mt-1 text-xl font-semibold text-text-primary">
              {title}
            </h1>
            <p className="mt-1 text-sm text-text-muted">
              {formatDate(snapshot.range.start)} to{' '}
              {formatDate(snapshot.range.end)}
            </p>
          </div>
          <Badge tone="muted">
            Generated {formatDateTime(snapshot.generatedAt)}
          </Badge>
        </div>
      </header>

      <div className="space-y-8 px-5 py-6 sm:px-6">
        <section>
          <SectionHeader
            icon={<CheckCircle2 className="h-5 w-5 text-brand-400" />}
            title="Patient"
          />
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-5">
            <div>
              <dt className="text-text-muted">Name</dt>
              <dd className="font-medium text-text-primary">
                {snapshot.patient.displayName}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Account email</dt>
              <dd className="break-all font-medium text-text-primary">
                {snapshot.patient.contactEmail ?? 'Not included'}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Date of birth</dt>
              <dd className="font-medium text-text-primary">
                {snapshot.patient.dateOfBirth
                  ? formatDate(snapshot.patient.dateOfBirth)
                  : 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Blood group</dt>
              <dd className="font-medium text-text-primary">
                {snapshot.patient.bloodGroup ?? 'Not recorded'}
              </dd>
            </div>
            <div>
              <dt className="text-text-muted">Conditions</dt>
              <dd className="font-medium text-text-primary">
                {snapshot.patient.conditions.join(', ') || 'None recorded'}
              </dd>
            </div>
          </dl>
        </section>

        {snapshot.medications && (
          <section>
            <SectionHeader
              icon={<Pill className="h-5 w-5 text-brand-400" />}
              title={`Active medicines (${snapshot.medications.total})`}
              updatedAt={snapshot.medications.lastUpdatedAt}
            />
            {snapshot.medications.items.length ? (
              <div className="divide-y divide-border">
                {snapshot.medications.items.map((medicine, index) => (
                  <div
                    key={`${medicine.name}-${index}`}
                    className="py-3 first:pt-0 last:pb-0"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-semibold text-text-primary">
                        {medicine.name}
                      </h3>
                      {medicine.strength && <Badge>{medicine.strength}</Badge>}
                      <Badge tone="muted">{label(medicine.form)}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">
                      {medicine.composition ??
                        medicine.genericName ??
                        'Composition not recorded'}
                    </p>
                    <p className="mt-1 text-xs text-text-muted">
                      {medicine.schedules.length
                        ? medicine.schedules
                            .map(
                              (schedule) =>
                                `${schedule.dosesPerIntake} ${quantityUnit(schedule.dosesPerIntake, schedule.unit)}, ${label(schedule.frequency)}${schedule.timesOfDay.length ? ` at ${schedule.timesOfDay.join(', ')}` : ''}`,
                            )
                            .join('; ')
                        : 'No active schedule recorded'}
                    </p>
                    {medicine.instructions && (
                      <p className="mt-1 text-xs text-text-muted">
                        Saved instructions: {medicine.instructions}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                No active medicines recorded.
              </p>
            )}
          </section>
        )}

        {snapshot.adherence && (
          <section>
            <SectionHeader
              icon={<Clock3 className="h-5 w-5 text-brand-400" />}
              title="Dose adherence"
              updatedAt={snapshot.adherence.lastUpdatedAt}
            />
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-5">
              {[
                [
                  'Adherence',
                  snapshot.adherence.adherencePercent === null
                    ? 'Unavailable'
                    : `${snapshot.adherence.adherencePercent.toFixed(1)}%`,
                ],
                ['Taken', snapshot.adherence.taken],
                ['Missed', snapshot.adherence.missed],
                ['Skipped', snapshot.adherence.skipped],
                ['Pending', snapshot.adherence.pending],
              ].map(([name, value]) => (
                <div key={String(name)} className="bg-bg-elevated p-3">
                  <div className="text-lg font-semibold text-text-primary">
                    {value}
                  </div>
                  <div className="text-xs text-text-muted">{name}</div>
                </div>
              ))}
            </div>
            {snapshot.adherence.byMedicine.length > 0 && (
              <div className="mt-3 divide-y divide-border text-sm">
                {snapshot.adherence.byMedicine.map((item) => (
                  <div
                    key={item.name}
                    className="flex flex-col gap-1 py-2 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <span className="font-medium text-text-primary">
                      {item.name}
                    </span>
                    <span className="text-text-muted">
                      {item.taken} taken, {item.missed} missed, {item.skipped}{' '}
                      skipped
                      {item.adherencePercent === null
                        ? ''
                        : ` (${item.adherencePercent.toFixed(1)}%)`}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <p className="mt-3 text-xs leading-5 text-text-muted">
              {snapshot.adherence.methodology}
            </p>
          </section>
        )}

        {snapshot.allergies && (
          <section>
            <SectionHeader
              icon={<AlertTriangle className="h-5 w-5 text-warning" />}
              title={`Allergies and intolerances (${snapshot.allergies.total})`}
              updatedAt={snapshot.allergies.lastUpdatedAt}
            />
            {snapshot.allergies.items.length ? (
              <div className="divide-y divide-border">
                {snapshot.allergies.items.map((item, index) => (
                  <div
                    key={`${item.substance}-${index}`}
                    className="flex flex-col gap-1 py-2 first:pt-0 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div>
                      <span className="font-medium text-text-primary">
                        {item.substance}
                      </span>
                      {item.reaction && (
                        <p className="text-sm text-text-secondary">
                          Reaction: {item.reaction}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge
                        tone={
                          item.criticality === 'HIGH' ? 'danger' : 'warning'
                        }
                      >
                        {label(item.criticality)}
                      </Badge>
                      <Badge tone="muted">
                        {label(item.verificationStatus)}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                No active allergy records saved.
              </p>
            )}
          </section>
        )}

        {snapshot.safety && (
          <section>
            <SectionHeader
              icon={<ShieldAlert className="h-5 w-5 text-danger" />}
              title={`Medication safety prompts (${snapshot.safety.total})`}
              updatedAt={snapshot.safety.lastUpdatedAt}
            />
            {snapshot.safety.items.length ? (
              <div className="space-y-3">
                {snapshot.safety.items.map((item, index) => (
                  <div
                    key={`${item.title}-${index}`}
                    className="border-l-2 border-warning pl-3"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-text-primary">
                        {item.title}
                      </h3>
                      <Badge
                        tone={item.severity === 'HIGH' ? 'danger' : 'warning'}
                      >
                        {label(item.severity)}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-text-secondary">
                      {item.summary}
                    </p>
                    {item.medicines.length > 0 && (
                      <p className="mt-1 text-xs text-text-muted">
                        Saved records: {item.medicines.join(', ')}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                No open safety prompts in saved records.
              </p>
            )}
            <p className="mt-3 text-xs leading-5 text-text-muted">
              {snapshot.safety.disclaimer}
            </p>
          </section>
        )}

        {snapshot.refills && (
          <section>
            <SectionHeader
              icon={<PackageOpen className="h-5 w-5 text-brand-400" />}
              title="Stock and refill status"
              updatedAt={snapshot.refills.lastUpdatedAt}
            />
            <div className="divide-y divide-border">
              {snapshot.refills.items.map((item, index) => (
                <div
                  key={`${item.medicineName}-${index}`}
                  className="flex flex-col gap-1 py-2 first:pt-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <span className="font-medium text-text-primary">
                      {item.medicineName}
                    </span>
                    <span className="ml-2 text-sm text-text-muted">
                      {item.strength}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-secondary">
                      {item.remainingQuantity ?? 'Unknown'}{' '}
                      {item.unit ?? 'units'} remaining
                    </span>
                    <Badge
                      tone={
                        item.status === 'OUT'
                          ? 'danger'
                          : item.status === 'LOW'
                            ? 'warning'
                            : item.status === 'ADEQUATE'
                              ? 'success'
                              : 'muted'
                      }
                    >
                      {label(item.status)}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {snapshot.vitals && (
          <section>
            <SectionHeader
              icon={<HeartPulse className="h-5 w-5 text-danger" />}
              title={`Recorded health readings (${snapshot.vitals.total})`}
              updatedAt={snapshot.vitals.lastUpdatedAt}
            />
            {latestVitals.length ? (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="bg-bg-elevated text-xs text-text-muted">
                    <tr>
                      <th className="px-3 py-2">Reading</th>
                      <th className="px-3 py-2">Value</th>
                      <th className="px-3 py-2">Recorded</th>
                      <th className="px-3 py-2">Source / quality</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {latestVitals.map((item, index) => (
                      <tr
                        key={`${item.metricType}-${item.recordedAt}-${index}`}
                      >
                        <td className="px-3 py-2 font-medium text-text-primary">
                          {label(item.metricType)}
                        </td>
                        <td className="px-3 py-2 text-text-secondary">
                          {metricValue(item.value)} {item.unit}
                        </td>
                        <td className="px-3 py-2 text-text-muted">
                          {formatDateTime(item.recordedAt)}
                        </td>
                        <td className="px-3 py-2 text-text-muted">
                          {label(item.source)} / {label(item.quality)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-text-muted">
                No health readings in this period.
              </p>
            )}
            {snapshot.vitals.items.length > latestVitals.length && (
              <p className="mt-2 text-xs text-text-muted">
                Showing the latest {latestVitals.length} readings in this view.
                The PDF includes up to 250 readings.
              </p>
            )}
            <p className="mt-3 text-xs leading-5 text-text-muted">
              {snapshot.vitals.disclaimer}
            </p>
          </section>
        )}

        <section className="rounded-lg border border-warning/30 bg-warning-soft p-4">
          <h2 className="font-semibold text-text-primary">
            Limitations and safety notice
          </h2>
          <ul className="mt-2 space-y-1 text-sm text-text-secondary">
            {snapshot.limitations.map((item) => (
              <li key={item}>- {item}</li>
            ))}
          </ul>
          <p className="mt-3 text-sm font-medium text-text-primary">
            {snapshot.disclaimer}
          </p>
        </section>
      </div>
    </article>
  );
}
