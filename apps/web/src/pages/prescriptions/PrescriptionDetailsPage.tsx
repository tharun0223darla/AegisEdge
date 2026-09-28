import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft,
  Check,
  FileText,
  Sparkles,
  AlertCircle,
  Calendar,
  User,
  Save,
} from 'lucide-react';
import { ProtectedImage } from '@/components/shared/ProtectedImage';
import { Button } from '@/components/ui/Button';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { Select } from '@/components/ui/Select';
import { notify } from '@/components/ui/Toast';
import {
  usePrescription,
  useConfirmPrescription,
  useUploadPrescription,
  useLatestPrescriptionVisionJob,
  useStartPrescriptionVisionReview,
} from '@/hooks/usePrescriptions';
import { apiClient, extractErrorMessage } from '@/lib/api-client';
import type {
  PrescriptionVisionJob,
  PrescriptionVisionRow,
} from '@/types/prescription';

const FREQUENCY_OPTIONS = [
  { value: '', label: 'Select Frequency (Needs Review)' },
  { value: 'DAILY', label: 'Daily' },
  { value: 'TWICE_DAILY', label: 'Twice Daily (BID)' },
  { value: 'THREE_TIMES_DAILY', label: 'Three Times Daily (TID)' },
  { value: 'FOUR_TIMES_DAILY', label: 'Four Times Daily (QID)' },
  { value: 'WEEKLY', label: 'Weekly' },
  { value: 'AS_NEEDED', label: 'As Needed (PRN)' },
  { value: 'CUSTOM', label: 'Custom' },
];

interface FormMedicine {
  id: string;
  extractedMedicineId?: string;
  source: 'DATABASE' | 'VISION';
  enabled: boolean;
  medicineName: string;
  rawExtractedName: string;
  brandName: string;
  genericName: string;
  verificationStatus: 'VERIFIED' | 'VERIFY_REQUIRED' | 'NEEDS_REVIEW';
  isEditing?: boolean;
  dosage: string;
  frequency: string;
  timesOfDayString: string; // comma-separated e.g. "08:00, 20:00"
  durationDays: number | string;
  totalQuantity: number | string;
  instructions: string;
  confidenceScore?: number | null;
  reasons?: string[] | null;
  verificationSource?: string | null;
  isAmbiguous?: boolean;
  ambiguousOptions?: string[];
  candidateState?: 'KNOWN' | 'UNKNOWN' | 'LOW_CONFIDENCE' | 'REJECTED';
  recovered?: boolean;
  readableCandidate?: boolean;
  evidence?: {
    name_image: string | null;
    context_image: string | null;
  };
  uncertainFields?: string[];
}

function toApiAssetUrl(path: string | null | undefined): string {
  if (!path) return '';

  try {
    const baseUrl = apiClient.defaults.baseURL ?? window.location.origin;
    const apiOrigin = new URL(baseUrl, window.location.origin).origin;

    return new URL(path, apiOrigin).toString();
  } catch {
    return path;
  }
}

function mapVisionRowsToForm(
  job: PrescriptionVisionJob,
  rows: PrescriptionVisionRow[],
): FormMedicine[] {
  return rows.map((row) => {
    const rawName = row.medicine.medicine_raw?.trim() ?? '';
    const dosage = [row.medicine.dosage_form, row.medicine.strength]
      .filter(Boolean)
      .join(' ')
      .trim();

    const instructions = [row.medicine.schedule_raw, row.medicine.food_timing]
      .filter(Boolean)
      .join(' | ');

    return {
      id: `vision-${job.id}-${row.row}`,
      extractedMedicineId: undefined,
      source: 'VISION',
      enabled: false,
      medicineName: rawName,
      rawExtractedName:
        rawName ||
        (row.readable_candidate
          ? `Candidate row ${row.row}`
          : 'Enter medicine name from crop'),
      brandName: '',
      genericName: '',
      verificationStatus: 'NEEDS_REVIEW',
      isEditing: true,
      dosage,
      frequency: '',
      timesOfDayString: '',
      durationDays: '',
      totalQuantity: '',
      instructions,
      confidenceScore: row.ocr_confidence,
      reasons: [
        'Vision candidate ? verify against the prescription image',
        ...row.uncertain_fields.map((field) => `Uncertain field: ${field}`),
      ],
      verificationSource: 'VISION_REVIEW',
      candidateState: 'LOW_CONFIDENCE',
      evidence: row.evidence,
      uncertainFields: row.uncertain_fields,
      readableCandidate: row.readable_candidate,
    };
  });
}

export default function PrescriptionDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: prescription, isLoading } = usePrescription(id);
  const confirmPrescription = useConfirmPrescription(id ?? '');
  const uploadPrescription = useUploadPrescription();
  const latestVisionJob = useLatestPrescriptionVisionJob(id);
  const startVisionReview = useStartPrescriptionVisionReview(id ?? '');
  const visionJob = latestVisionJob.data;
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [isRecovering, setIsRecovering] = useState(false);

  const handleRecoverAgain = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsRecovering(true);
    uploadPrescription.mutate(
      { file },
      {
        onSuccess: (res) => {
          setIsRecovering(false);
          notify.success('Prescription re-scanned successfully!');
          navigate(`/prescriptions/${res.prescription.id}`);
        },
        onError: (err) => {
          setIsRecovering(false);
          notify.error(
            extractErrorMessage(err, 'Failed to re-scan prescription'),
          );
        },
      },
    );
  };

  // Form states
  const [doctorName, setDoctorName] = useState('');
  const [prescribedAt, setPrescribedAt] = useState('');
  const [medicines, setMedicines] = useState<FormMedicine[]>([]);
  const [showOcrText, setShowOcrText] = useState(false);

  // Sync state once data loads
  useEffect(() => {
    if (prescription) {
      setDoctorName(prescription.doctorName ?? '');
      setPrescribedAt(
        prescription.prescribedAt
          ? prescription.prescribedAt.substring(0, 10)
          : '',
      );

      if (prescription.extractedMedicines) {
        const mapped = prescription.extractedMedicines.map((m: any) => {
          // If timesOfDay is an array and has items, join it. Otherwise fallback to defaults based on frequency.
          const times =
            Array.isArray(m.timesOfDay) && m.timesOfDay.length > 0
              ? m.timesOfDay.join(', ')
              : m.frequency === 'TWICE_DAILY'
                ? '08:00, 20:00'
                : m.frequency === 'THREE_TIMES_DAILY'
                  ? '08:00, 14:00, 20:00'
                  : m.frequency === 'FOUR_TIMES_DAILY'
                    ? '08:00, 12:00, 16:00, 20:00'
                    : m.frequency === 'DAILY'
                      ? '08:00'
                      : ''; // No defaults if frequency is not determined

          const isAmbiguous =
            Array.isArray(m.reasons) &&
            m.reasons.some((r: string) => r.startsWith('AMBIGUOUS:'));
          const ambiguousOptions = isAmbiguous
            ? m.reasons
                .find((r: string) => r.startsWith('AMBIGUOUS:'))
                ?.replace('AMBIGUOUS:', '')
                .split(',') || []
            : [];
          const cleanReasons = Array.isArray(m.reasons)
            ? m.reasons.filter((r: string) => !r.startsWith('AMBIGUOUS:'))
            : [];

          return {
            id: m.id,
            extractedMedicineId: m.extractedMedicineId,
            source: 'DATABASE' as const,
            enabled: !m.isConfirmed && m.verificationStatus !== 'NEEDS_REVIEW',
            medicineName: m.medicineName || '',
            rawExtractedName: m.medicineName || 'Unknown',
            brandName: m.brandName || '',
            genericName: m.genericName || '',
            verificationStatus: m.verificationStatus || 'NEEDS_REVIEW',
            isEditing: m.verificationStatus === 'NEEDS_REVIEW', // start open by default if it needs review
            dosage: m.dosage || m.strength || '',
            frequency: m.frequency || '', // Keep blank if null to ask for review
            timesOfDayString: times,
            durationDays:
              m.durationDays !== null && m.durationDays !== undefined
                ? m.durationDays
                : '', // Keep blank if null
            totalQuantity:
              m.quantity !== null && m.quantity !== undefined ? m.quantity : '', // Keep blank if null
            instructions: m.instructions || '',
            confidenceScore: m.confidenceScore,
            reasons: cleanReasons,
            verificationSource: m.verificationSource || null,
            recovered:
              m.verificationSource === 'OCR_RECOVERY' ||
              m.verificationSource === 'FUZZY_SEARCH' ||
              m.verificationSource === 'PREFIX_MATCHING',
            isAmbiguous,
            ambiguousOptions,
            candidateState: m.candidateState,
          };
        });
        setMedicines(mapped);
      }
    }
  }, [prescription]);

  if (isLoading) {
    return (
      <div className="flex justify-center items-center h-96">
        <Spinner size="lg" />
      </div>
    );
  }

  if (!prescription) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="h-12 w-12 text-danger mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-text-primary">
          Prescription not found
        </h2>
        <Link
          to="/prescriptions"
          className="text-brand-400 hover:underline mt-2 inline-block"
        >
          Go back to Prescriptions
        </Link>
      </div>
    );
  }

  const handleMedicineChange = (
    idx: number,
    field: keyof FormMedicine,
    val: any,
  ) => {
    setMedicines((prev) => {
      const copy = [...prev];
      copy[idx] = { ...copy[idx], [field]: val };

      // Auto-update times depending on frequency
      if (field === 'frequency') {
        const freq = val as string;
        if (freq === 'DAILY') copy[idx].timesOfDayString = '08:00';
        else if (freq === 'TWICE_DAILY')
          copy[idx].timesOfDayString = '08:00, 20:00';
        else if (freq === 'THREE_TIMES_DAILY')
          copy[idx].timesOfDayString = '08:00, 14:00, 20:00';
        else if (freq === 'FOUR_TIMES_DAILY')
          copy[idx].timesOfDayString = '08:00, 12:00, 16:00, 20:00';
        else if (freq === 'AS_NEEDED') copy[idx].timesOfDayString = '';
      }

      return copy;
    });
  };

  const handleStartVisionReview = () => {
    if (!id) return;

    startVisionReview.mutate(undefined, {
      onSuccess: (job) => {
        notify.success(
          job.status === 'PROCESSING'
            ? 'Vision review is processing.'
            : 'Vision review was queued.',
        );
      },
      onError: (error) => {
        notify.error(
          extractErrorMessage(error, 'Could not start vision review.'),
        );
      },
    });
  };

  const handleLoadVisionCandidates = () => {
    if (
      !visionJob ||
      visionJob.status !== 'COMPLETED' ||
      !visionJob.resultJson
    ) {
      return;
    }

    const rows = visionJob.resultJson.rows ?? [];

    if (rows.length === 0) {
      notify.error('No readable medicine candidates were found.');
      return;
    }

    setMedicines(mapVisionRowsToForm(visionJob, rows));

    notify.success(
      `${rows.length} candidates loaded. Review every field before confirming.`,
    );
  };

  const handleConfirm = () => {
    const activeMeds = medicines.filter((m) => m.enabled);
    if (activeMeds.length === 0) {
      notify.error('Please select at least one medicine to confirm.');
      return;
    }

    // Validation checks
    for (const m of activeMeds) {
      if (!m.medicineName.trim()) {
        notify.error('Medicine name is required.');
        return;
      }

      if (!m.frequency) {
        notify.error(`Frequency is required for ${m.medicineName}.`);
        return;
      }

      // Parse times
      if (m.frequency !== 'AS_NEEDED') {
        const times = m.timesOfDayString
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean);

        if (times.length === 0) {
          notify.error(`At least one time is required for ${m.medicineName}.`);
          return;
        }

        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        for (const t of times) {
          if (!timeRegex.test(t)) {
            notify.error(
              `Invalid time format "${t}" for ${m.medicineName}. Must be HH:mm (e.g. 08:30).`,
            );
            return;
          }
        }
      }
    }

    // Format payload
    const payload = {
      doctorName: doctorName.trim() || undefined,
      prescribedAt: prescribedAt
        ? new Date(prescribedAt).toISOString()
        : undefined,
      medicines: activeMeds.map((m) => ({
        extractedMedicineId: m.id,
        medicineName: m.medicineName.trim(),
        brandName: m.brandName.trim() || undefined,
        genericName: m.genericName.trim() || undefined,
        dosage: m.dosage.trim() || undefined,
        frequency: m.frequency,
        timesOfDay:
          m.frequency === 'AS_NEEDED'
            ? []
            : m.timesOfDayString
                .split(',')
                .map((t) => t.trim())
                .filter(Boolean),
        durationDays: Number(m.durationDays) || undefined,
        totalQuantity: Number(m.totalQuantity) || undefined,
        instructions: m.instructions.trim() || undefined,
        createSchedule: true,
      })),
    };

    confirmPrescription.mutate(payload, {
      onSuccess: () => {
        notify.success(
          'Prescription confirmed! Medicines added to your active list.',
        );
        navigate('/medicines');
      },
      onError: (err) => {
        notify.error(
          extractErrorMessage(err, 'Failed to confirm prescription'),
        );
      },
    });
  };

  const handleOpenPrescriptionFile = async () => {
    if (!prescription.fileUrl) return;

    try {
      const response = await apiClient.get<Blob>(prescription.fileUrl, {
        responseType: 'blob',
      });
      const objectUrl = URL.createObjectURL(response.data);
      window.open(objectUrl, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    } catch (error) {
      notify.error(
        extractErrorMessage(error, 'Unable to open prescription file'),
      );
    }
  };
  const isAlreadyConfirmed = prescription.status === 'CONFIRMED';
  const visionReviewActive =
    !isAlreadyConfirmed &&
    (visionJob?.status === 'QUEUED' ||
      visionJob?.status === 'PROCESSING' ||
      (visionJob?.status === 'COMPLETED' && Boolean(visionJob.resultJson)));
  const isLowConfidenceOrRecovered =
    medicines.length > 0 &&
    medicines.some(
      (m) =>
        m.recovered ||
        (m.confidenceScore !== null &&
          m.confidenceScore !== undefined &&
          m.confidenceScore < 0.6),
    );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <Link
          to="/prescriptions"
          className="rounded-xl border border-border p-2 bg-surface hover:bg-surface-raised text-text-muted hover:text-text-primary transition-all"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-text-primary">
            Review Prescription
          </h1>
          <p className="text-xs text-text-muted mt-0.5">
            Verify and adjust AI-extracted medicines before saving.
          </p>
        </div>
      </div>

      {/* Safety Banner */}
      {!isAlreadyConfirmed && (
        <div className="flex gap-3 items-start border border-brand-500/20 bg-brand-500/5 text-brand-300 p-4 rounded-2xl text-sm leading-relaxed">
          <Sparkles className="h-5 w-5 text-brand-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-semibold text-text-primary">
              AI-OCR Ingestion Helper:
            </span>{' '}
            The lists below are suggestions extracted automatically from your
            prescription document. Please review and modify any dosage,
            frequency, or schedule details to match your doctor's official
            instructions before saving.
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: Metadata and Document preview */}
        <div className="lg:col-span-1 flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-text-primary">
                Prescription Document
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {prescription.fileUrl ? (
                prescription.mimeType?.startsWith('image/') ? (
                  <div className="border border-border rounded-xl overflow-hidden bg-slate-950/40">
                    <ProtectedImage
                      src={prescription.fileUrl}
                      alt="Prescription Scan"
                      className="w-full h-auto max-h-[350px] object-contain"
                    />
                  </div>
                ) : (
                  <div className="border border-border rounded-xl p-6 flex flex-col items-center justify-center bg-slate-950/40 text-text-muted text-center">
                    <FileText className="h-12 w-12 mb-3 text-brand-400" />
                    <span className="text-xs font-semibold truncate max-w-[200px] text-text-primary">
                      {prescription.fileName}
                    </span>
                    <span className="text-[10px] mt-1">
                      {prescription.mimeType} (
                      {(prescription.fileSize / 1024).toFixed(1)} KB)
                    </span>
                    <button
                      type="button"
                      onClick={handleOpenPrescriptionFile}
                      className="mt-4 text-xs font-medium text-brand-400 hover:underline"
                    >
                      Open PDF Document
                    </button>
                  </div>
                )
              ) : (
                <div className="text-sm text-text-muted text-center py-6">
                  No document file preview.
                </div>
              )}

              {/* Status Badge */}
              <div className="flex justify-between items-center border-t border-border pt-4 text-sm">
                <span className="text-text-muted">Current Status</span>
                <Badge tone={isAlreadyConfirmed ? 'success' : 'warning'}>
                  {prescription.status}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Metadata edit */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-text-primary">
                Clinical Details
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <Input
                label="Doctor Name"
                disabled={isAlreadyConfirmed}
                leftIcon={<User className="h-4 w-4" />}
                value={doctorName}
                onChange={(e) => setDoctorName(e.target.value)}
                placeholder="Dr. Priya Sharma"
              />
              <Input
                label="Prescribed Date"
                type="date"
                disabled={isAlreadyConfirmed}
                leftIcon={<Calendar className="h-4 w-4" />}
                value={prescribedAt}
                onChange={(e) => setPrescribedAt(e.target.value)}
              />
              {prescription.notes && (
                <div className="text-xs text-text-muted leading-relaxed">
                  <span className="font-semibold block mb-0.5 text-text-primary">
                    Upload Notes
                  </span>
                  {prescription.notes}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column: Extracted Medicines list and verification */}
        <div className="lg:col-span-2 flex flex-col gap-6">
          {!isAlreadyConfirmed && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-brand-400" />
                  Advanced Vision Review
                </CardTitle>
              </CardHeader>

              <CardContent className="flex flex-col gap-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-semibold text-text-primary">
                      {visionJob
                        ? `Status: ${visionJob.status}`
                        : 'Run handwriting-aware medicine extraction'}
                    </p>

                    <p className="text-xs text-text-muted mt-1">
                      {visionJob?.status === 'QUEUED' &&
                        'Waiting for the prescription vision worker.'}
                      {visionJob?.status === 'PROCESSING' &&
                        `${visionJob.stage ?? 'Processing'} - ${visionJob.progress}%`}
                      {visionJob?.status === 'COMPLETED' &&
                        `${visionJob.resultJson?.row_count ?? 0} review-only candidates available.`}
                      {visionJob?.status === 'FAILED' &&
                        'Processing failed. No medicine was confirmed.'}
                      {!visionJob &&
                        'Results are suggestions only and always require your review.'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    {visionJob?.status === 'COMPLETED' &&
                      visionJob.resultJson && (
                        <Button
                          variant="outline"
                          onClick={handleLoadVisionCandidates}
                        >
                          Load Review Candidates
                        </Button>
                      )}

                    <Button
                      onClick={handleStartVisionReview}
                      disabled={
                        startVisionReview.isPending ||
                        visionJob?.status === 'QUEUED' ||
                        visionJob?.status === 'PROCESSING'
                      }
                    >
                      {startVisionReview.isPending ||
                      visionJob?.status === 'QUEUED' ||
                      visionJob?.status === 'PROCESSING' ? (
                        <Spinner size="sm" />
                      ) : visionJob?.status === 'COMPLETED' ? (
                        'Run Again'
                      ) : (
                        'Start Vision Review'
                      )}
                    </Button>
                  </div>
                </div>

                {(visionJob?.status === 'QUEUED' ||
                  visionJob?.status === 'PROCESSING') && (
                  <div className="h-2 overflow-hidden rounded-full bg-slate-900">
                    <div
                      className="h-full bg-brand-500 transition-all duration-500"
                      style={{
                        width: `${Math.max(5, visionJob.progress)}%`,
                      }}
                    />
                  </div>
                )}

                {visionJob?.status === 'FAILED' && (
                  <div className="flex items-start gap-2 rounded-xl border border-danger/20 bg-danger/5 p-3 text-xs text-danger">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>
                      {visionJob.errorMessage ??
                        'Vision processing failed safely.'}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="flex flex-row justify-between items-center">
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-brand-400" /> Extracted
                Medicines
              </CardTitle>
              {prescription.rawOcrText && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowOcrText(!showOcrText)}
                >
                  {showOcrText ? 'Hide Raw OCR' : 'Show Raw OCR'}
                </Button>
              )}
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              {showOcrText && (
                <div className="bg-slate-950/60 text-slate-300 p-4 rounded-xl border border-border text-xs leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap font-mono">
                  {prescription.rawOcrText}
                </div>
              )}

              {isLowConfidenceOrRecovered && (
                <div className="flex gap-3 items-start border border-warning/20 bg-warning/5 text-warning p-4 rounded-2xl text-sm leading-relaxed mb-2">
                  <AlertCircle className="h-5 w-5 shrink-0 mt-0.5 text-warning" />
                  <div>
                    <span className="font-semibold text-text-primary">
                      ⚠ Difficult handwriting detected:
                    </span>{' '}
                    Possible medicines recovered. Please confirm before saving.
                  </div>
                </div>
              )}

              {medicines.length === 0 && visionReviewActive ? (
                <div className="border border-brand-500/20 bg-brand-500/5 rounded-2xl p-6 text-center flex flex-col items-center justify-center">
                  {visionJob?.status === 'COMPLETED' ? (
                    <Check className="h-8 w-8 text-brand-400 mb-2" />
                  ) : (
                    <Spinner size="md" />
                  )}
                  <p className="font-semibold text-text-primary text-sm mt-3">
                    {visionJob?.status === 'COMPLETED'
                      ? 'Vision candidates are ready for review'
                      : 'Vision extraction is processing'}
                  </p>
                  <p className="text-xs text-text-muted mt-2">
                    {visionJob?.status === 'COMPLETED'
                      ? 'Load the review candidates above when you are ready.'
                      : `${visionJob?.stage ?? 'Processing'} - ${visionJob?.progress ?? 0}%`}
                  </p>
                </div>
              ) : medicines.length === 0 ? (
                <div className="border border-border bg-surface rounded-2xl p-6 text-center flex flex-col items-center justify-center">
                  <FileText className="h-8 w-8 text-text-muted mb-2" />
                  <p className="font-semibold text-text-primary text-sm">
                    Unable to confidently read prescription
                  </p>
                  <div className="text-xs text-text-muted mt-2 space-y-1 text-center">
                    <p>
                      <span className="font-semibold text-text-secondary">
                        Reason:
                      </span>{' '}
                      Low OCR quality
                    </p>
                    <p>
                      <span className="font-semibold text-text-secondary">
                        Action:
                      </span>{' '}
                      Upload clearer image or add manually
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {medicines.map((m, idx) => (
                    <div
                      key={m.id}
                      className={`border rounded-2xl p-5 bg-surface-raised transition-all ${
                        m.enabled
                          ? 'border-brand-500/30 ring-1 ring-brand-500/20'
                          : 'border-border opacity-70'
                      }`}
                    >
                      {/* Intelligence Header */}
                      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 pb-4">
                        <div className="flex items-start gap-3 flex-1">
                          <div className="flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-semibold text-text-primary text-base">
                                {m.source === 'VISION' &&
                                m.readableCandidate === false
                                  ? 'Needs manual reading:'
                                  : 'Detected:'}{' '}
                                <span className="font-mono text-brand-400 bg-brand-500/10 px-2 py-0.5 rounded text-sm">
                                  {m.rawExtractedName}
                                </span>
                              </span>

                              {/* Colored status badge */}
                              <Badge
                                tone={
                                  m.verificationStatus === 'VERIFIED'
                                    ? 'success'
                                    : m.verificationStatus === 'VERIFY_REQUIRED'
                                      ? 'warning'
                                      : 'danger'
                                }
                              >
                                {m.verificationStatus === 'VERIFIED'
                                  ? 'Verified'
                                  : m.verificationStatus === 'VERIFY_REQUIRED'
                                    ? 'Verify Required'
                                    : 'Low Confidence Review'}
                              </Badge>

                              {m.candidateState && (
                                <Badge
                                  tone={
                                    m.candidateState === 'KNOWN'
                                      ? 'success'
                                      : m.candidateState === 'UNKNOWN'
                                        ? 'warning'
                                        : m.candidateState === 'LOW_CONFIDENCE'
                                          ? 'warning'
                                          : 'danger'
                                  }
                                >
                                  {m.candidateState === 'KNOWN'
                                    ? 'Known Medicine'
                                    : m.candidateState === 'UNKNOWN'
                                      ? 'Unknown Medicine'
                                      : m.candidateState === 'LOW_CONFIDENCE'
                                        ? 'Low Confidence'
                                        : 'Unverified'}
                                </Badge>
                              )}

                              {m.recovered && (
                                <Badge tone="warning">Recovered</Badge>
                              )}

                              {m.confidenceScore !== undefined &&
                                m.confidenceScore !== null && (
                                  <Badge tone="info">
                                    AI Confidence:{' '}
                                    {Math.round(m.confidenceScore * 100)}%
                                  </Badge>
                                )}

                              {m.verificationSource && (
                                <Badge tone="muted">
                                  Source:{' '}
                                  {m.verificationSource.replace('_', ' ')}
                                </Badge>
                              )}
                            </div>

                            {/* Reasons explainability list */}
                            {m.reasons && m.reasons.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-2">
                                {m.reasons.map((reason, rIdx) => (
                                  <span
                                    key={rIdx}
                                    className="text-[10px] text-text-muted bg-surface border border-border px-2 py-0.5 rounded-full flex items-center gap-1"
                                  >
                                    <span className="w-1 h-1 rounded-full bg-brand-400"></span>
                                    {reason}
                                  </span>
                                ))}
                              </div>
                            )}

                            {m.source === 'VISION' && m.evidence && (
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
                                {m.evidence.name_image && (
                                  <div className="rounded-xl border border-border bg-slate-950/40 p-2">
                                    <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">
                                      Medicine-name crop
                                    </div>
                                    <img
                                      src={toApiAssetUrl(m.evidence.name_image)}
                                      alt={`Medicine candidate row ${idx + 1}`}
                                      className="w-full max-h-28 object-contain rounded"
                                    />
                                  </div>
                                )}

                                {m.evidence.context_image && (
                                  <div className="rounded-xl border border-border bg-slate-950/40 p-2">
                                    <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">
                                      Full row context
                                    </div>
                                    <img
                                      src={toApiAssetUrl(
                                        m.evidence.context_image,
                                      )}
                                      alt={`Prescription context row ${idx + 1}`}
                                      className="w-full max-h-28 object-contain rounded"
                                    />
                                  </div>
                                )}
                              </div>
                            )}

                            {m.isAmbiguous &&
                              m.ambiguousOptions &&
                              m.ambiguousOptions.length > 0 && (
                                <div className="mt-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl">
                                  <div className="text-amber-400 font-semibold text-[11px] uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></span>
                                    Multiple possible medicines detected
                                  </div>
                                  <div className="flex flex-wrap gap-2">
                                    {m.ambiguousOptions.map((opt: string) => (
                                      <button
                                        key={opt}
                                        type="button"
                                        disabled={isAlreadyConfirmed}
                                        onClick={() => {
                                          handleMedicineChange(
                                            idx,
                                            'medicineName',
                                            opt,
                                          );
                                          handleMedicineChange(
                                            idx,
                                            'brandName',
                                            opt,
                                          );
                                        }}
                                        className={`px-3 py-1 text-xs rounded-full border transition-all ${
                                          m.medicineName.toLowerCase() ===
                                          opt.toLowerCase()
                                            ? 'bg-amber-500 border-amber-500 text-white font-medium shadow-md shadow-amber-500/20'
                                            : 'bg-slate-950/40 border-border text-text-secondary hover:bg-slate-900'
                                        }`}
                                      >
                                        {opt}
                                      </button>
                                    ))}
                                  </div>
                                </div>
                              )}

                            {/* AI Understanding Section */}
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-3 text-xs bg-slate-950/40 p-3 rounded-xl border border-border">
                              <div>
                                <span className="text-text-muted block font-medium">
                                  Brand Name
                                </span>
                                <span className="text-text-primary font-semibold">
                                  {m.brandName || '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-text-muted block font-medium">
                                  Generic Composition
                                </span>
                                <span className="text-text-primary font-semibold">
                                  {m.genericName || '—'}
                                </span>
                              </div>
                              <div>
                                <span className="text-text-muted block font-medium">
                                  Strength / Dosage
                                </span>
                                <span className="text-text-primary font-semibold">
                                  {m.dosage || '—'}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>

                        {/* Explicit Confirm / Edit / Reject buttons */}
                        {!isAlreadyConfirmed && (
                          <div className="flex items-center gap-2 shrink-0 self-center md:self-start">
                            <Button
                              size="sm"
                              variant={m.enabled ? 'primary' : 'ghost'}
                              leftIcon={<Check className="h-4 w-4" />}
                              onClick={() => {
                                handleMedicineChange(idx, 'enabled', true);
                                handleMedicineChange(
                                  idx,
                                  'isEditing',
                                  m.source === 'VISION',
                                );
                              }}
                            >
                              {m.source === 'VISION' ? 'Review' : 'Confirm'}
                            </Button>
                            <Button
                              size="sm"
                              variant={m.isEditing ? 'outline' : 'ghost'}
                              onClick={() =>
                                handleMedicineChange(
                                  idx,
                                  'isEditing',
                                  !m.isEditing,
                                )
                              }
                            >
                              {m.isEditing ? 'Close Edit' : 'Edit'}
                            </Button>
                            <Button
                              size="sm"
                              variant={!m.enabled ? 'danger' : 'ghost'}
                              onClick={() => {
                                handleMedicineChange(idx, 'enabled', false);
                                handleMedicineChange(idx, 'isEditing', false);
                              }}
                            >
                              Reject
                            </Button>
                          </div>
                        )}
                      </div>

                      {/* Expanded Settings Form */}
                      {m.enabled && m.isEditing && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 border-t border-border pt-4">
                          <Input
                            label="Medicine Name"
                            disabled={isAlreadyConfirmed}
                            value={m.medicineName}
                            onChange={(e) =>
                              handleMedicineChange(
                                idx,
                                'medicineName',
                                e.target.value,
                              )
                            }
                          />
                          <Input
                            label="Strength / Dosage"
                            disabled={isAlreadyConfirmed}
                            placeholder="e.g. 500mg, 10ml"
                            value={m.dosage}
                            onChange={(e) =>
                              handleMedicineChange(
                                idx,
                                'dosage',
                                e.target.value,
                              )
                            }
                          />
                          <Input
                            label="Brand Name (Optional)"
                            disabled={isAlreadyConfirmed}
                            placeholder="e.g. Lipitor"
                            value={m.brandName}
                            onChange={(e) =>
                              handleMedicineChange(
                                idx,
                                'brandName',
                                e.target.value,
                              )
                            }
                          />
                          <Input
                            label="Generic Composition (Optional)"
                            disabled={isAlreadyConfirmed}
                            placeholder="e.g. Metformin"
                            value={m.genericName}
                            onChange={(e) =>
                              handleMedicineChange(
                                idx,
                                'genericName',
                                e.target.value,
                              )
                            }
                          />
                          <Select
                            label="Frequency"
                            disabled={isAlreadyConfirmed}
                            options={FREQUENCY_OPTIONS}
                            value={m.frequency}
                            onChange={(e) =>
                              handleMedicineChange(
                                idx,
                                'frequency',
                                e.target.value,
                              )
                            }
                          />

                          {m.frequency !== 'AS_NEEDED' && (
                            <Input
                              label="Times of Day (comma-separated HH:mm)"
                              disabled={isAlreadyConfirmed}
                              placeholder="e.g. 08:00, 20:00"
                              value={m.timesOfDayString}
                              onChange={(e) =>
                                handleMedicineChange(
                                  idx,
                                  'timesOfDayString',
                                  e.target.value,
                                )
                              }
                            />
                          )}

                          <Input
                            label="Duration (Days)"
                            type="number"
                            disabled={isAlreadyConfirmed}
                            value={String(m.durationDays)}
                            onChange={(e) =>
                              handleMedicineChange(
                                idx,
                                'durationDays',
                                Number(e.target.value),
                              )
                            }
                          />
                          <Input
                            label="Stock Quantity"
                            type="number"
                            disabled={isAlreadyConfirmed}
                            value={String(m.totalQuantity)}
                            onChange={(e) =>
                              handleMedicineChange(
                                idx,
                                'totalQuantity',
                                Number(e.target.value),
                              )
                            }
                          />
                          <Input
                            label="Instructions"
                            disabled={isAlreadyConfirmed}
                            placeholder="e.g. Take after breakfast"
                            className="md:col-span-2"
                            value={m.instructions}
                            onChange={(e) =>
                              handleMedicineChange(
                                idx,
                                'instructions',
                                e.target.value,
                              )
                            }
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Confirm / Action button */}
              {!isAlreadyConfirmed && (
                <div className="flex justify-end items-center gap-3 border-t border-border pt-6 mt-2">
                  <Link to="/prescriptions">
                    <Button variant="ghost">Cancel</Button>
                  </Link>
                  <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/jpeg,image/png,application/pdf"
                    onChange={handleRecoverAgain}
                  />
                  <Button
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRecovering}
                  >
                    {isRecovering ? <Spinner size="sm" /> : 'Recover Again'}
                  </Button>
                  <Button
                    leftIcon={<Save className="h-4 w-4" />}
                    onClick={handleConfirm}
                    disabled={confirmPrescription.isPending || isRecovering}
                  >
                    {confirmPrescription.isPending ? (
                      <Spinner size="sm" />
                    ) : (
                      'Confirm & Save Schedules'
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
