import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { AlertTriangle, CheckCircle2, Database, Loader2, Search } from 'lucide-react';
import { medicineSchema, type MedicineFormValues } from '@/validation/medicine.schema';
import { MEDICINE_FORMS } from '@/constants/app';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Textarea } from '@/components/ui/Textarea';
import { Button } from '@/components/ui/Button';
import { medicinesService } from '@/services/medicines.service';
import { notify } from '@/components/ui/Toast';
import { extractErrorMessage } from '@/lib/api-client';
import type { Medicine, MedicineForm as MedicineFormType, MedicineMasterSearchResult, PatientExplanation } from '@/types/medicine';

interface MedicineFormProps {
  defaultValues?: Partial<Medicine>;
  isSubmitting?: boolean;
  submitLabel?: string;
  onSubmit: (values: MedicineFormValues) => void;
  onCancel?: () => void;
}

const FORM_OPTIONS = MEDICINE_FORMS.map((f) => ({ value: f.value, label: `${f.emoji} ${f.label}` }));

function scoreTone(score?: number): BadgeTone {
  if ((score ?? 0) >= 0.9) return 'success';
  if ((score ?? 0) >= 0.7) return 'info';
  if ((score ?? 0) >= 0.5) return 'warning';
  return 'muted';
}

function scoreLabel(score?: number) {
  if (score === undefined || Number.isNaN(score)) return 'Match';
  if (score >= 0.95) return 'Exact';
  if (score >= 0.8) return 'Strong';
  if (score >= 0.65) return 'Possible';
  return 'Review';
}

function compositionText(master: MedicineMasterSearchResult) {
  return master.composition ?? master.genericName ?? master.saltProfile?.displayName ?? '';
}

function formatPrice(price?: string | null, currency = 'INR') {
  if (!price) return null;
  const value = Number(price);
  if (!Number.isFinite(value)) return `${currency} ${price}`;
  if (currency === 'INR') return `Rs ${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
  return `${currency} ${value.toFixed(value % 1 === 0 ? 0 : 2)}`;
}

function packageText(pack?: NonNullable<MedicineMasterSearchResult['packages']>[number] | null) {
  if (!pack) return null;
  return [pack.packSize, formatPrice(pack.mrpPrice, pack.priceCurrency ?? 'INR')]
    .filter(Boolean)
    .join(' | ');
}

function detailsTone(status?: string): BadgeTone {
  if (status === 'COMPLETE') return 'success';
  if (status === 'PARTIAL') return 'info';
  return 'muted';
}

function detailsLabel(status?: string) {
  if (status === 'COMPLETE') return 'Details ready';
  if (status === 'PARTIAL') return 'Some details';
  return 'Verification pending';
}

function trustedSourceLabels(master: MedicineMasterSearchResult) {
  const refs = Object.values(master.saltProfile?.sourceRefs ?? {})
    .flatMap((value) => (Array.isArray(value) ? value : value ? [value] : []))
    .filter((ref): ref is Record<string, unknown> => Boolean(ref) && typeof ref === 'object')
    .filter((ref) => {
      const sourceType = String(ref.sourceType ?? '').toLowerCase();
      const provider = String(ref.provider ?? '').toLowerCase();
      return ['openfda', 'rxnorm', 'dailymed', 'medlineplus', 'admin', 'web_assisted', 'nfi_ipc', 'cdsco'].includes(sourceType) || provider === 'admin' || provider.includes('indian pharmacopoeia commission');
    })
    .map((ref) => String(ref.provider ?? ref.sourceType ?? 'source'));

  return Array.from(new Set(refs));
}


function patientEducationLinks(master: MedicineMasterSearchResult) {
  const refs = master.saltProfile?.sourceRefs?.patientEducation;
  return (Array.isArray(refs) ? refs : refs ? [refs] : [])
    .filter((ref): ref is Record<string, unknown> => Boolean(ref) && typeof ref === 'object')
    .map((ref) => ({
      title: String(ref.title ?? ref.provider ?? 'Patient education'),
      url: String(ref.url ?? ''),
    }))
    .filter((link) => link.url.startsWith('http'));
}
function hasClinicalPreview(master: MedicineMasterSearchResult) {
  const profile = master.saltProfile;
  return Boolean(
    profile?.uses ||
      profile?.howToTake ||
      profile?.warnings ||
      profile?.storage ||
      profile?.sideEffects?.length,
  );
}


function needsClinicalRefresh(master?: MedicineMasterSearchResult | null) {
  if (!master?.saltProfile?.id) return false;
  if (master.saltProfile.enrichmentStatus === 'COMPLETE') return false;
  return !hasClinicalPreview(master);
}

function hasPatientExplanationText(explanation?: PatientExplanation | null) {
  return Boolean(
    explanation?.whyPrescribed ||
      explanation?.howToTake ||
      explanation?.warnings ||
      explanation?.storage ||
      explanation?.sideEffects?.length,
  );
}

function patientExplanationForMaster(master?: MedicineMasterSearchResult | null) {
  const explanations = master?.saltProfile?.patientExplanations ?? [];
  return (
    explanations.find((explanation) => explanation.language === 'en' && hasPatientExplanationText(explanation)) ??
    explanations.find((explanation) => hasPatientExplanationText(explanation)) ??
    null
  );
}
function strengthFromMaster(master: MedicineMasterSearchResult) {
  if (master.strength) return master.strength;
  const text = compositionText(master);
  return /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|ml|iu|units?|%)\b/i.exec(text)?.[0]?.replace(/\s+/g, '') ?? '';
}

function formFromMaster(master: MedicineMasterSearchResult): MedicineFormType {
  const text = `${master.type ?? ''} ${master.brandName ?? ''} ${master.packages?.[0]?.packSize ?? ''}`.toLowerCase();
  if (/\b(cap|caps|capsule)\b/.test(text)) return 'CAPSULE';
  if (/\b(syrup|syp|suspension|susp|oral suspension)\b/.test(text)) return 'SYRUP';
  if (/\b(inj|injection|vial|ampoule)\b/.test(text)) return 'INJECTION';
  if (/\b(drop|drops)\b/.test(text)) return 'DROPS';
  if (/\b(inhaler)\b/.test(text)) return 'INHALER';
  if (/\b(patch)\b/.test(text)) return 'PATCH';
  if (/\b(cream)\b/.test(text)) return 'CREAM';
  if (/\b(oint|ointment)\b/.test(text)) return 'OINTMENT';
  if (/\b(powder|sachet)\b/.test(text)) return 'POWDER';
  return 'TABLET';
}

function unitForForm(form: MedicineFormType) {
  const units: Partial<Record<MedicineFormType, string>> = {
    TABLET: 'tablets',
    CAPSULE: 'capsules',
    SYRUP: 'ml',
    INJECTION: 'units',
    DROPS: 'ml',
    INHALER: 'puffs',
    PATCH: 'patches',
    CREAM: 'g',
    OINTMENT: 'g',
    POWDER: 'sachets',
  };

  return units[form] ?? 'units';
}

export function MedicineForm({
  defaultValues,
  isSubmitting,
  submitLabel = 'Save medicine',
  onSubmit,
  onCancel,
}: MedicineFormProps) {
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<MedicineFormValues>({
    resolver: zodResolver(medicineSchema),
    defaultValues: {
      medicineMasterId: defaultValues?.medicineMasterId ?? '',
      medicinePackageId: defaultValues?.medicinePackageId ?? '',
      name: defaultValues?.name ?? '',
      genericName: defaultValues?.genericName ?? '',
      brandName: defaultValues?.brandName ?? '',
      form: defaultValues?.form ?? 'TABLET',
      strength: defaultValues?.strength ?? '',
      unit: defaultValues?.unit ?? '',
      stockQuantity: defaultValues?.stockQuantity ?? 0,
      refillThreshold: defaultValues?.refillThreshold ?? undefined,
      source: defaultValues?.source ?? 'MANUAL',
      userStripImageUrl: defaultValues?.userStripImageUrl ?? '',
      visualConfirmed: defaultValues?.visualConfirmed ?? false,
      notes: defaultValues?.notes ?? '',
    },
  });
  const [masterQuery, setMasterQuery] = useState(defaultValues?.name ?? '');
  const [masterResults, setMasterResults] = useState<MedicineMasterSearchResult[]>([]);
  const [selectedMaster, setSelectedMaster] = useState<MedicineMasterSearchResult | null>(
    defaultValues?.master ?? null,
  );
  const [isSearching, setIsSearching] = useState(false);
  const [isLoadingMasterDetails, setIsLoadingMasterDetails] = useState(false);
  const [masterDetailsFailed, setMasterDetailsFailed] = useState(false);
  const [isRefreshingDetails, setIsRefreshingDetails] = useState(false);
  const [isRequestingDetails, setIsRequestingDetails] = useState(false);
  const [showClinicalPreview, setShowClinicalPreview] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [lastSearchedQuery, setLastSearchedQuery] = useState('');
  const detailRequestRef = useRef(0);
  const selectedMasterId = watch('medicineMasterId');
  const selectedPackageId = watch('medicinePackageId');
  const selectedPackage =
    selectedMaster?.packages?.find((pack) => pack.id === selectedPackageId) ??
    selectedMaster?.packages?.[0] ??
    null;
  const selectedPatientExplanation = patientExplanationForMaster(selectedMaster);

  useEffect(() => {
    const query = masterQuery.trim();

    if (selectedMaster && query === selectedMaster.brandName.trim()) {
      setMasterResults([]);
      setSearchFailed(false);
      setLastSearchedQuery('');
      setIsSearching(false);
      return;
    }

    if (query.length < 2) {
      setMasterResults([]);
      setSearchFailed(false);
      setLastSearchedQuery('');
      setIsSearching(false);
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
    setIsSearching(true);
    const timeout = window.setTimeout(async () => {
      setSearchFailed(false);

      try {
        const results = await medicinesService.searchMaster(query, 10, controller.signal);

        if (!cancelled) {
          setMasterResults(results);
          setLastSearchedQuery(query);
        }
      } catch {
        if (!cancelled && !controller.signal.aborted) {
          setMasterResults([]);
          setSearchFailed(true);
          setLastSearchedQuery(query);
        }
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [masterQuery, selectedMaster]);

  const selectedMasterResultId = selectedMaster?.id;
  const selectedMasterResultScore = selectedMaster?.score;
  const selectedMasterResultNeedsRefresh = selectedMaster
    ? needsClinicalRefresh(selectedMaster)
    : false;

  useEffect(() => {
    if (!selectedMasterResultId || !selectedMasterResultNeedsRefresh) {
      setIsRefreshingDetails(false);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    let timeoutId: number | undefined;
    const selectedId = selectedMasterResultId;
    const selectedScore = selectedMasterResultScore;

    const refreshSelectedMaster = async () => {
      attempts += 1;
      setIsRefreshingDetails(true);

      try {
        const fresh = await medicinesService.getMaster(selectedId);
        if (cancelled) return;
        setMasterDetailsFailed(false);

        const freshWithScore = { ...fresh, score: selectedScore ?? fresh.score };
        setSelectedMaster((current) =>
          current?.id === selectedId ? freshWithScore : current,
        );
        setMasterResults((current) =>
          current.map((item) => (item.id === selectedId ? freshWithScore : item)),
        );

        if (needsClinicalRefresh(fresh) && attempts < 8) {
          timeoutId = window.setTimeout(refreshSelectedMaster, 5000);
          return;
        }
      } catch {
        if (!cancelled && attempts < 4) {
          timeoutId = window.setTimeout(refreshSelectedMaster, 7000);
          return;
        }
      }

      if (!cancelled) {
        setIsRefreshingDetails(false);
      }
    };

    timeoutId = window.setTimeout(refreshSelectedMaster, 2500);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    selectedMasterResultId,
    selectedMasterResultNeedsRefresh,
    selectedMasterResultScore,
  ]);
  const handleMasterQueryChange = (value: string) => {
    setMasterQuery(value);

    if (selectedMaster && value.trim() !== selectedMaster.brandName.trim()) {
      detailRequestRef.current += 1;
      setIsLoadingMasterDetails(false);
      setMasterDetailsFailed(false);
      setSelectedMaster(null);
      setShowClinicalPreview(false);
      setMasterResults([]);
      setValue('medicineMasterId', '', { shouldDirty: true });
      setValue('medicinePackageId', '', { shouldDirty: true });
    }
  };

  const loadMasterDetails = async (master: MedicineMasterSearchResult) => {
    const requestId = ++detailRequestRef.current;
    setIsLoadingMasterDetails(true);
    setMasterDetailsFailed(false);

    try {
      const fresh = await medicinesService.getMaster(master.id);
      if (detailRequestRef.current !== requestId) return;

      setSelectedMaster((current) =>
        current?.id === master.id
          ? { ...fresh, score: current.score ?? fresh.score, matchReason: current.matchReason }
          : current,
      );
    } catch {
      if (detailRequestRef.current === requestId) {
        setMasterDetailsFailed(true);
      }
    } finally {
      if (detailRequestRef.current === requestId) {
        setIsLoadingMasterDetails(false);
      }
    }
  };
  const selectMaster = (master: MedicineMasterSearchResult) => {
    const nextForm = formFromMaster(master);
    const nextStrength = strengthFromMaster(master);
    const nextComposition = compositionText(master);

    setSelectedMaster(master);
    setShowClinicalPreview(false);
    setMasterQuery(master.brandName);
    setMasterResults([]);
    setValue('medicineMasterId', master.id, { shouldValidate: true, shouldDirty: true });
    setValue('medicinePackageId', master.packages?.[0]?.id ?? '', {
      shouldValidate: true,
      shouldDirty: true,
    });
    setValue('name', master.brandName, { shouldValidate: true, shouldDirty: true });
    setValue('brandName', master.brandName, { shouldValidate: true, shouldDirty: true });
    setValue('genericName', nextComposition, { shouldValidate: true, shouldDirty: true });
    setValue('strength', nextStrength, { shouldValidate: true, shouldDirty: true });
    setValue('form', nextForm, { shouldValidate: true, shouldDirty: true });

    if (!watch('unit')) {
      setValue('unit', unitForForm(nextForm), { shouldDirty: true });
    }

    void loadMasterDetails(master);
  };

  const clearMaster = () => {
    detailRequestRef.current += 1;
    setIsLoadingMasterDetails(false);
    setMasterDetailsFailed(false);
    setSelectedMaster(null);
    setShowClinicalPreview(false);
    setValue('medicineMasterId', '', { shouldDirty: true });
    setValue('medicinePackageId', '', { shouldDirty: true });
  };

  const requestSelectedMasterDetails = async () => {
    if (!selectedMaster) return;

    setIsRequestingDetails(true);
    try {
      const result = await medicinesService.requestMasterClinicalDetails(
        selectedMaster.id,
        selectedPackage?.id,
      );
      notify.success(
        result.alreadyAvailable
          ? result.message
          : `${result.message}${result.demandCount ? ` Demand: ${result.demandCount}` : ''}`,
      );

      try {
        const fresh = await medicinesService.getMaster(selectedMaster.id);
        setSelectedMaster((current) =>
          current?.id === selectedMaster.id
            ? { ...fresh, score: current.score ?? fresh.score }
            : current,
        );
      } catch {
        // The request is already queued; failing to refresh the preview should not block the user.
      }
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to request details'));
    } finally {
      setIsRequestingDetails(false);
    }
  };
  const useManualMedicine = () => {
    const name = masterQuery.trim();

    if (!name) return;

    clearMaster();
    setValue('name', name, { shouldValidate: true, shouldDirty: true });
    setValue('brandName', name, { shouldDirty: true });
    setValue('source', 'MANUAL', { shouldDirty: true });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4" noValidate>
      <input type="hidden" {...register('medicineMasterId')} />
      <input type="hidden" {...register('medicinePackageId')} />
      <input type="hidden" {...register('source')} />
      <input type="hidden" {...register('visualConfirmed')} />
      <input type="hidden" {...register('userStripOcrText')} />
      <input type="hidden" {...register('userStripOcrEngine')} />

      <div className="rounded-lg border border-border bg-surface-raised p-3">
        <Input
          label="Search medicine master"
          placeholder="Type brand or composition, e.g. Dolo, Azithromycin"
          leftIcon={<Search className="h-4 w-4" />}
          value={masterQuery}
          onChange={(event) => handleMasterQueryChange(event.target.value)}
          hint={
            selectedMasterId
              ? 'Master medicine selected. You can still edit fields below.'
              : 'Choose a result when possible; use manual entry if not found.'
          }
        />

        {isSearching && <p className="mt-2 text-xs text-text-muted">Searching medicine master...</p>}
        {searchFailed && !isSearching && (
          <p className="mt-2 text-xs text-danger">
            Medicine master search is unavailable. Check that the backend server is running.
          </p>
        )}
        {!searchFailed &&
          !isSearching &&
          masterQuery.trim().length >= 2 &&
          lastSearchedQuery === masterQuery.trim() &&
          masterResults.length === 0 && (
          <p className="mt-2 text-xs text-text-muted">
            No master match found. You can continue with manual entry.
          </p>
        )}

        {masterResults.length > 0 && (
          <div className="mt-2 overflow-hidden rounded-lg border border-border">
            {masterResults.map((master) => (
              <button
                key={master.id}
                type="button"
                className="flex w-full items-start gap-3 border-b border-border bg-bg-inset px-3 py-2.5 text-left last:border-b-0 hover:bg-surface-hover"
                onClick={() => selectMaster(master)}
              >
                <Database className="mt-0.5 h-4 w-4 shrink-0 text-brand-400" />
                <span className="min-w-0">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-text-primary">
                      {master.brandName}
                    </span>
                    {master.isDiscontinued && <Badge tone="warning">Discontinued</Badge>}
                  </span>
                  <span className="block truncate text-xs text-text-muted">
                    {[master.composition, master.manufacturer, packageText(master.packages?.[0])]
                      .filter(Boolean)
                      .join(' | ')}
                  </span>
                  {master.saltProfile?.displayName && master.saltProfile.displayName !== master.composition && (
                    <span className="block truncate text-xs text-text-muted">
                      Salt: {master.saltProfile.displayName}
                    </span>
                  )}
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {master.prescriptionRequired === true && <Badge tone="warning">Rx required</Badge>}
                    {master.prescriptionRequired === false && <Badge tone="success">OTC / no Rx flag</Badge>}
                    {master.packages?.[0]?.priceSource && (
                      <Badge tone="muted">{master.packages[0].priceSource}</Badge>
                    )}
                    <Badge tone={detailsTone(master.saltProfile?.enrichmentStatus)}>
                      {detailsLabel(master.saltProfile?.enrichmentStatus)}
                    </Badge>
                    {master.matchReason && (
                      <Badge tone={master.matchReason === 'composition' ? 'info' : 'muted'}>
                        {master.matchReason === 'composition' ? 'Composition match' : 'Brand match'}
                      </Badge>
                    )}
                  </span>
                </span>
                <Badge tone={scoreTone(master.score)} className="ml-auto shrink-0">
                  {scoreLabel(master.score)} {Math.round((master.score ?? 0) * 100)}%
                </Badge>
              </button>
            ))}
          </div>
        )}

        {!selectedMasterId && masterQuery.trim().length >= 2 && (
          <div className="mt-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <p className="text-xs text-warning">
                Manual medicines stay usable, but remain unverified until admin review.
              </p>
            </div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="mt-2"
              onClick={useManualMedicine}
            >
              Use typed name
            </Button>
          </div>
        )}

        {selectedMaster && (
          <div className="mt-3 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-success" />
                  <p className="text-sm font-semibold text-text-primary">{selectedMaster.brandName}</p>
                  <Badge tone={scoreTone(selectedMaster.score)}>
                    {scoreLabel(selectedMaster.score)}
                  </Badge>
                </div>
                <p className="mt-0.5 text-xs text-text-muted">
                  {[
                    compositionText(selectedMaster) || 'Composition not available',
                    selectedMaster.manufacturer,
                    selectedPackage?.packSize,
                  ]
                    .filter(Boolean)
                    .join(' | ')}
                </p>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={clearMaster}>
                Clear
              </Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="col-span-2 grid gap-2 rounded-lg border border-border bg-bg-inset p-3 text-xs sm:grid-cols-2">
                <div>
                  <p className="font-medium uppercase tracking-wide text-text-muted">Composition</p>
                  <p className="mt-1 text-text-primary">
                    {compositionText(selectedMaster) || 'Not listed'}
                  </p>
                </div>
                <div>
                  <p className="font-medium uppercase tracking-wide text-text-muted">Manufacturer</p>
                  <p className="mt-1 text-text-primary">
                    {selectedMaster.manufacturer ?? 'Not listed'}
                  </p>
                </div>
                <div>
                  <p className="font-medium uppercase tracking-wide text-text-muted">Package</p>
                  <p className="mt-1 text-text-primary">
                    {selectedPackage?.packSize ?? 'Not listed'}
                  </p>
                </div>
                <div>
                  <p className="font-medium uppercase tracking-wide text-text-muted">MRP / source</p>
                  <p className="mt-1 text-text-primary">
                    {[formatPrice(selectedPackage?.mrpPrice, selectedPackage?.priceCurrency ?? 'INR'), selectedPackage?.priceSource]
                      .filter(Boolean)
                      .join(' | ') || 'Not listed'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:col-span-2">
                  {selectedMaster.prescriptionRequired === true && <Badge tone="warning">Prescription required</Badge>}
                  {selectedMaster.prescriptionRequired === false && <Badge tone="success">No Rx flag in dataset</Badge>}
                  <Badge tone={detailsTone(selectedMaster.saltProfile?.enrichmentStatus)}>
                    {detailsLabel(selectedMaster.saltProfile?.enrichmentStatus)}
                  </Badge>
                  {isRefreshingDetails && (
                    <Badge tone="info">
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Fetching trusted details
                      </span>
                    </Badge>
                  )}
                  {isLoadingMasterDetails && (
                    <Badge tone="info">
                      <span className="inline-flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading full details
                      </span>
                    </Badge>
                  )}
                  {selectedMaster.saltProfile?.displayName && (
                    <Badge tone="brand">{selectedMaster.saltProfile.displayName}</Badge>
                  )}
                </div>
              </div>
              {masterDetailsFailed && (
                <div className="col-span-2 flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning/10 p-3">
                  <p className="text-xs text-warning">
                    Medicine selected, but its full details could not be loaded.
                  </p>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => void loadMasterDetails(selectedMaster)}
                  >
                    Retry
                  </Button>
                </div>
              )}
              {selectedPatientExplanation && (
                <div className="col-span-2 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 text-xs">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <p className="font-medium uppercase tracking-wide text-text-muted">
                      Patient-friendly explanation
                    </p>
                    <Badge tone="info">{selectedPatientExplanation.language.toUpperCase()}</Badge>
                    <Badge tone={selectedPatientExplanation.status === 'REVIEWED' ? 'success' : 'info'}>
                      {selectedPatientExplanation.status === 'REVIEWED' ? 'Reviewed' : 'Source-backed draft'}
                    </Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedPatientExplanation.whyPrescribed && (
                      <div>
                        <p className="font-medium text-text-muted">Why this may be prescribed</p>
                        <p className="mt-1 leading-5 text-text-primary">{selectedPatientExplanation.whyPrescribed}</p>
                      </div>
                    )}
                    {selectedPatientExplanation.howToTake && (
                      <div>
                        <p className="font-medium text-text-muted">How to take it</p>
                        <p className="mt-1 leading-5 text-text-primary">{selectedPatientExplanation.howToTake}</p>
                      </div>
                    )}
                    {selectedPatientExplanation.warnings && (
                      <div>
                        <p className="font-medium text-text-muted">Important warnings</p>
                        <p className="mt-1 leading-5 text-text-primary">{selectedPatientExplanation.warnings}</p>
                      </div>
                    )}
                    {selectedPatientExplanation.storage && (
                      <div>
                        <p className="font-medium text-text-muted">Storage</p>
                        <p className="mt-1 leading-5 text-text-primary">{selectedPatientExplanation.storage}</p>
                      </div>
                    )}
                    {selectedPatientExplanation.sideEffects?.length ? (
                      <div className="sm:col-span-2">
                        <p className="font-medium text-text-muted">Possible side effects</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {selectedPatientExplanation.sideEffects.slice(0, 8).map((effect) => (
                            <Badge key={effect} tone="warning">
                              {effect}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-3 border-t border-brand-500/20 pt-2 leading-5 text-text-muted">
                    {selectedPatientExplanation.disclaimer}
                  </p>
                </div>
              )}
              {selectedPatientExplanation && (
                <div className="col-span-2 flex items-center justify-between gap-3 rounded-lg border border-border bg-bg-inset px-3 py-2 text-xs">
                  <p className="text-text-muted">Clinical source text is available for traceability.</p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowClinicalPreview((value) => !value)}
                  >
                    {showClinicalPreview ? 'Hide source text' : 'View source text'}
                  </Button>
                </div>
              )}
              {(!selectedPatientExplanation || showClinicalPreview) && (
              <div className="col-span-2 rounded-lg border border-border bg-bg-inset p-3 text-xs">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium uppercase tracking-wide text-text-muted">
                      Verified guidance status
                    </p>
                    {trustedSourceLabels(selectedMaster).map((source) => (
                      <Badge key={source} tone="info">
                        {source}
                      </Badge>
                    ))}
                  </div>
                  {selectedMaster.saltProfile?.id && selectedMaster.saltProfile.enrichmentStatus !== 'COMPLETE' && (
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      leftIcon={isRequestingDetails ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5" />}
                      onClick={requestSelectedMasterDetails}
                      disabled={isRequestingDetails}
                    >
                      Ask admin
                    </Button>
                  )}
                </div>
                {hasClinicalPreview(selectedMaster) ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {selectedMaster.saltProfile?.uses && (
                      <div>
                        <p className="font-medium text-text-muted">Why prescribed</p>
                        <p className="mt-1 leading-5 text-text-primary">{selectedMaster.saltProfile.uses}</p>
                      </div>
                    )}
                    {selectedMaster.saltProfile?.howToTake && (
                      <div>
                        <p className="font-medium text-text-muted">How to take</p>
                        <p className="mt-1 leading-5 text-text-primary">{selectedMaster.saltProfile.howToTake}</p>
                      </div>
                    )}
                    {selectedMaster.saltProfile?.warnings && (
                      <div>
                        <p className="font-medium text-text-muted">Warnings</p>
                        <p className="mt-1 leading-5 text-text-primary">{selectedMaster.saltProfile.warnings}</p>
                      </div>
                    )}
                    {selectedMaster.saltProfile?.storage && (
                      <div>
                        <p className="font-medium text-text-muted">Storage</p>
                        <p className="mt-1 leading-5 text-text-primary">{selectedMaster.saltProfile.storage}</p>
                      </div>
                    )}
                    {selectedMaster.saltProfile?.sideEffects?.length ? (
                      <div className="sm:col-span-2">
                        <p className="font-medium text-text-muted">Possible side effects</p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {selectedMaster.saltProfile.sideEffects.slice(0, 8).map((effect) => (
                            <Badge key={effect} tone="warning">
                              {effect}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div className="flex items-start gap-2 leading-5 text-text-muted">
                    {isRefreshingDetails && <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
                    <p>
                      {isRefreshingDetails
                        ? 'Checking trusted clinical sources. This panel will update automatically when verified guidance is ready.'
                        : 'Verified patient guidance is being prepared for this salt. Identity, package, price, and prescription flags are available now, and admin review can add source-backed guidance.'}
                    </p>
                  </div>
                )}
                {patientEducationLinks(selectedMaster).length ? (
                  <div className="mt-3 border-t border-border pt-2">
                    <p className="font-medium text-text-muted">Patient education</p>
                    <div className="mt-1 flex flex-wrap gap-2">
                      {patientEducationLinks(selectedMaster).map((link) => (
                        <a
                          key={link.url}
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs font-medium text-brand-300 underline-offset-4 hover:underline"
                        >
                          {link.title}
                        </a>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
              )}
              <div className="flex min-h-20 items-center justify-center rounded-lg border border-border bg-bg-inset text-center text-xs text-text-muted">
                {selectedPackage?.stripImageUrl ? (
                  <img src={selectedPackage.stripImageUrl} alt={`${selectedMaster.brandName} strip`} className="max-h-24 rounded object-contain" />
                ) : (
                  <span>
                    Strip image unavailable. Confirm by text: {selectedMaster.brandName}
                    {selectedMaster.strength ? ` ${selectedMaster.strength}` : ''}
                  </span>
                )}

              </div>
              <div className="flex min-h-20 items-center justify-center rounded-lg border border-border bg-bg-inset text-center text-xs text-text-muted">
                {selectedPackage?.pillImageUrl ? (
                  <img src={selectedPackage.pillImageUrl} alt={`${selectedMaster.brandName} pill`} className="max-h-24 rounded object-contain" />
                ) : (
                  <span>
                    Product image unavailable. Confirm manufacturer:{' '}
                    {selectedMaster.manufacturer ?? 'not listed'}
                  </span>
                )}
              </div>
            </div>
            {selectedMaster.packages && selectedMaster.packages.length > 1 && (
              <div className="mt-3">
                <label className="mb-1 block text-xs font-medium text-text-muted">Package</label>
                <select
                  value={selectedPackageId}
                  onChange={(event) =>
                    setValue('medicinePackageId', event.target.value, {
                      shouldDirty: true,
                      shouldValidate: true,
                    })
                  }
                  className="w-full rounded-lg border border-border bg-bg-inset px-3 py-2 text-sm text-text-primary outline-none transition-colors focus:border-brand-500"
                >
                  {selectedMaster.packages.map((pack) => (
                    <option key={pack.id} value={pack.id}>
                      {pack.packSize ?? pack.gtin ?? 'Package'}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      <Input label="Name" placeholder="e.g. Metformin" error={errors.name?.message} {...register('name')} />

      <div className="grid grid-cols-2 gap-4">
        <Input label="Brand name (optional)" placeholder="e.g. Glucophage" error={errors.brandName?.message} {...register('brandName')} />
        <Input label="Generic / composition" placeholder="e.g. Metformin Hydrochloride" error={errors.genericName?.message} {...register('genericName')} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Select label="Form" options={FORM_OPTIONS} error={errors.form?.message} {...register('form')} />
        <Input label="Strength" placeholder="e.g. 500mg" error={errors.strength?.message} {...register('strength')} />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Input label="Unit" placeholder="tablets" error={errors.unit?.message} {...register('unit')} />
        <Input label="Stock" type="number" min={0} error={errors.stockQuantity?.message} {...register('stockQuantity')} />
        <Input label="Refill at" type="number" min={0} hint="Low-stock alert" error={errors.refillThreshold?.message} {...register('refillThreshold')} />
      </div>

      <Textarea label="Notes (optional)" rows={3} error={errors.notes?.message} {...register('notes')} />

      <div className="flex items-center justify-end gap-3 pt-2">
        {onCancel && (
          <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
            Cancel
          </Button>
        )}
        <Button type="submit" isLoading={isSubmitting}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
