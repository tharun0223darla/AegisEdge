import { useEffect, useMemo, useRef, useState } from 'react';
import { Camera, CheckCircle2, ImageUp, Keyboard, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import { medicinesService } from '@/services/medicines.service';
import { extractErrorMessage } from '@/lib/api-client';
import { compressImageForUpload } from '@/lib/image-compression';
import { nativeTextOcrService } from '@/services/native-text-ocr.service';
import { CameraCaptureModal } from '@/components/shared/CameraCaptureModal';
import type {
  CreateMedicinePayload,
  MedicineForm,
  MedicineMasterSearchResult,
  PackageImageCaptureResult,
} from '@/types/medicine';

interface PackageImageCaptureProps {
  isSubmitting?: boolean;
  onConfirm: (payload: CreateMedicinePayload) => void;
  onCancel?: () => void;
}

function scoreLabel(score?: number) {
  if (score === undefined || Number.isNaN(score)) return '0%';
  return `${Math.round(score * 100)}%`;
}

function formFromMaster(
  master?: MedicineMasterSearchResult | null,
): MedicineForm {
  const text = `${master?.type ?? ''} ${master?.brandName ?? ''}`.toLowerCase();
  if (/\b(cap|caps|capsule)\b/.test(text)) return 'CAPSULE';
  if (/\b(syrup|syp|suspension|susp)\b/.test(text)) return 'SYRUP';
  if (/\b(inj|injection|vial|ampoule)\b/.test(text)) return 'INJECTION';
  if (/\b(drop|drops)\b/.test(text)) return 'DROPS';
  if (/\b(patch)\b/.test(text)) return 'PATCH';
  if (/\b(cream)\b/.test(text)) return 'CREAM';
  if (/\b(oint|ointment)\b/.test(text)) return 'OINTMENT';
  if (/\b(powder|sachet)\b/.test(text)) return 'POWDER';
  return 'TABLET';
}

function unitForForm(form: MedicineForm) {
  const units: Partial<Record<MedicineForm, string>> = {
    TABLET: 'tablets',
    CAPSULE: 'capsules',
    SYRUP: 'ml',
    INJECTION: 'units',
    DROPS: 'ml',
    PATCH: 'patches',
    CREAM: 'g',
    OINTMENT: 'g',
    POWDER: 'sachets',
  };

  return units[form] ?? 'units';
}

function normalizeMatchText(value?: string | null) {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function hasBrandAlignedMatch(
  candidate: NonNullable<PackageImageCaptureResult['candidate']>,
  match?: MedicineMasterSearchResult,
) {
  const raw = normalizeMatchText(candidate.rawName);
  const brand = normalizeMatchText(match?.brandName);

  return Boolean(raw && brand && (raw.includes(brand) || brand.includes(raw)));
}

function defaultMasterId(result: PackageImageCaptureResult | null) {
  const candidate = result?.candidate;
  if (!candidate || candidate.weak) return '';
  const firstMatch = candidate.masterMatches[0];
  if (candidate.composition && !hasBrandAlignedMatch(candidate, firstMatch))
    return '';
  if (candidate.resolverOutcome.kind === 'STRONG') {
    return candidate.resolverOutcome.match?.masterId ?? firstMatch?.id ?? '';
  }
  if (candidate.resolverOutcome.kind === 'POSSIBLE') {
    return (
      candidate.resolverOutcome.matches?.[0]?.masterId ?? firstMatch?.id ?? ''
    );
  }
  return '';
}

function hasUsablePackageOcr(result: PackageImageCaptureResult | null) {
  return Boolean(
    result?.ocr.success &&
    result.ocr.source !== 'NO_RESULT' &&
    result.candidate,
  );
}

export function PackageImageCapture({
  isSubmitting,
  onConfirm,
  onCancel,
}: PackageImageCaptureProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [result, setResult] = useState<PackageImageCaptureResult | null>(null);
  const [medicineName, setMedicineName] = useState('');
  const [strength, setStrength] = useState('');
  const [selectedMasterId, setSelectedMasterId] = useState('');
  const [stockQuantity, setStockQuantity] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [cameraModalOpen, setCameraModalOpen] = useState(false);

  const selectedMaster = useMemo(
    () =>
      result?.candidate?.masterMatches.find(
        (match) => match.id === selectedMasterId,
      ) ?? null,
    [result, selectedMasterId],
  );
  const selectedPackage = selectedMaster?.packages?.[0] ?? null;
  const hasUsableOcr = hasUsablePackageOcr(result);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const handleFile = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      notify.error('Use a package photo image');
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setUploadProgress(5);
    setIsUploading(true);
    setResult(null);
    setSelectedMasterId('');

    try {
      const optimized = await compressImageForUpload(file, {
        maxDimension: 2400,
        quality: 0.92,
        maxBytes: 4 * 1024 * 1024,
        outputName: 'package-photo',
      });
      setPreviewUrl(URL.createObjectURL(optimized.file));
      setUploadProgress(10);

      const nativeOcr = await nativeTextOcrService.recognizeFile(
        optimized.file,
      );

      const next = await medicinesService.capturePackageImage({
        file: optimized.file,
        nativeOcr,
        onProgress: (pct) => setUploadProgress(Math.max(10, pct)),
      });
      setResult(next);
      const usable = hasUsablePackageOcr(next);
      const resolvedMasterId = usable ? defaultMasterId(next) : '';
      const matchedMaster = next?.candidate?.masterMatches.find(
        (match) => match.id === resolvedMasterId,
      );
      const canonicalName =
        matchedMaster?.brandName || next?.candidate?.rawName || '';
      const canonicalStrength =
        matchedMaster?.strength || next?.candidate?.extractedStrength || '';

      setMedicineName(usable ? canonicalName : '');
      setStrength(usable ? canonicalStrength : '');
      setSelectedMasterId(resolvedMasterId);
      if (usable) {
        if (next.candidate?.weak) {
          notify.message('Package text needs your review before saving.');
        } else if (matchedMaster) {
          notify.success(`Verified: ${matchedMaster.brandName}`);
        } else {
          notify.success('Package text extracted');
        }
      } else {
        notify.error('Unable to read medicine strip. Please retake the photo.');
      }
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Failed to read package image'));
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  const handleConfirm = () => {
    if (!result || !hasUsablePackageOcr(result)) {
      notify.error('Unable to read medicine strip. Please retake the photo.');
      return;
    }

    const name = medicineName.trim();
    if (!name) {
      notify.error('Type the medicine name before confirming');
      return;
    }
    const form = formFromMaster(selectedMaster);
    const compositionName = result.candidate?.composition?.displayName;

    onConfirm({
      ...(selectedMaster ? { medicineMasterId: selectedMaster.id } : {}),
      ...(selectedPackage ? { medicinePackageId: selectedPackage.id } : {}),
      name,
      brandName: name,
      genericName:
        compositionName ??
        selectedMaster?.genericName ??
        selectedMaster?.composition ??
        undefined,
      strength: strength.trim() || selectedMaster?.strength || undefined,
      form,
      unit: unitForForm(form),
      stockQuantity: Math.max(0, Math.floor(stockQuantity)),
      source: 'PACKAGE_IMAGE',
      userStripImageUrl: result.image.imageUrl,
      userStripOcrText: result.ocr.rawText ?? undefined,
      userStripOcrEngine: result.ocr.engine ?? undefined,
      visualConfirmed: true,
      notes: [
        `Added after package image confirmation: ${result.image.fileName}`,
        compositionName ? `Detected composition: ${compositionName}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) handleFile(file);
        }}
      />

      <div className="rounded-lg border border-border bg-surface-raised p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <ImageUp className="h-5 w-5 text-brand-400" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Package photo
              </h3>
              <p className="text-xs text-text-muted">
                Printed OCR only. Confirm before saving.
              </p>
            </div>
          </div>
          {result?.candidate?.weak && (
            <Badge tone="warning">Low confidence</Badge>
          )}
        </div>

        <div className="flex min-h-52 items-center justify-center overflow-hidden rounded-lg border border-border bg-bg-inset">
          {previewUrl ? (
            <img
              src={previewUrl}
              alt="Package preview"
              className="max-h-72 object-contain"
            />
          ) : (
            <div className="flex flex-col items-center gap-3 text-text-muted">
              <Camera className="h-8 w-8" />
              <span className="text-sm">No image selected</span>
            </div>
          )}
        </div>

        {uploadProgress !== null && (
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
              <span>
                {uploadProgress < 10
                  ? 'Preparing image'
                  : uploadProgress === 100
                    ? 'Reading text'
                    : 'Uploading'}
              </span>
              <span>{uploadProgress}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-border">
              <div
                className="h-full rounded-full bg-brand-500 transition-all"
                style={{ width: `${uploadProgress || 10}%` }}
              />
            </div>
          </div>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            className="bg-brand-600 hover:bg-brand-500 text-white font-bold"
            leftIcon={<Camera className="h-4 w-4" />}
            onClick={() => setCameraModalOpen(true)}
            isLoading={isUploading}
          >
            Laptop Camera
          </Button>
          <Button
            type="button"
            variant="secondary"
            leftIcon={<ImageUp className="h-4 w-4" />}
            onClick={() => fileInputRef.current?.click()}
            isLoading={isUploading}
          >
            Choose image
          </Button>
          {previewUrl && (
            <Button
              type="button"
              variant="ghost"
              leftIcon={<XCircle className="h-4 w-4" />}
              onClick={() => {
                URL.revokeObjectURL(previewUrl);
                setPreviewUrl(null);
                setResult(null);
                setMedicineName('');
                setStrength('');
                setSelectedMasterId('');
              }}
            >
              Clear
            </Button>
          )}
        </div>
      </div>

      {result && (
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge
              tone={
                result.ocr.source === 'ML_KIT'
                  ? 'success'
                  : result.ocr.source === 'SERVER_OCR'
                    ? 'info'
                    : 'warning'
              }
            >
              {result.ocr.source === 'ML_KIT'
                ? 'On-device ML Kit'
                : result.ocr.source === 'SERVER_OCR'
                  ? 'Server OCR'
                  : 'No OCR result'}
            </Badge>
            <Badge
              tone={
                result.candidate?.resolverOutcome.kind === 'STRONG'
                  ? 'success'
                  : result.candidate?.resolverOutcome.kind === 'POSSIBLE'
                    ? 'info'
                    : 'warning'
              }
            >
              {result.candidate?.resolverOutcome.kind.toLowerCase() ?? 'manual'}
            </Badge>
            {result.candidate && (
              <Badge tone="muted">
                {scoreLabel(result.candidate.ocrConfidence)}
              </Badge>
            )}
            {result.candidate?.extractedPack && (
              <Badge tone="muted">{result.candidate.extractedPack}</Badge>
            )}
          </div>

          {!hasUsableOcr && (
            <p className="mb-3 text-sm text-warning">
              Unable to read medicine strip. Please retake the photo.
            </p>
          )}

          {hasUsableOcr && result.candidate?.weak && (
            <p className="mb-3 text-sm text-warning">
              Text was recovered with low confidence. Check the medicine name
              and strength against the package before confirming.
            </p>
          )}

          {hasUsableOcr && selectedMaster && (
            <div className="mb-3 rounded-lg border border-success/30 bg-success/10 p-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-success" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-success">
                    {result.candidate?.isAutoCorrected
                      ? '✨ Corrected & Verified from Medicine Master'
                      : 'Verified Medicine Master Match'}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold text-text-primary">
                    {selectedMaster.brandName}
                    {selectedMaster.strength
                      ? ` (${selectedMaster.strength})`
                      : ''}
                  </p>
                  {selectedMaster.composition && (
                    <p className="mt-0.5 text-xs text-text-muted">
                      Composition: {selectedMaster.composition}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {hasUsableOcr && !selectedMaster && result.candidate?.ocrLine && (
            <div className="mb-3 whitespace-pre-wrap break-words rounded-lg border border-border bg-bg-inset p-3 text-xs text-text-muted">
              OCR text: {result.candidate.ocrLine}
            </div>
          )}

          {hasUsableOcr && !selectedMaster && result.candidate?.composition && (
            <div className="mb-3 rounded-lg border border-brand-500/30 bg-bg-inset p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-xs font-semibold uppercase text-brand-300">
                    Detected composition
                  </p>
                  <p className="mt-1 text-sm font-semibold text-text-primary">
                    {result.candidate.composition.displayName}
                  </p>
                  <p className="mt-1 text-xs text-text-muted">
                    {result.candidate.composition.rawLine}
                  </p>
                </div>
                {result.candidate.masterMatches.length > 0 &&
                  !selectedMasterId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() =>
                        setSelectedMasterId(
                          result.candidate?.masterMatches[0]?.id ?? '',
                        )
                      }
                    >
                      Use salt match
                    </Button>
                  )}
              </div>
            </div>
          )}

          {hasUsableOcr && (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_150px_140px]">
                <Input
                  label="Medicine name"
                  leftIcon={<Keyboard className="h-4 w-4" />}
                  value={medicineName}
                  onChange={(event) => setMedicineName(event.target.value)}
                />
                <Input
                  label="Strength"
                  value={strength}
                  onChange={(event) => setStrength(event.target.value)}
                />
                <Input
                  label="Stock"
                  type="number"
                  min={0}
                  value={stockQuantity}
                  onChange={(event) =>
                    setStockQuantity(Number(event.target.value) || 0)
                  }
                />
              </div>

              <label className="mt-3 block text-sm font-medium text-text-primary">
                Master match
                <select
                  value={selectedMasterId}
                  onChange={(event) => setSelectedMasterId(event.target.value)}
                  className="mt-1.5 h-10 w-full rounded-xl border border-border bg-bg-inset px-3 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                >
                  <option value="">Unknown / queue review after save</option>
                  {result.candidate?.masterMatches.map((match) => (
                    <option key={match.id} value={match.id}>
                      {[match.brandName, match.composition, match.manufacturer]
                        .filter(Boolean)
                        .join(' | ')}{' '}
                      ({scoreLabel(match.score)})
                    </option>
                  ))}
                </select>
              </label>

              <div className="mt-4 flex flex-wrap justify-end gap-2">
                {onCancel && (
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={onCancel}
                    disabled={isSubmitting}
                  >
                    Cancel
                  </Button>
                )}
                <Button
                  type="button"
                  leftIcon={
                    isSubmitting ? undefined : (
                      <CheckCircle2 className="h-4 w-4" />
                    )
                  }
                  onClick={handleConfirm}
                  isLoading={isSubmitting}
                >
                  Confirm and add
                </Button>
              </div>
            </>
          )}

          {!hasUsableOcr && onCancel && (
            <div className="mt-4 flex justify-end">
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
            </div>
          )}
        </div>
      )}

      {isUploading && !result && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-bg-inset p-4 text-sm text-text-muted">
          <Spinner size="sm" />
          Reading package text
        </div>
      )}

      <CameraCaptureModal
        open={cameraModalOpen}
        onClose={() => setCameraModalOpen(false)}
        onCapture={(file) => void handleFile(file)}
        title="Capture Medicine Package"
        subtitle="Align medicine strip or bottle in front of your laptop webcam and capture photo"
      />
    </div>
  );
}
