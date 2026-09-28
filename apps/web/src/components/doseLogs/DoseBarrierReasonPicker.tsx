import { useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import { DOSE_BARRIER_OPTIONS } from '@/constants/adherence-barriers';
import { useRecordDoseBarrier } from '@/hooks/useDoseLogs';
import type { DoseBarrierReason } from '@/types/dose-log';

interface DoseBarrierReasonPickerProps {
  doseLogId: string;
  currentReason?: DoseBarrierReason | null;
  open: boolean;
  onClose: () => void;
}

export function DoseBarrierReasonPicker({
  doseLogId,
  currentReason,
  open,
  onClose,
}: DoseBarrierReasonPickerProps) {
  const [reason, setReason] = useState<DoseBarrierReason | ''>(
    currentReason ?? '',
  );
  const mutation = useRecordDoseBarrier();

  useEffect(() => {
    if (open) setReason(currentReason ?? '');
  }, [currentReason, open]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Why wasn't this dose taken?"
      description="Choose the main reason for your personal adherence record."
      footer={
        <>
          <Button
            variant="outline"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!reason) return;
              mutation.mutate(
                { doseLogId, reason },
                { onSuccess: () => onClose() },
              );
            }}
            disabled={!reason}
            isLoading={mutation.isPending}
          >
            Save reason
          </Button>
        </>
      }
    >
      <div className="grid gap-2 sm:grid-cols-2">
        {DOSE_BARRIER_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setReason(option.value)}
            className={`min-h-11 border px-3 py-2 text-left text-sm transition-colors ${
              reason === option.value
                ? 'border-brand-500 bg-brand-500/10 text-text-primary'
                : 'border-border bg-bg-inset text-text-secondary hover:border-border-strong'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {reason === 'SIDE_EFFECT_CONCERN' ? (
        <div className="mt-4 flex gap-3 border-l-2 border-warning bg-warning/5 px-4 py-3 text-sm text-text-secondary">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p>
            Contact a clinician or pharmacist. Do not stop, restart, or change a
            dose without professional advice. For severe symptoms or an
            emergency, contact local emergency services now.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}
