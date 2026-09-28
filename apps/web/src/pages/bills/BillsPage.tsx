import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FileText,
  ReceiptText,
  UploadCloud,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import {
  useBills,
  useConfirmBill,
  useUploadBill,
} from '@/hooks/usePrescriptions';
import { extractErrorMessage } from '@/lib/api-client';
import { formatDate } from '@/lib/date';
import { cn } from '@/lib/utils';
import { compressImageForUpload } from '@/lib/image-compression';
import { nativeTextOcrService } from '@/services/native-text-ocr.service';
import type {
  BillCaptureCandidate,
  BillUploadResult,
  ConfirmBillMedicinePayload,
} from '@/types/prescription';

type ReviewRow = {
  key: string;
  include: boolean;
  extractedMedicineId?: string;
  medicineName: string;
  billLine: string;
  strength?: string;
  extractedPack?: string;
  quantityPurchased: number | '';
  medicineMasterId: string;
  form?: ConfirmBillMedicinePayload['form'];
  confidence: number;
  outcomeKind: BillCaptureCandidate['resolverOutcome']['kind'];
  masterMatches: BillCaptureCandidate['masterMatches'];
};

function scoreLabel(score?: number) {
  if (score === undefined || Number.isNaN(score)) return '0%';
  return `${Math.round(score * 100)}%`;
}

function inferForm(
  line: string,
): ConfirmBillMedicinePayload['form'] | undefined {
  const text = line.toLowerCase();
  if (/\b(cap|caps|capsule)\b/.test(text)) return 'CAPSULE';
  if (/\b(syp|syrup|suspension|susp)\b/.test(text)) return 'SYRUP';
  if (/\b(inj|injection|vial|ampoule)\b/.test(text)) return 'INJECTION';
  if (/\b(drop|drops)\b/.test(text)) return 'DROPS';
  if (/\b(cream)\b/.test(text)) return 'CREAM';
  if (/\b(oint|ointment)\b/.test(text)) return 'OINTMENT';
  if (/\b(powder|sachet)\b/.test(text)) return 'POWDER';
  if (/\b(tab|tabs|tablet)\b/.test(text)) return 'TABLET';
  return undefined;
}

function defaultMasterId(candidate: BillCaptureCandidate) {
  if (candidate.resolverOutcome.kind === 'STRONG') {
    return (
      candidate.resolverOutcome.match?.masterId ??
      candidate.masterMatches[0]?.id ??
      ''
    );
  }

  if (candidate.resolverOutcome.kind === 'POSSIBLE') {
    return (
      candidate.resolverOutcome.matches?.[0]?.masterId ??
      candidate.masterMatches[0]?.id ??
      ''
    );
  }

  return '';
}

function buildReviewRows(result: BillUploadResult): ReviewRow[] {
  return result.billCandidates.map((candidate, index) => {
    const extracted = result.extractedMedicines.find(
      (item) =>
        item.capture?.billLine === candidate.billLine ||
        item.medicineName.toLowerCase() === candidate.rawName.toLowerCase(),
    );

    return {
      key: `${index}:${candidate.billLine}`,
      include: true,
      extractedMedicineId: extracted?.id,
      medicineName: candidate.rawName,
      billLine: candidate.billLine,
      strength: candidate.extractedStrength,
      extractedPack: candidate.extractedPack,
      quantityPurchased:
        candidate.quantity && candidate.quantity > 0 ? candidate.quantity : '',
      medicineMasterId: defaultMasterId(candidate),
      form: inferForm(candidate.billLine),
      confidence: candidate.confidence,
      outcomeKind: candidate.resolverOutcome.kind,
      masterMatches: candidate.masterMatches,
    };
  });
}

function matchLabel(match: ReviewRow['masterMatches'][number]) {
  const composition =
    match.genericName || match.composition || 'composition not listed';
  const manufacturer = match.manufacturer ? ` | ${match.manufacturer}` : '';
  const strength = match.strength ? ` | ${match.strength}` : '';
  return `${match.brandName} - ${composition}${strength}${manufacturer}`;
}

export default function BillsPage() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadResult, setUploadResult] = useState<BillUploadResult | null>(
    null,
  );
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const { data: bills, isLoading: billsLoading } = useBills();
  const uploadBill = useUploadBill();
  const confirmBill = useConfirmBill();

  const selectedRows = useMemo(
    () =>
      reviewRows.filter(
        (row) =>
          row.include &&
          row.medicineName.trim() &&
          typeof row.quantityPurchased === 'number' &&
          row.quantityPurchased > 0,
      ),
    [reviewRows],
  );
  const includedRows = useMemo(
    () => reviewRows.filter((row) => row.include && row.medicineName.trim()),
    [reviewRows],
  );
  const rowsMissingQuantity = useMemo(
    () =>
      includedRows.filter(
        (row) =>
          typeof row.quantityPurchased !== 'number' ||
          row.quantityPurchased <= 0,
      ),
    [includedRows],
  );

  const updateRow = (key: string, patch: Partial<ReviewRow>) => {
    setReviewRows((rows) =>
      rows.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const handleUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      notify.error('File size must be under 5MB');
      return;
    }

    setUploadProgress(0);
    let uploadFile = file;
    let nativeOcr = null;

    if (file.type.startsWith('image/')) {
      try {
        const optimized = await compressImageForUpload(file, {
          maxDimension: 2400,
          quality: 0.92,
          maxBytes: 4 * 1024 * 1024,
          outputName: 'bill',
        });
        uploadFile = optimized.file;
        nativeOcr = await nativeTextOcrService.recognizeFile(uploadFile);
      } catch {
        // Image preparation failed before either OCR engine could run.
      }
    }

    uploadBill.mutate(
      {
        file: uploadFile,
        nativeOcr,
        onProgress: (pct) => setUploadProgress(pct),
      },
      {
        onSuccess: (result) => {
          const rows = buildReviewRows(result);
          setUploadResult(result);
          setReviewRows(rows);
          setUploadProgress(null);
          notify.success(
            rows.length
              ? `${rows.length} bill line(s) ready for review`
              : 'Bill uploaded, but no medicine lines were detected',
          );
        },
        onError: (error) => {
          setUploadProgress(null);
          notify.error(extractErrorMessage(error, 'Failed to upload bill'));
        },
      },
    );
  };

  const handleConfirm = () => {
    if (!uploadResult) return;
    if (!selectedRows.length) {
      notify.error(
        rowsMissingQuantity.length
          ? 'Enter the purchased quantity for at least one selected medicine'
          : 'Select at least one bill line to confirm',
      );
      return;
    }

    confirmBill.mutate(
      {
        id: uploadResult.bill.id,
        payload: {
          medicines: selectedRows.map((row) => ({
            extractedMedicineId: row.extractedMedicineId,
            medicineName: row.medicineName.trim(),
            billLine: row.billLine,
            strength: row.strength?.trim() || undefined,
            form: row.form,
            quantityPurchased: Math.floor(Number(row.quantityPurchased)),
            medicineMasterId: row.medicineMasterId || undefined,
          })),
        },
      },
      {
        onSuccess: (result) => {
          const queued = result.medicines.filter(
            (item) => item.reviewQueued,
          ).length;
          notify.success(
            queued
              ? `Bill confirmed. ${queued} unknown line(s) queued for review.`
              : 'Bill confirmed and stock updated',
          );
          setUploadResult(null);
          setReviewRows([]);
        },
        onError: (error) => {
          notify.error(extractErrorMessage(error, 'Failed to confirm bill'));
        },
      },
    );
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bills"
        description="Capture purchased medicines from pharmacy bills."
        actions={
          <Button
            leftIcon={<UploadCloud className="h-4 w-4" />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadBill.isPending}
          >
            Upload bill
          </Button>
        }
      />

      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="image/jpeg,image/png,application/pdf"
        onChange={handleUpload}
      />

      <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-500/10 text-brand-400">
                  <ReceiptText className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-text-primary">
                    Bill capture
                  </h2>
                  <p className="text-sm text-text-muted">
                    {uploadResult
                      ? uploadResult.bill.fileName || 'Uploaded bill'
                      : 'Upload a pharmacy bill to review extracted lines.'}
                  </p>
                </div>
              </div>

              {uploadBill.isPending && (
                <div className="w-full max-w-xs">
                  <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
                    <span>
                      {uploadProgress === 100 ? 'Reading bill' : 'Uploading'}
                    </span>
                    <span>{uploadProgress ?? 0}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-border">
                    <div
                      className="h-full rounded-full bg-brand-500 transition-all"
                      style={{ width: `${uploadProgress ?? 10}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </Card>

          {uploadResult && (
            <Card className="p-5">
              <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-base font-semibold text-text-primary">
                    Confirm bill lines
                  </h2>
                  <p className="text-sm text-text-muted">
                    {includedRows.length} of {reviewRows.length} selected
                  </p>
                  {rowsMissingQuantity.length > 0 && (
                    <p className="mt-1 text-xs text-warning-400">
                      Enter purchased quantity for {rowsMissingQuantity.length}{' '}
                      selected row(s) before confirming them.
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setUploadResult(null);
                      setReviewRows([]);
                    }}
                    disabled={confirmBill.isPending}
                  >
                    Clear
                  </Button>
                  <Button
                    leftIcon={<CheckCircle2 className="h-4 w-4" />}
                    onClick={handleConfirm}
                    isLoading={confirmBill.isPending}
                    disabled={!selectedRows.length}
                  >
                    Confirm selected
                  </Button>
                </div>
              </div>

              {reviewRows.length === 0 ? (
                <div className="rounded-xl border border-border bg-bg-inset p-6 text-center text-sm text-text-muted">
                  No medicine lines were detected from this bill.
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {reviewRows.map((row) => (
                    <div
                      key={row.key}
                      className={cn(
                        'rounded-xl border bg-bg-inset p-4 transition-colors',
                        row.include
                          ? 'border-border'
                          : 'border-border/60 opacity-70',
                      )}
                    >
                      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                        <label className="flex min-w-0 items-start gap-3">
                          <input
                            type="checkbox"
                            checked={row.include}
                            onChange={(event) =>
                              updateRow(row.key, {
                                include: event.target.checked,
                              })
                            }
                            className="mt-1 h-4 w-4 rounded border-border bg-bg-inset text-brand-500"
                          />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-text-primary">
                              {row.billLine}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-2">
                              <Badge
                                tone={
                                  row.outcomeKind === 'UNKNOWN'
                                    ? 'warning'
                                    : row.outcomeKind === 'POSSIBLE'
                                      ? 'info'
                                      : 'success'
                                }
                              >
                                {row.outcomeKind.toLowerCase()}
                              </Badge>
                              <Badge tone="muted">
                                {scoreLabel(row.confidence)}
                              </Badge>
                              {row.extractedPack && (
                                <Badge tone="muted">{row.extractedPack}</Badge>
                              )}
                            </span>
                          </span>
                        </label>
                        {row.outcomeKind === 'UNKNOWN' && (
                          <div className="flex items-center gap-2 text-xs text-warning">
                            <AlertTriangle className="h-4 w-4" />
                            <span>Review queue if confirmed</span>
                          </div>
                        )}
                      </div>

                      <div className="grid grid-cols-1 gap-3 md:grid-cols-[minmax(0,1fr)_120px_120px]">
                        <Input
                          label="Medicine name"
                          value={row.medicineName}
                          onChange={(event) =>
                            updateRow(row.key, {
                              medicineName: event.target.value,
                            })
                          }
                          disabled={!row.include}
                        />
                        <Input
                          label="Strength"
                          value={row.strength ?? ''}
                          onChange={(event) =>
                            updateRow(row.key, { strength: event.target.value })
                          }
                          disabled={!row.include}
                        />
                        <Input
                          label="Quantity"
                          type="number"
                          min={1}
                          value={row.quantityPurchased}
                          onChange={(event) =>
                            updateRow(row.key, {
                              quantityPurchased: event.target.value
                                ? Number(event.target.value)
                                : '',
                            })
                          }
                          disabled={!row.include}
                        />
                      </div>

                      <label className="mt-3 block text-sm font-medium text-text-primary">
                        Master match
                        <select
                          value={row.medicineMasterId}
                          onChange={(event) =>
                            updateRow(row.key, {
                              medicineMasterId: event.target.value,
                            })
                          }
                          disabled={!row.include}
                          className="mt-1.5 h-10 w-full rounded-xl border border-border bg-bg-inset px-3 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <option value="">Unknown / manual review</option>
                          {row.masterMatches.map((match) => (
                            <option key={match.id} value={match.id}>
                              {matchLabel(match)} ({scoreLabel(match.score)})
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Card className="p-5">
            <div className="mb-4 flex items-center gap-2">
              <FileText className="h-5 w-5 text-brand-400" />
              <h2 className="text-base font-semibold text-text-primary">
                Recent bills
              </h2>
            </div>

            {billsLoading ? (
              <div className="flex h-28 items-center justify-center">
                <Spinner />
              </div>
            ) : !bills?.length ? (
              <div className="rounded-xl border border-border bg-bg-inset p-5 text-center text-sm text-text-muted">
                No bills uploaded yet.
              </div>
            ) : (
              <div className="flex flex-col divide-y divide-border-subtle">
                {bills.slice(0, 8).map((bill) => (
                  <div key={bill.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-primary">
                          {bill.pharmacyName ||
                            bill.fileName ||
                            'Pharmacy bill'}
                        </p>
                        <p className="mt-1 text-xs text-text-muted">
                          {formatDate(bill.createdAt)}
                        </p>
                      </div>
                      <Badge
                        tone={
                          bill.status === 'CONFIRMED' ? 'success' : 'warning'
                        }
                        className="shrink-0"
                      >
                        {bill.status?.toLowerCase() ?? 'uploaded'}
                      </Badge>
                    </div>
                    <p className="mt-2 text-xs text-text-muted">
                      {bill._count?.extractedMedicines ??
                        bill.extractedMedicines?.length ??
                        0}{' '}
                      extracted line(s)
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </aside>
      </section>
    </div>
  );
}
