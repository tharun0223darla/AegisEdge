import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Select } from '@/components/ui/Select';
import { EmptyState } from '@/components/ui/EmptyState';
import { Skeleton } from '@/components/ui/Skeleton';
import { ProtectedImage } from '@/components/shared/ProtectedImage';
import { notify } from '@/components/ui/Toast';
import { medicinesService } from '@/services/medicines.service';
import { extractErrorMessage } from '@/lib/api-client';
import type { AdminClinicalDetailsPayload, AdminClinicalSourceType, MedicineDataReview, MedicineReviewStatus, MedicineReviewType, WebSourceAssistResult } from '@/types/medicine';

const statusTone: Record<MedicineReviewStatus, 'warning' | 'success' | 'danger' | 'info'> = {
  OPEN: 'warning',
  LINKED: 'info',
  VERIFIED: 'success',
  REJECTED: 'danger',
};

type ReviewTypeFilter = 'ALL' | MedicineReviewType;

const reviewTypeFilters: Array<{ value: ReviewTypeFilter; label: string }> = [
  { value: 'ALL', label: 'All' },
  { value: 'MISSING_CLINICAL_DETAILS', label: 'Clinical details' },
  { value: 'UNKNOWN_MANUAL', label: 'Unknown manual' },
  { value: 'UNKNOWN_BARCODE', label: 'Barcodes' },
  { value: 'MISSING_IMAGE', label: 'Images' },
];

const clinicalSourceOptions: Array<{ value: AdminClinicalSourceType; label: string }> = [
  { value: 'WEB_ASSISTED', label: 'Web assisted (admin verified)' },
  { value: 'NFI_IPC', label: 'NFI / IPC' },
  { value: 'CDSCO', label: 'CDSCO' },
  { value: 'DailyMed', label: 'DailyMed' },
  { value: 'openFDA', label: 'openFDA' },
  { value: 'MedlinePlus', label: 'MedlinePlus' },
  { value: 'ADMIN', label: 'Admin verified source' },
];

type ClinicalDraft = {
  uses: string;
  howToTake: string;
  sideEffects: string;
  warnings: string;
  storage: string;
  sourceType: AdminClinicalSourceType;
  sourceTitle: string;
  sourceUrl: string;
  sourceNote: string;
};

function sourceTitlePlaceholder(sourceType: AdminClinicalSourceType) {
  if (sourceType === 'WEB_ASSISTED') return 'e.g. Web-assisted review: DailyMed / NHS / NCBI sources';
  if (sourceType === 'NFI_IPC') return 'e.g. National Formulary of India 2021 - Azathioprine monograph';
  if (sourceType === 'CDSCO') return 'e.g. CDSCO approved indication or safety notice';
  if (sourceType === 'DailyMed') return 'e.g. DailyMed Azathioprine tablets label';
  if (sourceType === 'openFDA') return 'e.g. openFDA drug label - Azathioprine';
  if (sourceType === 'MedlinePlus') return 'e.g. MedlinePlus Azathioprine drug information';
  return 'e.g. Hospital formulary, pharmacist review, or verified label source';
}

function labelize(value?: string | null) {
  if (!value) return 'unknown';
  return value.replace(/_/g, ' ').toLowerCase();
}

function reviewEnrichmentLabel(status?: string | null) {
  if (status === 'COMPLETE') return 'Complete';
  if (status === 'PARTIAL') return 'Partial';
  if (status === 'NEEDS_SOURCE') return 'Verification pending';
  return status ?? '';
}

function payloadString(item: MedicineDataReview, key: string) {
  const value = item.payload?.[key];
  return typeof value === 'string' ? value : '';
}

function payloadStringArray(item: MedicineDataReview, key: string) {
  const value = item.payload?.[key];
  return Array.isArray(value) ? value.filter((part): part is string => typeof part === 'string') : [];
}

function splitClinicalList(value: string) {
  return value
    .split(/\r?\n|,/)
    .map((part) => part.trim())
    .filter(Boolean)
    .slice(0, 30);
}

function clinicalPayload(
  draft: ClinicalDraft,
  adminNotes: string,
): AdminClinicalDetailsPayload {
  const payload: AdminClinicalDetailsPayload = {
    sourceType: draft.sourceType,
    sourceTitle: draft.sourceTitle.trim(),
  };

  if (draft.uses.trim()) payload.uses = draft.uses.trim();
  if (draft.howToTake.trim()) payload.howToTake = draft.howToTake.trim();
  if (draft.warnings.trim()) payload.warnings = draft.warnings.trim();
  if (draft.storage.trim()) payload.storage = draft.storage.trim();

  const sideEffects = splitClinicalList(draft.sideEffects);
  if (sideEffects.length) payload.sideEffects = sideEffects;
  if (draft.sourceUrl.trim()) payload.sourceUrl = draft.sourceUrl.trim();
  if (draft.sourceNote.trim()) payload.sourceNote = draft.sourceNote.trim();
  if (adminNotes.trim()) payload.adminNotes = adminNotes.trim();

  return payload;
}
function webAssistSourceTitle(result: WebSourceAssistResult) {
  const sources = result.sources.filter((source) => source.usableForClinicalFields).slice(0, 3);
  if (!sources.length) return '';
  return `Web-assisted review: ${sources.map((source) => source.title).join(' | ')}`.slice(0, 220);
}

function webAssistSourceNote(result: WebSourceAssistResult) {
  const noteParts = [
    result.draft.sourceNote,
    result.warnings.length ? `Warnings: ${result.warnings.join('; ')}` : '',
    result.cached ? 'Used cached web-source result.' : 'Fresh web-source search run',
    result.cacheExpiresAt ? `Cache expires: ${new Date(result.cacheExpiresAt).toLocaleString()}` : '',
    `Search query: ${result.query}`,
  ].filter(Boolean);
  return noteParts.join('\n').slice(0, 1000);
}

function applyWebAssistDraft(current: ClinicalDraft, result: WebSourceAssistResult): ClinicalDraft {
  const primarySource = result.sources.find((source) => source.usableForClinicalFields);
  const draft = result.draft ?? {};
  return {
    ...current,
    uses: draft.uses || current.uses,
    howToTake: draft.howToTake || current.howToTake,
    sideEffects: draft.sideEffects?.length ? draft.sideEffects.join('\n') : current.sideEffects,
    warnings: draft.warnings || current.warnings,
    storage: draft.storage || current.storage,
    sourceType: 'WEB_ASSISTED',
    sourceTitle: webAssistSourceTitle(result) || current.sourceTitle,
    sourceUrl: primarySource?.url || current.sourceUrl,
    sourceNote: webAssistSourceNote(result) || current.sourceNote,
  };
}
function ReviewCard({ item }: { item: MedicineDataReview }) {
  const queryClient = useQueryClient();
  const [medicineMasterId, setMedicineMasterId] = useState(item.medicineMaster?.id ?? '');
  const [medicinePackageId, setMedicinePackageId] = useState(item.medicinePackage?.id ?? '');
  const [adminNotes, setAdminNotes] = useState('');
  const [clinicalDraft, setClinicalDraft] = useState<ClinicalDraft>({
    uses: item.saltProfile?.uses ?? '',
    howToTake: item.saltProfile?.howToTake ?? '',
    sideEffects: item.saltProfile?.sideEffects?.join('\n') ?? '',
    warnings: item.saltProfile?.warnings ?? '',
    storage: item.saltProfile?.storage ?? '',
    sourceType: 'NFI_IPC',
    sourceTitle: '',
    sourceUrl: '',
    sourceNote: '',
  });
  const [webAssistResult, setWebAssistResult] = useState<WebSourceAssistResult | null>(null);
  const isClinicalDetails = item.type === 'MISSING_CLINICAL_DETAILS';
  const missingFields = payloadStringArray(item, 'missingFields');
  const saltKey = item.saltProfile?.saltKey ?? payloadString(item, 'saltKey');
  const enrichmentStatus = item.saltProfile?.enrichmentStatus ?? payloadString(item, 'enrichmentStatus');
  const title = isClinicalDetails
    ? item.saltProfile?.displayName || payloadString(item, 'displayName') || item.rawName || 'Missing clinical details'
    : item.rawName || item.gtin || labelize(item.type);

  const resolve = useMutation({
    mutationFn: (status: Exclude<MedicineReviewStatus, 'OPEN'>) =>
      medicinesService.resolveReview(item.id, {
        status,
        ...(!isClinicalDetails && medicineMasterId ? { medicineMasterId } : {}),
        ...(!isClinicalDetails && medicinePackageId ? { medicinePackageId } : {}),
        ...(adminNotes ? { adminNotes } : {}),
      }),
    onSuccess: () => {
      notify.success('Review updated');
      queryClient.invalidateQueries({ queryKey: ['medicine-reviews'] });
    },
    onError: (error) => notify.error(extractErrorMessage(error, 'Failed to update review')),
  });

  const saveClinicalDetails = useMutation({
    mutationFn: () => medicinesService.updateReviewClinicalDetails(
      item.id,
      clinicalPayload(clinicalDraft, adminNotes),
    ),
    onSuccess: () => {
      notify.success('Clinical details saved with source reference');
      queryClient.invalidateQueries({ queryKey: ['medicine-reviews'] });
    },
    onError: (error) => notify.error(extractErrorMessage(error, 'Failed to save clinical details')),
  });

  const updateClinicalDraft = <K extends keyof ClinicalDraft>(field: K, value: ClinicalDraft[K]) => {
    setClinicalDraft((current) => ({ ...current, [field]: value }));
  };

  const assistWebSources = useMutation({
    mutationFn: (refresh: boolean) => medicinesService.assistReviewWebSources(item.id, refresh),
    onSuccess: (result) => {
      setWebAssistResult(result);
      if (result.configured && (Object.keys(result.draft ?? {}).length || result.sources.length)) {
        setClinicalDraft((current) => applyWebAssistDraft(current, result));
      }
      if (!result.configured) {
        notify.message(result.message);
      } else if (Object.keys(result.draft ?? {}).length) {
        notify.success('Web-source draft prepared for admin review');
      } else if (result.sources.length) {
        notify.message('Trusted sources found. Review snippets and write the final summary.');
      } else {
        notify.message(result.message);
      }
    },
    onError: (error) => notify.error(extractErrorMessage(error, 'Trusted web-source search failed')),
  });
  const payloadText = item.payload ? JSON.stringify(item.payload, null, 2) : '';

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>{title}</CardTitle>
          <p className="mt-1 text-sm text-text-muted">
            {isClinicalDetails
              ? 'Trusted patient guidance requested for this salt profile.'
              : `${labelize(item.type)} from ${labelize(item.source)} submitted by ${item.submittedBy?.email ?? 'system'}`}
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone="info">Demand {item.demandCount ?? 1}</Badge>
            {enrichmentStatus && <Badge tone="warning">{reviewEnrichmentLabel(enrichmentStatus)}</Badge>}
            {saltKey && <Badge tone="muted">{saltKey}</Badge>}
            {item.strength && <Badge tone="muted">{item.strength}</Badge>}
            {item.form && <Badge tone="muted">{item.form.toLowerCase()}</Badge>}
          </div>
        </div>
        <Badge tone={statusTone[item.status]}>{item.status}</Badge>
      </CardHeader>
      <CardContent className="space-y-4">
        {isClinicalDetails && missingFields.length > 0 && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-warning">Missing fields</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {missingFields.map((field) => (
                <Badge key={field} tone="warning">
                  {field}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {item.billLine && (
          <div className="rounded-lg border border-border bg-bg-inset p-3 text-sm text-text-muted">
            {item.billLine}
          </div>
        )}

        {item.medicineMaster && (
          <div className="rounded-lg border border-border bg-bg-inset p-3 text-sm">
            <p className="font-medium text-text-primary">{item.medicineMaster.brandName}</p>
            <p className="mt-1 text-text-muted">
              {[item.medicineMaster.composition, item.medicineMaster.manufacturer]
                .filter(Boolean)
                .join(' | ')}
            </p>
          </div>
        )}

        {payloadText && (
          <pre className="max-h-32 overflow-auto rounded-lg border border-border bg-bg-inset p-3 text-xs text-text-muted">
            {payloadText}
          </pre>
        )}

        {item.userStripImageUrl && (
          <div className="rounded-lg border border-border bg-bg-inset p-3">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-text-muted">
              User strip image
            </p>
            <ProtectedImage
              src={item.userStripImageUrl}
              alt="User submitted strip"
              className="max-h-44 rounded object-contain"
            />
          </div>
        )}

        {item.status === 'OPEN' && isClinicalDetails && (
          <div className="rounded-lg border border-border bg-bg-inset p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-text-primary">Trusted clinical source editor</p>
                <p className="mt-1 text-xs leading-5 text-text-muted">
                  Add only details verified from a trusted label, guideline, or regulatory source. Each saved field receives the selected trusted source reference and is marked admin verified.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<Search className="h-4 w-4" />}
                  isLoading={assistWebSources.isPending}
                  onClick={() => assistWebSources.mutate(false)}
                >
                  Search web sources
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  leftIcon={<RefreshCw className="h-4 w-4" />}
                  isLoading={assistWebSources.isPending}
                  onClick={() => assistWebSources.mutate(true)}
                >
                  Force refresh
                </Button>
              </div>
            </div>
            {webAssistResult && (
              <div className="mt-4 rounded-lg border border-brand-500/30 bg-brand-500/10 p-3 text-xs">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-text-primary">Web-source assist</p>
                    <p className="mt-1 leading-5 text-text-muted">{webAssistResult.message}</p>
                    {webAssistResult.cacheExpiresAt && (
                      <p className="mt-1 text-[11px] text-text-muted">
                        Cache expires: {new Date(webAssistResult.cacheExpiresAt).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap justify-end gap-2">
                    {webAssistResult.cached && <Badge tone="success">Cached</Badge>}
                    <Badge tone={webAssistResult.configured ? 'info' : 'warning'}>
                      {webAssistResult.configured ? webAssistResult.provider : 'Not configured'}
                    </Badge>
                  </div>
                </div>
                {webAssistResult.warnings.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {webAssistResult.warnings.map((warning) => (
                      <Badge key={warning} tone="warning">
                        {warning}
                      </Badge>
                    ))}
                  </div>
                )}
                {webAssistResult.sources.length > 0 && (
                  <div className="mt-3">
                    <p className="font-medium uppercase tracking-wide text-text-muted">Ranked sources</p>
                    <div className="mt-2 grid gap-2">
                      {webAssistResult.sources.slice(0, 5).map((source) => (
                        <a
                          key={source.url}
                          href={source.url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-border bg-bg-inset p-2 text-text-muted hover:border-brand-500/60"
                        >
                          <span className="font-medium text-text-primary">{source.title}</span>
                          <span className="ml-2 inline-flex"><Badge tone={source.usableForClinicalFields ? 'info' : 'muted'}>{source.tier}</Badge></span>
                          <span className="mt-1 block truncate">{source.host}</span>
                        </a>
                      ))}
                    </div>
                  </div>
                )}
                {webAssistResult.evidence.length > 0 && (
                  <div className="mt-3">
                    <p className="font-medium uppercase tracking-wide text-text-muted">Evidence snippets for admin check</p>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      {webAssistResult.evidence.slice(0, 6).map((item, index) => (
                        <div key={`${item.field}-${index}`} className="rounded border border-border bg-bg-inset p-2">
                          <div className="mb-1 flex items-center justify-between gap-2">
                            <Badge tone="info">{item.field}</Badge>
                            <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="truncate text-brand-300 hover:underline">
                              {item.sourceTitle}
                            </a>
                          </div>
                          <p className="leading-5 text-text-muted">{item.snippet}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <div className="md:col-span-2">
                <Textarea
                  label="Why it may be prescribed / uses"
                  rows={3}
                  value={clinicalDraft.uses}
                  onChange={(event) => updateClinicalDraft('uses', event.target.value)}
                  placeholder="Paste or summarize the trusted source content for indications/uses."
                />
              </div>
              <div className="md:col-span-2">
                <Textarea
                  label="How to take"
                  rows={3}
                  value={clinicalDraft.howToTake}
                  onChange={(event) => updateClinicalDraft('howToTake', event.target.value)}
                  placeholder="Source-backed dosage/admin guidance. Do not invent patient instructions."
                />
              </div>
              <Textarea
                label="Possible side effects"
                rows={3}
                value={clinicalDraft.sideEffects}
                onChange={(event) => updateClinicalDraft('sideEffects', event.target.value)}
                placeholder="One per line, or comma separated."
              />
              <Textarea
                label="Storage"
                rows={3}
                value={clinicalDraft.storage}
                onChange={(event) => updateClinicalDraft('storage', event.target.value)}
                placeholder="Storage instructions from the source."
              />
              <div className="md:col-span-2">
                <Textarea
                  label="Warnings"
                  rows={3}
                  value={clinicalDraft.warnings}
                  onChange={(event) => updateClinicalDraft('warnings', event.target.value)}
                  placeholder="Important warnings or precautions from the trusted source."
                />
              </div>
              <Select
                label="Trusted source"
                options={clinicalSourceOptions}
                value={clinicalDraft.sourceType}
                onChange={(event) => updateClinicalDraft('sourceType', event.target.value as AdminClinicalSourceType)}
              />
              <Input
                label="Source title"
                value={clinicalDraft.sourceTitle}
                onChange={(event) => updateClinicalDraft('sourceTitle', event.target.value)}
                placeholder={sourceTitlePlaceholder(clinicalDraft.sourceType)}
              />
              <Input
                label="Source URL or reference"
                value={clinicalDraft.sourceUrl}
                onChange={(event) => updateClinicalDraft('sourceUrl', event.target.value)}
                placeholder="https://... or internal source reference"
              />
              <div className="md:col-span-2">
                <Textarea
                  label="Source note"
                  rows={2}
                  value={clinicalDraft.sourceNote}
                  onChange={(event) => updateClinicalDraft('sourceNote', event.target.value)}
                  placeholder="Optional note about exactly what was checked."
                />
              </div>
            </div>
          </div>
        )}
        {item.status === 'OPEN' && (
          <div className="grid gap-3 md:grid-cols-2">
            {!isClinicalDetails && (
              <>
                <Input
                  label="Medicine master ID"
                  value={medicineMasterId}
                  onChange={(event) => setMedicineMasterId(event.target.value)}
                  placeholder="Paste verified master ID"
                />
                <Input
                  label="Package ID"
                  value={medicinePackageId}
                  onChange={(event) => setMedicinePackageId(event.target.value)}
                  placeholder="Optional exact package ID"
                />
              </>
            )}
            <div className="md:col-span-2">
              <Textarea
                label="Admin notes"
                rows={2}
                value={adminNotes}
                onChange={(event) => setAdminNotes(event.target.value)}
                placeholder={isClinicalDetails ? 'Source checked, enrichment run, or reason pending.' : 'What was checked before resolving?'}
              />
            </div>
          </div>
        )}

        {item.status === 'OPEN' && (
          <div className="flex flex-wrap justify-end gap-2">
            {isClinicalDetails ? (
              <Button
                leftIcon={<ShieldCheck className="h-4 w-4" />}
                isLoading={saveClinicalDetails.isPending}
                onClick={() => saveClinicalDetails.mutate()}
              >
                Save sourced details
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  leftIcon={<CheckCircle2 className="h-4 w-4" />}
                  isLoading={resolve.isPending}
                  onClick={() => resolve.mutate('LINKED')}
                >
                  Link
                </Button>
                <Button
                  leftIcon={<ShieldCheck className="h-4 w-4" />}
                  isLoading={resolve.isPending}
                  onClick={() => resolve.mutate('VERIFIED')}
                >
                  Verify
                </Button>
              </>
            )}
            <Button
              variant="danger"
              leftIcon={<XCircle className="h-4 w-4" />}
              isLoading={resolve.isPending}
              onClick={() => resolve.mutate('REJECTED')}
            >
              Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MedicineReviewQueuePage() {
  const [status, setStatus] = useState<MedicineReviewStatus>('OPEN');
  const [typeFilter, setTypeFilter] = useState<ReviewTypeFilter>('ALL');
  const { data, isLoading } = useQuery({
    queryKey: ['medicine-reviews', status, typeFilter],
    queryFn: () =>
      medicinesService.listReviews(
        status,
        1,
        20,
        typeFilter === 'ALL' ? undefined : typeFilter,
      ),
  });

  const reviews = data?.data ?? [];

  return (
    <div>
      <PageHeader
        title="Medicine Reviews"
        description="Resolve unknown medicines, missing images, barcodes, and trusted clinical-detail requests."
      />

      <div className="mb-3 flex flex-wrap gap-2">
        {(['OPEN', 'LINKED', 'VERIFIED', 'REJECTED'] as MedicineReviewStatus[]).map((value) => (
          <Button
            key={value}
            size="sm"
            variant={status === value ? 'primary' : 'secondary'}
            onClick={() => setStatus(value)}
          >
            {value}
          </Button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {reviewTypeFilters.map((filter) => (
          <Button
            key={filter.value}
            size="sm"
            variant={typeFilter === filter.value ? 'primary' : 'secondary'}
            onClick={() => setTypeFilter(filter.value)}
          >
            {filter.label}
          </Button>
        ))}
      </div>

      <div className="space-y-4">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-52" />)
        ) : reviews.length === 0 ? (
          <EmptyState
            title="No review items"
            description="Patient requests and unknown medicine captures will appear here."
          />
        ) : (
          reviews.map((item) => <ReviewCard key={item.id} item={item} />)
        )}
      </div>
    </div>
  );
}
