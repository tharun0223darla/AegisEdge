import { CircleAlert, ClipboardCheck } from 'lucide-react';
import { useDoseBarrierSummary } from '@/hooks/useDoseLogs';
import { Spinner } from '@/components/ui/Spinner';

export function AdherenceBarriersPanel() {
  const summary = useDoseBarrierSummary(30);

  if (summary.isLoading) {
    return (
      <section className="flex min-h-28 items-center justify-center border border-border bg-surface-solid">
        <Spinner size="sm" />
      </section>
    );
  }
  if (summary.isError || !summary.data) return null;
  const data = summary.data;

  return (
    <section className="border border-border bg-surface-solid p-5 shadow-xl">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ClipboardCheck className="h-5 w-5 text-brand-400" />
            Adherence barriers
          </h2>
          <p className="mt-1 text-sm text-text-muted">
            Last {data.periodDays} days
          </p>
        </div>
        {data.finalized > 0 ? (
          <span className="text-sm text-text-secondary">
            {data.recorded}/{data.finalized} reasons recorded
          </span>
        ) : null}
      </header>

      {data.finalized === 0 ? (
        <p className="mt-4 text-sm text-text-muted">
          No missed or skipped doses were recorded in this period.
        </p>
      ) : data.reasons.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">
          Add reasons to missed or skipped doses to reveal recurring barriers.
        </p>
      ) : (
        <div className="mt-4 divide-y divide-border-subtle border-y border-border-subtle">
          {data.guidance.map((item) => (
            <div
              key={item.reason}
              className="grid gap-1 py-3 sm:grid-cols-[180px_1fr]"
            >
              <strong className="text-sm text-text-primary">
                {item.label} ({item.count})
              </strong>
              <p className="text-sm text-text-secondary">{item.guidance}</p>
            </div>
          ))}
        </div>
      )}

      {data.unrecorded > 0 ? (
        <p className="mt-3 flex items-center gap-2 text-xs text-warning">
          <CircleAlert className="h-4 w-4" />
          {data.unrecorded} missed or skipped dose
          {data.unrecorded === 1 ? '' : 's'} still need a reason.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-text-muted">{data.disclaimer}</p>
    </section>
  );
}
