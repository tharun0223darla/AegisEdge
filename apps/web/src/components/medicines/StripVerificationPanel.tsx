import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  HelpCircle,
  ShieldX,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { notify } from '@/components/ui/Toast';
import { compressImageForUpload } from '@/lib/image-compression';
import { extractErrorMessage } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { medicinesService } from '@/services/medicines.service';
import { nativeTextOcrService } from '@/services/native-text-ocr.service';
import type { Medicine, StripVerificationResult } from '@/types/medicine';

export function StripVerificationPanel({ medicine }: { medicine: Medicine }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<StripVerificationResult | null>(null);
  const [isChecking, setIsChecking] = useState(false);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  const handleImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      notify.error('Choose a JPG or PNG strip image');
      return;
    }

    setIsChecking(true);
    setResult(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);

    try {
      const optimized = await compressImageForUpload(file, {
        maxDimension: 1600,
        quality: 0.84,
        maxBytes: 2.5 * 1024 * 1024,
        outputName: 'strip-verification',
      });
      setPreviewUrl(URL.createObjectURL(optimized.file));

      const nativeOcr = await nativeTextOcrService.recognizeFile(
        optimized.file,
      );
      const verification = nativeOcr.success
        ? await medicinesService.verifyStripText(medicine.id, {
            ocrText: nativeOcr.text,
            ocrConfidence: nativeOcr.confidence,
            engine: nativeOcr.engine,
          })
        : await medicinesService.verifyStripImage(medicine.id, optimized.file);
      setResult(verification);
    } catch (error) {
      notify.error(extractErrorMessage(error, 'Unable to verify the strip'));
    } finally {
      setIsChecking(false);
    }
  };

  const statusStyle =
    result?.status === 'MATCH'
      ? 'border-success bg-success/10'
      : result?.status === 'MISMATCH'
        ? 'border-danger bg-danger/10'
        : result?.status === 'UNCERTAIN'
          ? 'border-warning bg-warning/10'
          : 'border-border bg-bg-inset';
  const StatusIcon =
    result?.status === 'MATCH'
      ? CheckCircle2
      : result?.status === 'MISMATCH'
        ? ShieldX
        : result?.status === 'UNCERTAIN'
          ? AlertTriangle
          : HelpCircle;

  return (
    <div className="mt-4 border-t border-border pt-4">
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void handleImage(file);
        }}
      />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            Check before taking
          </p>
          <p className="mt-1 text-xs text-text-muted">
            Point the camera at the printed brand and composition on the strip.
          </p>
        </div>
        <Button
          type="button"
          variant="secondary"
          leftIcon={<Camera className="h-4 w-4" />}
          onClick={() => inputRef.current?.click()}
          isLoading={isChecking}
        >
          Verify strip
        </Button>
      </div>

      {(previewUrl || result) && (
        <div
          className={cn(
            'mt-3 overflow-hidden rounded-lg border-2 p-3 transition-colors',
            statusStyle,
          )}
        >
          <div className="grid gap-3 sm:grid-cols-[140px_minmax(0,1fr)] sm:items-center">
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Current strip verification frame"
                className="h-28 w-full rounded object-contain"
              />
            )}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusIcon className="h-5 w-5 text-current" />
                <p className="text-sm font-semibold text-text-primary">
                  {isChecking
                    ? 'Reading printed text...'
                    : (result?.reason ?? 'Ready to check')}
                </p>
                {result && (
                  <Badge
                    tone={
                      result.status === 'MATCH'
                        ? 'success'
                        : result.status === 'MISMATCH'
                          ? 'danger'
                          : 'warning'
                    }
                  >
                    {result.status.toLowerCase()}
                  </Badge>
                )}
              </div>
              {result && (
                <p className="mt-2 text-xs text-text-muted">
                  {result.safetyNotice}
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
