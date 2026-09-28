import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  ArrowLeft,
  Clock,
  Image as ImageIcon,
  Info,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { MedicineForm } from '@/components/medicines/MedicineForm';
import { ScheduleEditor } from '@/components/medicines/ScheduleEditor';
import { StripVerificationPanel } from '@/components/medicines/StripVerificationPanel';
import { ProtectedImage } from '@/components/shared/ProtectedImage';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Modal } from '@/components/ui/Modal';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { notify } from '@/components/ui/Toast';
import { LoadingScreen } from '@/components/shared/LoadingScreen';
import { useMedicine, useUpdateMedicine, useDeleteMedicine } from '@/hooks/useMedicines';
import { useSchedules, useCreateSchedule, useDeleteSchedule } from '@/hooks/useSchedules';
import { extractErrorMessage } from '@/lib/api-client';
import { medicinesService } from '@/services/medicines.service';
import { formatTime, formatDate } from '@/lib/date';
import { MEDICINE_FORMS, FREQUENCIES, ROUTES } from '@/constants/app';
import type { Medicine, MedicineEnrichment } from '@/types/medicine';
import type { MedicineFormValues } from '@/validation/medicine.schema';
import type { ScheduleFormValues } from '@/validation/schedule.schema';
import type { UpdateMedicinePayload } from '@/types/medicine';
import type { CreateSchedulePayload } from '@/types/schedule';

const CORE_DETAIL_FIELDS = [
  {
    label: 'Why it may be prescribed',
    patientKey: 'whyPrescribed',
    clinicalKey: 'uses',
  },
  {
    label: 'How to take',
    patientKey: 'howToTake',
    clinicalKey: 'howToTake',
  },
  {
    label: 'Warnings',
    patientKey: 'warnings',
    clinicalKey: 'warnings',
  },
  {
    label: 'Storage',
    patientKey: 'storage',
    clinicalKey: 'storage',
  },
] as const;

function DetailRow({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null;

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
      <p className="mt-1 text-sm leading-6 text-text-primary">{value}</p>
    </div>
  );
}

function patientEducationLinks(sourceRefs?: Record<string, unknown>) {
  const refs = sourceRefs?.patientEducation;
  return (Array.isArray(refs) ? refs : refs ? [refs] : [])
    .filter((ref): ref is Record<string, unknown> => Boolean(ref) && typeof ref === 'object')
    .map((ref) => ({
      title: String(ref.title ?? ref.provider ?? 'Patient education'),
      url: String(ref.url ?? ''),
    }))
    .filter((link) => link.url.startsWith('http'));
}

function trustedSourceLabels(sourceRefs?: Record<string, unknown>) {
  return Array.from(
    new Set(
      Object.values(sourceRefs ?? {})
        .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
        .filter((ref): ref is Record<string, unknown> => Boolean(ref) && typeof ref === 'object')
        .map((ref) => String(ref.provider ?? ref.sourceType ?? '').trim())
        .filter(Boolean),
    ),
  );
}

function formatPrice(price?: string | null, currency = 'INR') {
  if (!price) return null;
  const value = Number(price);
  if (!Number.isFinite(value)) return `${currency} ${price}`;
  if (currency === 'INR') return `Rs ${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
  return `${currency} ${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
}

function enrichmentTone(status?: string): BadgeTone {
  if (status === 'COMPLETE') return 'success';
  if (status === 'PARTIAL') return 'info';
  return 'warning';
}

function enrichmentLabel(status?: string) {
  if (status === 'COMPLETE') return 'Full details ready';
  if (status === 'PARTIAL') return 'Partial details';
  return 'Verification pending';
}

function detailValue(enrichment: MedicineEnrichment | undefined, field: (typeof CORE_DETAIL_FIELDS)[number]) {
  const patient = enrichment?.patientExplanation as Record<string, unknown> | null | undefined;
  const patientValue = patient?.[field.patientKey];
  const clinicalValue = enrichment?.[field.clinicalKey];

  if (typeof patientValue === 'string' && patientValue.trim()) return patientValue;
  if (typeof clinicalValue === 'string' && clinicalValue.trim()) return clinicalValue;
  return null;
}

function detailCompletion(medicine: Medicine) {
  const enrichment = medicine.enrichment;
  const sideEffects =
    enrichment?.patientExplanation?.sideEffects?.length
      ? enrichment.patientExplanation.sideEffects
      : enrichment?.sideEffects ?? [];
  const available: Array<{ label: string; value: string }> = [];
  const missing: string[] = [];

  for (const field of CORE_DETAIL_FIELDS) {
    const value = detailValue(enrichment, field);
    if (value) {
      available.push({ label: field.label, value });
    } else {
      missing.push(field.label);
    }
  }

  if (sideEffects.length) {
    available.push({ label: 'Possible side effects', value: sideEffects.join(', ') });
  } else {
    missing.push('Possible side effects');
  }

  return { available, missing, sideEffects };
}

function detailStatusCopy(medicine: Medicine) {
  if (!medicine.medicineMasterId) {
    return 'This medicine is saved manually. It can be used for reminders, but clinical guidance appears only after it is linked to a verified master record.';
  }

  const status = medicine.enrichment?.enrichmentStatus;
  if (status === 'COMPLETE') {
    return 'All core patient guidance fields have trusted sources and are ready to show.';
  }

  if (status === 'PARTIAL') {
    return 'Some trusted details are ready. Missing fields stay hidden until a source is found.';
  }

  return 'Trusted details are being verified from RxNorm, openFDA, DailyMed, MedlinePlus, NFI/IPC, CDSCO, or admin sources. Nothing is guessed while this is pending.';
}

function ClinicalDetailsCard({
  medicine,
  isRefreshing,
  onRefresh,
  isRequesting,
  onRequest,
}: {
  medicine: Medicine;
  isRefreshing: boolean;
  onRefresh: () => void;
  isRequesting: boolean;
  onRequest: () => void;
}) {
  const enrichment = medicine.enrichment;
  const completion = detailCompletion(medicine);
  const hasDetails = completion.available.length > 0;
  const sources = trustedSourceLabels(enrichment?.sourceRefs);
  const educationLinks = patientEducationLinks(enrichment?.sourceRefs);
  const patientExplanation = enrichment?.patientExplanation ?? null;
  const status = enrichment?.enrichmentStatus ?? 'NEEDS_SOURCE';

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-4 w-4 text-brand-400" /> Patient-friendly details
          </CardTitle>
          <p className="mt-1 text-xs leading-5 text-text-muted">{detailStatusCopy(medicine)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <Badge tone={enrichmentTone(status)} dot>
            {enrichmentLabel(status)}
          </Badge>
          {medicine.medicineMasterId && status !== 'COMPLETE' && (
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                leftIcon={isRequesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                onClick={onRequest}
                disabled={isRequesting}
              >
                Request details
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                leftIcon={isRefreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                onClick={onRefresh}
                disabled={isRefreshing}
              >
                Refresh
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasDetails ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <DetailRow label="Composition" value={enrichment?.composition} />
            {CORE_DETAIL_FIELDS.map((field) => (
              <DetailRow key={field.label} label={field.label} value={detailValue(enrichment, field)} />
            ))}
            <DetailRow label="When to take" value={enrichment?.whenToTake} />
            {completion.sideEffects.length ? (
              <div className="sm:col-span-2">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Possible side effects</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {completion.sideEffects.map((effect) => (
                    <Badge key={effect} tone="warning">
                      {effect}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
            <div className="flex items-start gap-3">
              <Clock className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <p className="text-sm font-semibold text-text-primary">Medicine details are being verified</p>
                <p className="mt-1 text-sm leading-6 text-text-muted">
                  Identity, composition, package, price, and reminders still work. Patient guidance will appear as soon as trusted source text has been reviewed.
                </p>
              </div>
            </div>
          </div>
        )}

        {completion.missing.length > 0 && medicine.medicineMasterId && (
          <div className="rounded-lg border border-border bg-bg-inset p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Awaiting verification</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {completion.missing.map((field) => (
                    <Badge key={field} tone="muted">
                      {field}
                    </Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {sources.length > 0 && (
          <div className="rounded-lg border border-border bg-bg-inset p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Trusted sources used</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {sources.map((source) => (
                <Badge key={source} tone="info">
                  {source}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {educationLinks.length > 0 && (
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-text-muted">Patient education</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {educationLinks.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm font-medium text-brand-300 underline-offset-4 hover:underline"
                >
                  {link.title}
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="flex items-start gap-2 rounded-lg border border-border bg-bg-inset px-3 py-2 text-xs text-text-muted">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
          {patientExplanation?.disclaimer ?? enrichment?.disclaimer ??
            'Information is for education only and is not medical advice. Follow your doctor or pharmacist instructions.'}
        </div>
      </CardContent>
    </Card>
  );
}

export default function MedicineDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isRequestingDetails, setIsRequestingDetails] = useState(false);

  const { data: medicine, isLoading, isFetching, refetch } = useMedicine(id);
  const { data: schedules, isLoading: schedulesLoading } = useSchedules({ medicineId: id });
  const updateMedicine = useUpdateMedicine(id ?? '');
  const deleteMedicine = useDeleteMedicine();
  const createSchedule = useCreateSchedule();
  const deleteSchedule = useDeleteSchedule();

  if (isLoading) return <LoadingScreen label="Loading medicine..." />;
  if (!medicine) {
    return (
      <EmptyState
        title="Medicine not found"
        description="It may have been removed."
        action={<Button onClick={() => navigate(ROUTES.MEDICINES)}>Back to medicines</Button>}
      />
    );
  }

  const meta = MEDICINE_FORMS.find((f) => f.value === medicine.form);
  const pack = medicine.package ?? medicine.master?.packages?.[0] ?? null;
  const price = formatPrice(pack?.mrpPrice, pack?.priceCurrency ?? 'INR');
  const composition =
    medicine.master?.composition ??
    medicine.master?.saltProfile?.displayName ??
    medicine.genericName;

  const handleUpdate = (values: MedicineFormValues) => {
    const payload: UpdateMedicinePayload = {
      medicineMasterId: values.medicineMasterId || undefined,
      medicinePackageId: values.medicinePackageId || undefined,
      name: values.name,
      form: values.form,
      stockQuantity: values.stockQuantity,
      brandName: values.brandName || undefined,
      genericName: values.genericName || undefined,
      strength: values.strength || undefined,
      unit: values.unit || undefined,
      refillThreshold: values.refillThreshold ?? undefined,
      source: values.source,
      userStripImageUrl: values.userStripImageUrl || undefined,
      userStripOcrText: values.userStripOcrText || undefined,
      userStripOcrEngine: values.userStripOcrEngine || undefined,
      visualConfirmed: values.visualConfirmed,
      notes: values.notes || undefined,
    };
    updateMedicine.mutate(payload, {
      onSuccess: () => {
        notify.success('Medicine updated');
        setEditOpen(false);
      },
      onError: (err) => notify.error(extractErrorMessage(err, 'Update failed')),
    });
  };

  const handleCreateSchedule = (values: ScheduleFormValues) => {
    const payload: CreateSchedulePayload = {
      medicineId: values.medicineId,
      frequency: values.frequency,
      timesOfDay: values.frequency === 'AS_NEEDED' ? [] : values.timesOfDay,
      dosesPerIntake: values.dosesPerIntake,
      unit: values.unit,
      startDate: values.startDate,
      ...(values.daysOfWeek && values.daysOfWeek.length ? { daysOfWeek: values.daysOfWeek } : {}),
      ...(values.endDate ? { endDate: values.endDate } : {}),
      ...(values.notes ? { notes: values.notes } : {}),
    };
    createSchedule.mutate(payload, {
      onSuccess: () => {
        notify.success('Schedule added');
        setScheduleOpen(false);
      },
      onError: (err) => notify.error(extractErrorMessage(err, 'Failed to add schedule')),
    });
  };

  const handleDelete = () => {
    deleteMedicine.mutate(medicine.id, {
      onSuccess: () => {
        notify.success('Medicine deleted');
        navigate(ROUTES.MEDICINES);
      },
      onError: (err) => notify.error(extractErrorMessage(err, 'Delete failed')),
    });
  };

  const handleRefreshDetails = () => {
    void refetch();
  };

  const handleRequestDetails = async () => {
    setIsRequestingDetails(true);

    try {
      const result = await medicinesService.requestClinicalDetails(medicine.id);
      notify.success(
        result.alreadyAvailable
          ? result.message
          : `${result.message}${result.demandCount ? ` Demand: ${result.demandCount}` : ''}`,
      );
      void refetch();
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to request details'));
    } finally {
      setIsRequestingDetails(false);
    }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => navigate(ROUTES.MEDICINES)}
        className="mb-4 flex items-center gap-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
      >
        <ArrowLeft className="h-4 w-4" /> Back to medicines
      </button>

      <PageHeader
        title={`${meta?.emoji ?? ''} ${medicine.name}`}
        description={[meta?.label, medicine.strength, `${medicine.stockQuantity} ${medicine.unit ?? 'in stock'}`]
          .filter(Boolean)
          .join(' | ')}
        actions={
          <>
            <Button variant="secondary" leftIcon={<Pencil className="h-4 w-4" />} onClick={() => setEditOpen(true)}>
              Edit
            </Button>
            <Button variant="danger" leftIcon={<Trash2 className="h-4 w-4" />} onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          </>
        }
      />

      {!medicine.medicineMasterId && (
        <div className="mb-4 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Not verified in Medicine Master</p>
            <p className="mt-1 text-xs">
              This medicine was saved manually and queued for admin review. Reminders still work,
              but clinical details stay unavailable until it is linked to a verified master.
            </p>
          </div>
        </div>
      )}

      <Card className="mb-4">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-brand-400" /> Medicine identity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <DetailRow label="Brand" value={medicine.master?.brandName ?? medicine.brandName ?? medicine.name} />
            <DetailRow label="Composition" value={composition} />
            <DetailRow label="Salt profile" value={medicine.master?.saltProfile?.displayName} />
            <DetailRow label="Manufacturer" value={medicine.master?.manufacturer} />
            <DetailRow label="Package" value={pack?.packSize} />
            <DetailRow
              label="MRP / source"
              value={[price, pack?.priceSource].filter(Boolean).join(' | ') || null}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {medicine.master?.prescriptionRequired === true && (
              <Badge tone="warning">Prescription required</Badge>
            )}
            {medicine.master?.prescriptionRequired === false && (
              <Badge tone="success">No Rx flag in dataset</Badge>
            )}
            {medicine.master?.isDiscontinued && <Badge tone="danger">Discontinued</Badge>}
            {medicine.enrichment?.patientExplanation && <Badge tone="success">Patient wording ready</Badge>}
            <Badge tone={enrichmentTone(medicine.enrichment?.enrichmentStatus)}>
              {enrichmentLabel(medicine.enrichment?.enrichmentStatus)}
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="mb-4 grid gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ImageIcon className="h-4 w-4 text-brand-400" /> Visual confirmation
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="min-h-36 rounded-lg border border-border bg-bg-inset p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Reference strip</p>
                {medicine.userStripImageUrl ? (
                  <ProtectedImage
                    src={medicine.userStripImageUrl}
                    alt={`${medicine.name} saved strip reference`}
                    className="max-h-40 w-full rounded"
                  />
                ) : medicine.enrichment?.stripImageUrl ? (
                  <img
                    src={medicine.enrichment.stripImageUrl}
                    alt={`${medicine.name} strip reference`}
                    className="max-h-40 w-full rounded object-contain"
                  />
                ) : (
                  <div className="flex min-h-28 items-center justify-center rounded border border-dashed border-border text-center text-xs text-text-muted">
                    Strip image unavailable. Confirm by text: {medicine.name}
                    {medicine.strength ? ` ${medicine.strength}` : ''}
                  </div>
                )}
              </div>
              <div className="min-h-36 rounded-lg border border-border bg-bg-inset p-3">
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">Pill / product image</p>
                {medicine.enrichment?.pillImageUrl ? (
                  <img
                    src={medicine.enrichment.pillImageUrl}
                    alt={`${medicine.name} pill reference`}
                    className="max-h-40 w-full rounded object-contain"
                  />
                ) : (
                  <div className="flex min-h-28 items-center justify-center rounded border border-dashed border-border text-center text-xs text-text-muted">
                    Product image unavailable. Confirm manufacturer:{' '}
                    {medicine.master?.manufacturer ?? 'not listed'}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              Confirm the medicine against your strip or box before relying on reminders.
            </div>
            <StripVerificationPanel medicine={medicine} />
          </CardContent>
        </Card>

        <ClinicalDetailsCard
          medicine={medicine}
          isRefreshing={isFetching && !isLoading}
          onRefresh={handleRefreshDetails}
          isRequesting={isRequestingDetails}
          onRequest={handleRequestDetails}
        />
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-brand-400" /> Schedules
          </CardTitle>
          <Button size="sm" leftIcon={<Plus className="h-4 w-4" />} onClick={() => setScheduleOpen(true)}>
            Add schedule
          </Button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {schedulesLoading ? (
            Array.from({ length: 2 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : !schedules || schedules.length === 0 ? (
            <EmptyState title="No schedules" description="Add a schedule to start tracking doses." className="border-none py-8" />
          ) : (
            schedules.map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-xl border border-border bg-surface-raised px-4 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-text-primary">{s.dosesPerIntake} {s.unit}</p>
                    <Badge tone={s.isActive ? 'success' : 'muted'}>
                      {FREQUENCIES.find((f) => f.value === s.frequency)?.label ?? s.frequency}
                    </Badge>
                  </div>
                  <p className="mt-0.5 text-xs text-text-muted">
                    {s.timesOfDay.length > 0
                      ? s.timesOfDay.map((time) => formatTime(`1970-01-01T${time}:00`)).join(', ')
                      : 'As needed'}{' '}
                    | from {formatDate(s.startDate)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Delete schedule"
                  onClick={() =>
                    deleteSchedule.mutate(s.id, {
                      onSuccess: () => notify.success('Schedule removed'),
                      onError: (err) => notify.error(extractErrorMessage(err, 'Failed to remove schedule')),
                    })
                  }
                >
                  <Trash2 className="h-4 w-4 text-danger" />
                </Button>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Edit medicine" size="lg">
        <MedicineForm
          defaultValues={medicine}
          isSubmitting={updateMedicine.isPending}
          submitLabel="Save changes"
          onSubmit={handleUpdate}
          onCancel={() => setEditOpen(false)}
        />
      </Modal>

      <Modal open={scheduleOpen} onClose={() => setScheduleOpen(false)} title="Add schedule" size="lg">
        <ScheduleEditor
          medicineId={medicine.id}
          defaultValues={{
            dosesPerIntake: 1,
            unit: medicine.unit ?? meta?.label.toLowerCase() ?? 'dose',
          }}
          isSubmitting={createSchedule.isPending}
          submitLabel="Add schedule"
          onSubmit={handleCreateSchedule}
          onCancel={() => setScheduleOpen(false)}
        />
      </Modal>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete medicine?"
        description="This permanently removes the medicine and its schedules. This cannot be undone."
        confirmLabel="Delete"
        destructive
        isLoading={deleteMedicine.isPending}
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(false)}
      />
    </div>
  );
}
