import { useEffect, useMemo, useRef, useState } from 'react';
import { Barcode, Camera, CheckCircle2, Keyboard, ScanLine, XCircle } from 'lucide-react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import { medicinesService } from '@/services/medicines.service';
import { extractErrorMessage } from '@/lib/api-client';
import type {
  CreateMedicinePayload,
  MedicineForm,
  MedicineMasterSearchResult,
  MedicinePackage,
} from '@/types/medicine';

type BarcodeLookupResult = Awaited<ReturnType<typeof medicinesService.lookupBarcode>>;

interface BarcodeCaptureProps {
  isSubmitting?: boolean;
  onConfirmMatch: (payload: CreateMedicinePayload) => void;
  onCancel?: () => void;
}

function normalizeCode(value: string) {
  return value.replace(/[^0-9A-Za-z]/g, '').trim();
}

function formFromMaster(master: MedicineMasterSearchResult): MedicineForm {
  const text = `${master.type ?? ''} ${master.brandName}`.toLowerCase();
  if (/\b(cap|caps|capsule)\b/.test(text)) return 'CAPSULE';
  if (/\b(syrup|syp|suspension|susp)\b/.test(text)) return 'SYRUP';
  if (/\b(inj|injection|vial|ampoule)\b/.test(text)) return 'INJECTION';
  if (/\b(drop|drops)\b/.test(text)) return 'DROPS';
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
    CREAM: 'g',
    OINTMENT: 'g',
    POWDER: 'sachets',
  };

  return units[form] ?? 'units';
}

function matchTitle(match: { master: MedicineMasterSearchResult; package: MedicinePackage }) {
  return [
    match.master.brandName,
    match.master.composition ?? match.master.genericName,
    match.master.manufacturer,
    match.package.packSize,
  ]
    .filter(Boolean)
    .join(' | ');
}

export function BarcodeCapture({
  isSubmitting,
  onConfirmMatch,
  onCancel,
}: BarcodeCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [code, setCode] = useState('');
  const [lookup, setLookup] = useState<BarcodeLookupResult | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [stockQuantity, setStockQuantity] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const [isLookingUp, setIsLookingUp] = useState(false);
  const [isQueueing, setIsQueueing] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  const exactMatches = useMemo(() => {
    if (!lookup?.found) return [];
    if (lookup.packages?.length) return lookup.packages;
    if (lookup.master && lookup.package) {
      return [{ master: lookup.master, package: lookup.package }];
    }
    return [];
  }, [lookup]);

  const selectedMatch =
    exactMatches.find((match) => match.package.id === selectedPackageId) ??
    exactMatches[0] ??
    null;

  const stopCamera = () => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    setIsScanning(false);
  };

  useEffect(
    () => () => {
      controlsRef.current?.stop();
      controlsRef.current = null;
    },
    [],
  );

  const lookupCode = async (rawCode: string) => {
    const nextCode = normalizeCode(rawCode);
    if (nextCode.length < 4) {
      notify.error('Barcode number is too short');
      return;
    }

    setCode(nextCode);
    setLookup(null);
    setSelectedPackageId('');
    setIsLookingUp(true);

    try {
      const result = await medicinesService.lookupBarcode(nextCode);
      setLookup(result);

      const matches = result.packages?.length
        ? result.packages
        : result.master && result.package
          ? [{ master: result.master, package: result.package }]
          : [];

      setSelectedPackageId(matches[0]?.package.id ?? '');

      if (!result.found) {
        notify.message('Barcode not found in verified packages');
      }
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Failed to lookup barcode'));
    } finally {
      setIsLookingUp(false);
    }
  };

  const startCamera = async () => {
    if (!videoRef.current) return;

    setCameraError(null);
    setIsScanning(true);

    try {
      const reader = new BrowserMultiFormatReader();
      controlsRef.current = await reader.decodeFromVideoDevice(
        undefined,
        videoRef.current,
        (result) => {
          const text = result?.getText();
          if (!text) return;
          stopCamera();
          lookupCode(text);
        },
      );
    } catch (error) {
      stopCamera();
      setCameraError(
        error instanceof Error
          ? error.message
          : 'Camera scanning is unavailable in this browser.',
      );
    }
  };

  const queueUnknown = async () => {
    const nextCode = normalizeCode(code);
    if (nextCode.length < 4) {
      notify.error('Barcode number is too short');
      return;
    }

    setIsQueueing(true);
    try {
      await medicinesService.reportUnknownBarcode(nextCode);
      notify.success('Unknown barcode queued for admin review');
      setLookup(null);
      setCode('');
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Failed to queue barcode'));
    } finally {
      setIsQueueing(false);
    }
  };

  const confirmKnown = () => {
    if (!selectedMatch) return;
    const form = formFromMaster(selectedMatch.master);

    onConfirmMatch({
      medicineMasterId: selectedMatch.master.id,
      medicinePackageId: selectedMatch.package.id,
      name: selectedMatch.master.brandName,
      brandName: selectedMatch.master.brandName,
      genericName:
        selectedMatch.master.genericName ?? selectedMatch.master.composition ?? undefined,
      strength: selectedMatch.master.strength ?? undefined,
      form,
      unit: unitForForm(form),
      stockQuantity: Math.max(0, Math.floor(stockQuantity)),
      source: 'BARCODE',
      visualConfirmed: true,
      notes: `Added after barcode confirmation: ${lookup?.gtin ?? code}`,
    });
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-lg border border-border bg-surface-raised p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Barcode className="h-5 w-5 text-brand-400" />
            <div>
              <h3 className="text-sm font-semibold text-text-primary">Barcode scan</h3>
              <p className="text-xs text-text-muted">
                Exact GTIN lookup only. No fuzzy matching is used.
              </p>
            </div>
          </div>
          {isScanning && <Badge tone="info">Scanning</Badge>}
        </div>

        <div className="overflow-hidden rounded-lg border border-border bg-bg-inset">
          <video
            ref={videoRef}
            muted
            playsInline
            className="aspect-video w-full bg-black object-cover"
          />
        </div>

        {cameraError && (
          <p className="mt-2 text-xs text-warning">
            Camera unavailable. Enter the barcode number manually below.
          </p>
        )}

        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            leftIcon={<Camera className="h-4 w-4" />}
            onClick={startCamera}
            disabled={isScanning || isLookingUp}
          >
            Start camera
          </Button>
          <Button
            type="button"
            variant="ghost"
            leftIcon={<XCircle className="h-4 w-4" />}
            onClick={stopCamera}
            disabled={!isScanning}
          >
            Stop
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <Input
          label="Barcode number"
          placeholder="Scan or enter GTIN"
          value={code}
          leftIcon={<Keyboard className="h-4 w-4" />}
          onChange={(event) => setCode(event.target.value)}
        />
        <div className="flex items-end">
          <Button
            type="button"
            onClick={() => lookupCode(code)}
            isLoading={isLookingUp}
            disabled={isScanning}
            fullWidth
          >
            Lookup
          </Button>
        </div>
      </div>

      {lookup?.found && selectedMatch && (
        <div className="rounded-lg border border-brand-500/30 bg-brand-500/10 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-text-primary">
                  {selectedMatch.master.brandName}
                </h3>
                <Badge tone="success">Exact barcode</Badge>
              </div>
              <p className="mt-1 text-xs text-text-muted">
                {matchTitle(selectedMatch)}
              </p>
              <p className="mt-1 text-xs text-text-muted">GTIN: {lookup.gtin}</p>
            </div>
            {isLookingUp && <Spinner size="sm" />}
          </div>

          {exactMatches.length > 1 && (
            <label className="mt-3 block text-sm font-medium text-text-primary">
              Package
              <select
                value={selectedPackageId}
                onChange={(event) => setSelectedPackageId(event.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-border bg-bg-inset px-3 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
              >
                {exactMatches.map((match) => (
                  <option key={match.package.id} value={match.package.id}>
                    {matchTitle(match)}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-h-24 items-center justify-center rounded-lg border border-border bg-bg-inset p-3 text-center text-xs text-text-muted">
              {selectedMatch.package.stripImageUrl ? (
                <img
                  src={selectedMatch.package.stripImageUrl}
                  alt={`${selectedMatch.master.brandName} strip`}
                  className="max-h-28 rounded object-contain"
                />
              ) : (
                <span>Strip image unavailable. Confirm by package text.</span>
              )}
            </div>
            <div className="flex min-h-24 items-center justify-center rounded-lg border border-border bg-bg-inset p-3 text-center text-xs text-text-muted">
              {selectedMatch.package.pillImageUrl ? (
                <img
                  src={selectedMatch.package.pillImageUrl}
                  alt={`${selectedMatch.master.brandName} product`}
                  className="max-h-28 rounded object-contain"
                />
              ) : (
                <span>
                  Product image unavailable. Confirm manufacturer:{' '}
                  {selectedMatch.master.manufacturer ?? 'not listed'}
                </span>
              )}
            </div>
          </div>

          <div className="mt-3 max-w-xs">
            <Input
              label="Current stock"
              type="number"
              min={0}
              value={stockQuantity}
              onChange={(event) => setStockQuantity(Number(event.target.value) || 0)}
            />
          </div>

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="secondary" onClick={onCancel} disabled={isSubmitting}>
                Cancel
              </Button>
            )}
            <Button
              type="button"
              leftIcon={<CheckCircle2 className="h-4 w-4" />}
              onClick={confirmKnown}
              isLoading={isSubmitting}
            >
              Confirm and add
            </Button>
          </div>
        </div>
      )}

      {lookup && !lookup.found && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
          <h3 className="text-sm font-semibold text-text-primary">Barcode not found</h3>
          <p className="mt-1 text-xs text-text-muted">
            This code will be queued for admin verification. No medicine will be linked
            automatically.
          </p>
          <div className="mt-3 flex flex-wrap justify-end gap-2">
            {onCancel && (
              <Button type="button" variant="secondary" onClick={onCancel} disabled={isQueueing}>
                Cancel
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              leftIcon={<ScanLine className="h-4 w-4" />}
              onClick={queueUnknown}
              isLoading={isQueueing}
            >
              Queue for review
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
