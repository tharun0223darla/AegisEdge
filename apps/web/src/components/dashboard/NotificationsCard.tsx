import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ArrowRight, Scan } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { Badge } from '@/components/ui/Badge';
import { relativeTime } from '@/lib/date';
import { ROUTES } from '@/constants/app';
import { useTodayDoses, useDoseAction } from '@/hooks/useDoseLogs';
import { useMarkNotificationRead } from '@/hooks/useNotifications';
import { StripVerificationModal } from '@/components/doseLogs/StripVerificationModal';
import { notify } from '@/components/ui/Toast';
import type { AppNotification } from '@/types/notification';
import type { DoseLog } from '@/types/dose-log';

interface NotificationsCardProps {
  notifications?: AppNotification[];
  isLoading?: boolean;
}

export function NotificationsCard({ notifications, isLoading }: NotificationsCardProps) {
  const navigate = useNavigate();
  const todayDoses = useTodayDoses();
  const doseAction = useDoseAction();
  const markRead = useMarkNotificationRead();

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyDose, setVerifyDose] = useState<DoseLog | null>(null);
  const [activeItem, setActiveItem] = useState<AppNotification | null>(null);

  const items = (notifications ?? []).slice(0, 5);

  const isDoseReminder = (n: AppNotification) => {
    const metaType = (n.metadata?.type as string) || '';
    const title = n.title.toLowerCase();
    return (
      n.type === 'DOSE_REMINDER' ||
      metaType === 'DOSE_REMINDER' ||
      metaType === 'SNOOZE_RETRIGGERED' ||
      Boolean(n.metadata?.doseLogId) ||
      title.includes('time to') ||
      title.includes('dose') ||
      title.includes('pill')
    );
  };

  const handleOpenVerify = (n: AppNotification, e: React.MouseEvent) => {
    e.stopPropagation();
    const meta = n.metadata || {};
    const metaDoseLogId = meta.doseLogId as string | undefined;
    const metaMedName = (meta.medicineName as string | undefined) || '';

    let matched: DoseLog | undefined;
    if (todayDoses.data?.length) {
      if (metaDoseLogId) {
        matched = todayDoses.data.find((d) => d.id === metaDoseLogId);
      }
      if (!matched && metaMedName) {
        matched = todayDoses.data.find((d) =>
          d.medicine?.name?.toLowerCase().includes(metaMedName.toLowerCase().trim()),
        );
      }
    }

    const resolvedDose: DoseLog = matched || {
      id: metaDoseLogId || `notif-dose-${n.id}`,
      medicineId: (meta.medicineId as string) || '',
      scheduleId: (meta.scheduleId as string) || '',
      scheduledAt: n.createdAt || new Date().toISOString(),
      status: 'PENDING',
      createdAt: n.createdAt || new Date().toISOString(),
      medicine: {
        id: (meta.medicineId as string) || 'med-1',
        name: metaMedName || (n.message || n.body || '').split('-')[0]?.replace(/^[⏰💊\s]+/, '').trim() || 'Medication',
        strength: (meta.strength as string) || '',
        form: 'TABLET',
      } as any,
    };

    setVerifyDose(resolvedDose);
    setActiveItem(n);
    setVerifyOpen(true);
  };

  const handleVerifiedTaken = () => {
    if (verifyDose?.scheduleId && verifyDose?.scheduledAt) {
      doseAction.mutate({
        scheduleId: verifyDose.scheduleId,
        scheduledAt: verifyDose.scheduledAt,
        status: 'TAKEN',
        source: 'APP',
      });
    }
    if (activeItem && !activeItem.isRead) {
      markRead.mutate(activeItem.id);
    }
    notify.success(`✅ Strip Verified! ${verifyDose?.medicine?.name || 'Dose'} recorded as TAKEN.`);
    setVerifyOpen(false);
  };

  return (
    <>
      <Card className="flex flex-col justify-between">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-brand-400" /> Recent activity
          </CardTitle>
          <button
            type="button"
            onClick={() => navigate(ROUTES.NOTIFICATIONS)}
            className="inline-flex items-center gap-1 text-xs font-semibold text-brand-400 hover:text-brand-300 transition-colors"
          >
            <span>View All</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
          ) : items.length === 0 ? (
            <EmptyState title="No notifications" className="border-none py-8" />
          ) : (
            items.map((n) => {
              const hasVerify = isDoseReminder(n);
              return (
                <div
                  key={n.id}
                  onClick={() => navigate(ROUTES.NOTIFICATIONS)}
                  className="flex items-start justify-between gap-3 rounded-xl px-2.5 py-2 hover:bg-surface-hover hover:border-border cursor-pointer transition-all border border-transparent group"
                >
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${n.isRead ? 'bg-border-strong' : 'bg-brand-500'}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-text-primary group-hover:text-brand-300 transition-colors">
                          {n.title}
                        </p>
                        {!n.isRead && <Badge tone="brand">New</Badge>}
                      </div>
                      <p className="truncate text-xs text-text-muted">{n.message || n.body}</p>
                      <p className="mt-0.5 text-[11px] text-text-muted">{relativeTime(n.createdAt)}</p>
                    </div>
                  </div>

                  {hasVerify && (
                    <button
                      type="button"
                      onClick={(e) => handleOpenVerify(n, e)}
                      className="shrink-0 inline-flex items-center gap-1 rounded-lg bg-emerald-600/20 border border-emerald-500/40 px-2 py-1 text-[11px] font-bold text-emerald-300 hover:bg-emerald-600 hover:text-white transition-all shadow-sm self-center"
                      title="Verify physical blister pack with OCR camera"
                    >
                      <Scan className="h-3 w-3" />
                      <span>Verify Strip</span>
                    </button>
                  )}
                </div>
              );
            })
          )}
        </CardContent>
      </Card>

      <StripVerificationModal
        dose={verifyDose}
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        onVerifiedTaken={handleVerifiedTaken}
      />
    </>
  );
}
