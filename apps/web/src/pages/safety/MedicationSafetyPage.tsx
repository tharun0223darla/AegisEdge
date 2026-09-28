import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  RefreshCw,
  ShieldAlert,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import {
  useMedicationSafety,
  useMedicationSafetyActions,
} from '@/hooks/useMedicationSafety';
import { extractErrorMessage } from '@/lib/api-client';
import type {
  AllergyCategory,
  AllergyCriticality,
  MedicationSafetySeverity,
  SafetyConditionStatus,
} from '@/types/medication-safety';

const CONDITION_OPTIONS = [
  { value: 'UNKNOWN', label: 'Not recorded' },
  { value: 'NO', label: 'No' },
  { value: 'YES', label: 'Yes' },
  { value: 'NOT_APPLICABLE', label: 'Not applicable' },
];

const severityMeta: Record<
  MedicationSafetySeverity,
  { label: string; tone: BadgeTone; border: string }
> = {
  HIGH: { label: 'Prompt review', tone: 'danger', border: 'border-danger/35' },
  WARNING: { label: 'Check', tone: 'warning', border: 'border-warning/35' },
  INFO: { label: 'Needs identity', tone: 'info', border: 'border-info/35' },
};

export default function MedicationSafetyPage() {
  const query = useMedicationSafety();
  const actions = useMedicationSafetyActions();
  const [allergyOpen, setAllergyOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [substance, setSubstance] = useState('');
  const [reaction, setReaction] = useState('');
  const [category, setCategory] = useState<AllergyCategory>('ALLERGY');
  const [criticality, setCriticality] =
    useState<AllergyCriticality>('UNABLE_TO_ASSESS');
  const [pregnancyStatus, setPregnancyStatus] =
    useState<SafetyConditionStatus>('UNKNOWN');
  const [kidneyCondition, setKidneyCondition] =
    useState<SafetyConditionStatus>('UNKNOWN');
  const [liverCondition, setLiverCondition] =
    useState<SafetyConditionStatus>('UNKNOWN');

  useEffect(() => {
    if (!query.data?.profile) return;
    setPregnancyStatus(query.data.profile.pregnancyStatus);
    setKidneyCondition(query.data.profile.kidneyCondition);
    setLiverCondition(query.data.profile.liverCondition);
  }, [query.data?.profile]);

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
        icon={<ShieldAlert className="h-6 w-6" />}
        title="Medication safety review unavailable"
        description={extractErrorMessage(
          query.error,
          'The safety review could not be loaded.',
        )}
        action={
          <Button onClick={() => query.refetch()} variant="secondary">
            Try again
          </Button>
        }
      />
    );
  }

  const data = query.data;
  const resetAllergyForm = () => {
    setAllergyOpen(false);
    setSubstance('');
    setReaction('');
    setCategory('ALLERGY');
    setCriticality('UNABLE_TO_ASSESS');
  };

  const addAllergy = async () => {
    try {
      await actions.createAllergy.mutateAsync({
        substance: substance.trim(),
        category,
        criticality,
        ...(reaction.trim() ? { reaction: reaction.trim() } : {}),
      });
      resetAllergyForm();
      notify.success('Allergy record added as unverified');
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to add allergy record'));
    }
  };

  const removeAllergy = async () => {
    if (!deleteId) return;
    try {
      await actions.removeAllergy.mutateAsync(deleteId);
      setDeleteId(null);
      notify.success('Allergy record removed');
    } catch (error) {
      notify.error(
        extractErrorMessage(error, 'Unable to remove allergy record'),
      );
    }
  };

  const saveProfile = async () => {
    try {
      await actions.updateProfile.mutateAsync({
        pregnancyStatus,
        kidneyCondition,
        liverCondition,
      });
      notify.success('Safety profile updated');
    } catch (error) {
      notify.error(
        extractErrorMessage(error, 'Unable to update safety profile'),
      );
    }
  };

  const reconcile = async () => {
    try {
      await actions.reconcile.mutateAsync();
      notify.success('Medication safety review refreshed');
    } catch (error) {
      notify.error(
        extractErrorMessage(error, 'Unable to refresh safety review'),
      );
    }
  };

  const acknowledge = async (id: string) => {
    try {
      await actions.acknowledge.mutateAsync({ id });
      notify.success('Finding marked as reviewed');
    } catch (error) {
      notify.error(
        extractErrorMessage(error, 'Unable to mark finding reviewed'),
      );
    }
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Medication safety"
        description="Reconcile saved medicines, ingredients, allergies, and schedules."
        actions={
          <Button
            variant="secondary"
            leftIcon={<RefreshCw className="h-4 w-4" />}
            isLoading={actions.reconcile.isPending}
            onClick={reconcile}
          >
            Run review
          </Button>
        }
      />

      <div className="mb-6 rounded-lg border border-warning/30 bg-warning-soft p-4 text-sm text-text-secondary">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
          <p>{data.disclaimer}</p>
        </div>
      </div>

      <section className="mb-8">
        <div className="grid grid-cols-2 border border-border sm:grid-cols-5">
          {[
            ['Active medicines', data.summary.activeMedicines],
            ['Recorded allergies', data.summary.activeAllergies],
            ['Open findings', data.summary.open],
            ['Reviewed', data.summary.acknowledged],
            ['Prompt review', data.summary.high],
          ].map(([label, value]) => (
            <div
              key={String(label)}
              className="border-b border-r border-border p-4 even:border-r-0 last:border-b-0 last:border-r-0 sm:border-b-0 sm:border-r sm:even:border-r sm:last:border-r-0"
            >
              <div className="text-2xl font-semibold text-text-primary">
                {value}
              </div>
              <div className="text-xs text-text-muted">{label}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              Findings
            </h2>
            <p className="text-xs text-text-muted">
              Each finding shows the saved records that triggered it.
            </p>
          </div>
        </div>
        {data.findings.length ? (
          <div className="space-y-3">
            {data.findings.map((finding) => {
              const meta = severityMeta[finding.severity];
              return (
                <article
                  key={finding.id}
                  className={`rounded-lg border bg-surface p-4 ${meta.border}`}
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-text-primary">
                          {finding.title}
                        </h3>
                        <Badge tone={meta.tone}>{meta.label}</Badge>
                        {finding.status === 'ACKNOWLEDGED' && (
                          <Badge tone="success">Reviewed</Badge>
                        )}
                      </div>
                      <p className="mt-2 text-sm leading-6 text-text-secondary">
                        {finding.summary}
                      </p>
                      {finding.medicines.length > 0 && (
                        <p className="mt-2 text-xs text-text-muted">
                          Saved records:{' '}
                          {finding.medicines
                            .map(
                              (medicine) =>
                                `${medicine.name}${medicine.strength ? ` ${medicine.strength}` : ''}`,
                            )
                            .join(', ')}
                        </p>
                      )}
                    </div>
                    {finding.status === 'OPEN' && (
                      <Button
                        size="sm"
                        variant="secondary"
                        leftIcon={<CheckCircle2 className="h-4 w-4" />}
                        isLoading={actions.acknowledge.isPending}
                        onClick={() => acknowledge(finding.id)}
                      >
                        Mark reviewed
                      </Button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <CheckCircle2 className="mx-auto h-7 w-7 text-success" />
            <h3 className="mt-3 font-medium text-text-primary">
              No current findings
            </h3>
            <p className="mt-1 text-sm text-text-muted">
              The saved records did not trigger the deterministic checks.
            </p>
          </div>
        )}
      </section>

      <section className="mb-8 border-t border-border pt-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-text-primary">
              Allergies and intolerances
            </h2>
            <p className="text-xs text-text-muted">
              Patient-entered records remain unverified until professionally
              reviewed.
            </p>
          </div>
          <Button
            size="sm"
            leftIcon={<Plus className="h-4 w-4" />}
            onClick={() => setAllergyOpen(true)}
          >
            Add record
          </Button>
        </div>
        {data.allergies.length ? (
          <div className="divide-y divide-border border border-border">
            {data.allergies.map((allergy) => (
              <div
                key={allergy.id}
                className="flex items-start justify-between gap-4 p-4"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-text-primary">
                      {allergy.substanceRaw}
                    </span>
                    <Badge
                      tone={
                        allergy.category === 'ALLERGY' ? 'danger' : 'warning'
                      }
                    >
                      {allergy.category === 'ALLERGY'
                        ? 'Allergy'
                        : 'Intolerance'}
                    </Badge>
                    <Badge tone="muted">Unverified</Badge>
                  </div>
                  {allergy.reaction && (
                    <p className="mt-1 text-sm text-text-muted">
                      Reported reaction: {allergy.reaction}
                    </p>
                  )}
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={`Remove ${allergy.substanceRaw}`}
                  onClick={() => setDeleteId(allergy.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-border p-5 text-sm text-text-muted">
            No allergies or intolerances are recorded.
          </p>
        )}
      </section>

      <section className="mb-8 border-t border-border pt-6">
        <div className="mb-4">
          <h2 className="text-base font-semibold text-text-primary">
            Safety profile
          </h2>
          <p className="text-xs text-text-muted">
            These patient-reported details are stored for review. They do not
            create clinical warnings until a source-backed rule is available.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <Select
            label="Pregnancy"
            value={pregnancyStatus}
            options={CONDITION_OPTIONS}
            onChange={(event) =>
              setPregnancyStatus(event.target.value as SafetyConditionStatus)
            }
          />
          <Select
            label="Kidney condition"
            value={kidneyCondition}
            options={CONDITION_OPTIONS}
            onChange={(event) =>
              setKidneyCondition(event.target.value as SafetyConditionStatus)
            }
          />
          <Select
            label="Liver condition"
            value={liverCondition}
            options={CONDITION_OPTIONS}
            onChange={(event) =>
              setLiverCondition(event.target.value as SafetyConditionStatus)
            }
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            variant="secondary"
            isLoading={actions.updateProfile.isPending}
            onClick={saveProfile}
          >
            Save profile
          </Button>
        </div>
      </section>

      <section className="border-t border-border pt-6">
        <h2 className="text-base font-semibold text-text-primary">
          Active medicine reconciliation
        </h2>
        <p className="mb-4 text-xs text-text-muted">
          Only active saved medicines participate in the review.
        </p>
        <div className="divide-y divide-border border border-border">
          {data.medicines.map((medicine) => (
            <div
              key={medicine.id}
              className="flex items-center justify-between gap-4 p-4"
            >
              <div className="flex items-start gap-3">
                <ClipboardCheck className="mt-0.5 h-5 w-5 text-brand-400" />
                <div>
                  <div className="font-medium text-text-primary">
                    {medicine.name} {medicine.strength}
                  </div>
                  <div className="text-xs text-text-muted">
                    {medicine.genericName || medicine.form} |{' '}
                    {medicine.schedules.length
                      ? `${medicine.schedules.length} active schedule${medicine.schedules.length === 1 ? '' : 's'}`
                      : 'No active schedule'}
                  </div>
                </div>
              </div>
              <Badge tone={medicine.medicineMasterId ? 'success' : 'warning'}>
                {medicine.medicineMasterId
                  ? 'Identity linked'
                  : 'Identity pending'}
              </Badge>
            </div>
          ))}
          {!data.medicines.length && (
            <p className="p-5 text-sm text-text-muted">No active medicines.</p>
          )}
        </div>
      </section>

      <Modal
        open={allergyOpen}
        onClose={resetAllergyForm}
        title="Add allergy or intolerance"
        description="This record will be marked patient-reported and unverified."
        footer={
          <>
            <Button variant="secondary" onClick={resetAllergyForm}>
              Cancel
            </Button>
            <Button
              onClick={addAllergy}
              disabled={substance.trim().length < 2}
              isLoading={actions.createAllergy.isPending}
            >
              Add record
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input
            label="Medicine or ingredient"
            value={substance}
            maxLength={160}
            onChange={(event) => setSubstance(event.target.value)}
            placeholder="e.g. Amoxicillin"
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Select
              label="Record type"
              value={category}
              options={[
                { value: 'ALLERGY', label: 'Allergy' },
                { value: 'INTOLERANCE', label: 'Intolerance' },
              ]}
              onChange={(event) =>
                setCategory(event.target.value as AllergyCategory)
              }
            />
            <Select
              label="Reported criticality"
              value={criticality}
              options={[
                { value: 'UNABLE_TO_ASSESS', label: 'Not sure' },
                { value: 'LOW', label: 'Low' },
                { value: 'HIGH', label: 'High' },
              ]}
              onChange={(event) =>
                setCriticality(event.target.value as AllergyCriticality)
              }
            />
          </div>
          <Input
            label="Reported reaction (optional)"
            value={reaction}
            maxLength={500}
            onChange={(event) => setReaction(event.target.value)}
            placeholder="e.g. Rash"
          />
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(deleteId)}
        title="Remove allergy record?"
        description="The record will be retained in the audit history and excluded from future checks."
        confirmLabel="Remove"
        destructive
        isLoading={actions.removeAllergy.isPending}
        onClose={() => setDeleteId(null)}
        onConfirm={removeAllergy}
      />
    </div>
  );
}
