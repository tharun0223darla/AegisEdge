import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bell,
  Check,
  BellRing,
  Info,
  AlertTriangle,
  Package,
  Scan,
  ArrowRight,
  ShieldCheck,
} from 'lucide-react';
import { PageHeader } from '@/components/shared/PageHeader';
import {
  useNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
} from '@/hooks/useNotifications';
import { useTodayDoses, useDoseAction } from '@/hooks/useDoseLogs';
import { useUser } from '@/store/auth.store';
import { StripVerificationModal } from '@/components/doseLogs/StripVerificationModal';
import { Tabs } from '@/components/ui/Tabs';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Spinner } from '@/components/ui/Spinner';
import { notify } from '@/components/ui/Toast';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';
import { slideInRight, staggerContainer } from '@/animations/variants';
import { ROUTES } from '@/constants/app';
import type { AppNotification } from '@/types/notification';
import type { DoseLog } from '@/types/dose-log';

export default function NotificationsPage() {
  const navigate = useNavigate();
  const user = useUser();
  const [activeTab, setActiveTab] = useState<string>('UNREAD');

  // Verification Modal State
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyDose, setVerifyDose] = useState<DoseLog | null>(null);
  const [activeNotification, setActiveNotification] = useState<AppNotification | null>(null);

  // Fetch Notifications & Today Doses for strip cross-referencing
  const isUnreadOnly = activeTab === 'UNREAD';
  const {
    data: notifications,
    isLoading,
    error,
  } = useNotifications(isUnreadOnly ? { unreadOnly: true } : undefined);
  const todayDoses = useTodayDoses();

  // Mutations
  const markReadMutation = useMarkNotificationRead();
  const markAllReadMutation = useMarkAllNotificationsRead();
  const doseAction = useDoseAction();

  // Notification tab items
  const tabs = [
    { value: 'UNREAD', label: 'Unread' },
    { value: 'ALL', label: 'All Notifications' },
  ];

  // Helper to detect if a notification is for medication intake
  const isDoseReminder = (item: AppNotification): boolean => {
    const metaType = (item.metadata?.type as string) || '';
    const title = item.title.toLowerCase();
    const body = (item.message || item.body || '').toLowerCase();
    return (
      item.type === 'DOSE_REMINDER' ||
      metaType === 'DOSE_REMINDER' ||
      metaType === 'SNOOZE_RETRIGGERED' ||
      Boolean(item.metadata?.doseLogId) ||
      Boolean(item.metadata?.scheduleId) ||
      title.includes('time to') ||
      title.includes('pill') ||
      title.includes('dose') ||
      title.includes('medication') ||
      body.includes('scheduled for') ||
      body.includes('tablet')
    );
  };

  // Helper to resolve colors and icons based on notification title or type metadata
  const getNotificationIcon = (title: string) => {
    const lowerTitle = title.toLowerCase();
    if (
      lowerTitle.includes('missed') ||
      lowerTitle.includes('alert') ||
      lowerTitle.includes('⚠️')
    ) {
      return {
        icon: AlertTriangle,
        bgClass: 'bg-danger-soft text-danger',
      };
    }
    if (
      lowerTitle.includes('stock') ||
      lowerTitle.includes('refill') ||
      lowerTitle.includes('📦')
    ) {
      return {
        icon: Package,
        bgClass: 'bg-warning-soft text-warning',
      };
    }
    if (
      lowerTitle.includes('time to') ||
      lowerTitle.includes('pill') ||
      lowerTitle.includes('💊') ||
      lowerTitle.includes('⏰')
    ) {
      return {
        icon: BellRing,
        bgClass: 'bg-brand-500/10 text-brand-400',
      };
    }
    return {
      icon: Info,
      bgClass: 'bg-info-soft text-info',
    };
  };

  // Resolve or synthesize target DoseLog for strip verification
  const resolveDoseForNotification = (item: AppNotification): DoseLog => {
    const meta = item.metadata || {};
    const metaDoseLogId = meta.doseLogId as string | undefined;
    const metaScheduleId = meta.scheduleId as string | undefined;
    const metaMedName = (meta.medicineName as string | undefined) || '';

    // 1. Try matching with today's real schedules
    if (todayDoses.data?.length) {
      if (metaDoseLogId) {
        const match = todayDoses.data.find((d) => d.id === metaDoseLogId);
        if (match) return match;
      }
      if (metaScheduleId) {
        const match = todayDoses.data.find((d) => d.scheduleId === metaScheduleId);
        if (match) return match;
      }
      if (metaMedName) {
        const match = todayDoses.data.find((d) =>
          d.medicine?.name?.toLowerCase().includes(metaMedName.toLowerCase().trim()),
        );
        if (match) return match;
      }
      const bodyText = (item.message || item.body || '').toLowerCase();
      for (const dose of todayDoses.data) {
        if (dose.medicine?.name && bodyText.includes(dose.medicine.name.toLowerCase())) {
          return dose;
        }
      }
    }

    // 2. Synthesize dose representation for OCR match
    const bodyText = item.message || item.body || '';
    const rawName = metaMedName || bodyText.split('-')[0]?.replace(/^[⏰💊\s]+/, '').trim() || 'Scheduled Medication';
    const strength = (meta.strength as string) || '';

    return {
      id: metaDoseLogId || `notif-dose-${item.id}`,
      medicineId: (meta.medicineId as string) || '',
      scheduleId: metaScheduleId || '',
      scheduledAt: item.createdAt || new Date().toISOString(),
      status: 'PENDING',
      createdAt: item.createdAt || new Date().toISOString(),
      medicine: {
        id: (meta.medicineId as string) || 'med-1',
        name: rawName,
        strength: strength,
        form: 'TABLET',
      } as any,
    };
  };

  const handleOpenVerifyStrip = (item: AppNotification) => {
    const dose = resolveDoseForNotification(item);
    setVerifyDose(dose);
    setActiveNotification(item);
    setVerifyOpen(true);
  };

  const handleVerifiedTaken = () => {
    if (verifyDose) {
      if (verifyDose.scheduleId && verifyDose.scheduledAt) {
        doseAction.mutate({
          scheduleId: verifyDose.scheduleId,
          scheduledAt: verifyDose.scheduledAt,
          status: 'TAKEN',
          source: 'APP',
        });
      }
    }

    if (activeNotification && !activeNotification.isRead) {
      markReadMutation.mutate(activeNotification.id);
    }

    notify.success(
      `✅ Strip Verified! ${verifyDose?.medicine?.name ?? 'Medication'} recorded as TAKEN.`,
    );
    setVerifyOpen(false);
  };

  const unreadCount = notifications?.filter((n) => !n.isRead).length ?? 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <PageHeader
          title="Notifications"
          description="Stay updated with medication reminders, strip verification alerts, and health notices."
        />
        {unreadCount > 0 && (
          <Button
            variant="outline"
            onClick={() => markAllReadMutation.mutate()}
            disabled={markAllReadMutation.isPending}
            className="self-start sm:self-auto gap-2 border-slate-800 hover:bg-slate-900 hover:text-text-primary"
          >
            <Check className="h-4 w-4" />
            Mark all read
          </Button>
        )}
      </div>

      <div className="flex justify-start">
        <Tabs
          items={tabs}
          value={activeTab}
          onChange={(val) => setActiveTab(val)}
        />
      </div>

      {/* Notifications Feed */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center p-16 space-y-3 bg-slate-900 border border-slate-800 rounded-2xl">
            <Spinner size="lg" className="text-brand-500" />
            <span className="text-text-muted text-sm">
              Loading notifications...
            </span>
          </div>
        ) : error ? (
          <div className="p-8 text-center text-danger bg-slate-900 border border-slate-800 rounded-2xl">
            Error loading notifications. Please try again.
          </div>
        ) : !notifications || notifications.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl">
            <EmptyState
              title={isUnreadOnly ? 'All caught up!' : 'No notifications yet'}
              description={
                isUnreadOnly
                  ? 'You have no unread reminders or alerts.'
                  : "We'll notify you here when you have medical updates or reminders."
              }
              icon={<Bell className="h-6 w-6" />}
            />
          </div>
        ) : (
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            animate="visible"
            className="space-y-3"
          >
            <AnimatePresence mode="popLayout">
              {notifications.map((item) => {
                const config = getNotificationIcon(item.title);
                const IconComponent = config.icon;
                const hasVerifyStrip = isDoseReminder(item);
                const actionUrl =
                  typeof item.metadata?.actionUrl === 'string'
                    ? item.metadata.actionUrl
                    : null;

                return (
                  <motion.div
                    key={item.id}
                    variants={slideInRight}
                    layout
                    className={cn(
                      'flex items-start gap-4 p-4 rounded-2xl border transition-all duration-200',
                      item.isRead
                        ? 'bg-slate-900/40 border-slate-850 hover:bg-slate-900'
                        : 'bg-slate-900 border-slate-800 shadow-lg hover:border-slate-700/80',
                    )}
                  >
                    <div
                      className={cn(
                        'rounded-xl p-2.5 shrink-0',
                        config.bgClass,
                      )}
                    >
                      <IconComponent className="h-5 w-5" />
                    </div>

                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <h4
                          className={cn(
                            'text-sm font-semibold truncate',
                            item.isRead
                              ? 'text-text-secondary'
                              : 'text-text-primary',
                          )}
                        >
                          {item.title}
                        </h4>
                        <span className="text-[11px] text-text-muted whitespace-nowrap">
                          {item.createdAt
                            ? format(parseISO(item.createdAt), 'MMM dd, h:mm a')
                            : ''}
                        </span>
                      </div>
                      <p
                        className={cn(
                          'text-xs leading-relaxed break-words',
                          item.isRead
                            ? 'text-text-muted'
                            : 'text-text-secondary',
                        )}
                      >
                        {item.message || item.body}
                      </p>

                      {/* 📸 In-Notification Verify Strip Action */}
                      {hasVerifyStrip && (
                        <div className="mt-3 flex flex-wrap items-center gap-2.5 pt-2.5 border-t border-slate-800/80">
                          <button
                            type="button"
                            onClick={() => handleOpenVerifyStrip(item)}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-md shadow-emerald-900/40 hover:brightness-110 active:scale-95 transition-all"
                            title="Verify physical blister strip using OCR camera before swallowing"
                          >
                            <Scan className="h-3.5 w-3.5" />
                            <span>Verify Strip</span>
                          </button>

                          <button
                            type="button"
                            onClick={() => navigate(ROUTES.DOSE_LOGS)}
                            className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-white transition-colors"
                          >
                            <span>Dose Timeline</span>
                            <ArrowRight className="h-3 w-3" />
                          </button>
                        </div>
                      )}

                      {actionUrl && !hasVerifyStrip && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="mt-2 px-0 text-brand-400"
                          onClick={() => {
                            if (!item.isRead) markReadMutation.mutate(item.id);
                            navigate(actionUrl);
                          }}
                        >
                          Review details
                        </Button>
                      )}
                    </div>

                    {!item.isRead && (
                      <button
                        type="button"
                        onClick={() => markReadMutation.mutate(item.id)}
                        disabled={markReadMutation.isPending}
                        title="Mark as read"
                        className="rounded-lg p-1 text-text-muted hover:bg-surface-hover hover:text-brand-500 transition-colors cursor-pointer self-center"
                      >
                        <Check className="h-4 w-4" />
                      </button>
                    )}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* Point-of-Care Blister Strip Verification Modal */}
      <StripVerificationModal
        dose={verifyDose}
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        onVerifiedTaken={handleVerifiedTaken}
      />
    </div>
  );
}
