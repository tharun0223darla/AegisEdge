import { useEffect, useState } from 'react';
import { BellRing, ExternalLink } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/Button';
import { Modal } from '@/components/ui/Modal';
import {
  FOREGROUND_DOSE_REMINDER_EVENT,
  type ForegroundDoseReminder as ForegroundDoseReminderPayload,
} from '@/lib/local-reminders';

export function ForegroundDoseReminder() {
  const navigate = useNavigate();
  const [reminder, setReminder] =
    useState<ForegroundDoseReminderPayload | null>(null);

  useEffect(() => {
    const onReminder = (event: Event) => {
      const detail = (event as CustomEvent<ForegroundDoseReminderPayload>)
        .detail;
      if (!detail) return;
      setReminder(detail);
      navigator.vibrate?.([500, 250, 500, 250, 500]);
    };

    window.addEventListener(FOREGROUND_DOSE_REMINDER_EVENT, onReminder);
    return () =>
      window.removeEventListener(FOREGROUND_DOSE_REMINDER_EVENT, onReminder);
  }, []);

  const openDose = () => {
    const actionUrl = reminder?.actionUrl ?? '/dose-logs';
    setReminder(null);
    navigate(actionUrl);
  };

  return (
    <Modal
      open={Boolean(reminder)}
      onClose={() => setReminder(null)}
      title="Medicine reminder"
      description="Your scheduled dose is due now."
      size="sm"
      closeOnOverlay={false}
      footer={
        <>
          <Button variant="secondary" onClick={() => setReminder(null)}>
            Dismiss
          </Button>
          <Button
            leftIcon={<ExternalLink className="h-4 w-4" />}
            onClick={openDose}
          >
            Open dose log
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-brand-500/15 text-brand-400">
          <BellRing className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <p className="text-base font-semibold text-text-primary">
            {reminder?.body}
          </p>
          {reminder?.scheduledAt && (
            <p className="mt-2 text-sm text-text-muted">
              Scheduled for{' '}
              {new Date(reminder.scheduledAt).toLocaleTimeString([], {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </p>
          )}
        </div>
      </div>
    </Modal>
  );
}
