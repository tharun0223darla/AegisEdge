import React, { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useTheme } from '@/providers/ThemeProvider';
import { authService } from '@/services/auth.service';
import { voiceService } from '@/services/voice.service';
import {
  useSendEmailNotificationTest,
  useSendPhoneNotificationTest,
} from '@/hooks/useNotifications';
import {
  notificationsService,
  type UpdateNotificationPreferences,
} from '@/services/notifications.service';
import { deviceRemindersService } from '@/services/device-reminders.service';
import {
  healthConnectService,
  type HealthConnectMetricType,
  type HealthConnectSyncResult,
  type HealthConnectStatus,
} from '@/services/health-connect.service';
import { useAddVital } from '@/hooks/useVitals';
import {
  openExactAlarmSettings,
  scheduleLocalReminderTest,
  syncLocalDoseReminders,
} from '@/lib/local-reminders';
import { http } from '@/lib/api-client';
import { PageHeader } from '@/components/shared/PageHeader';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { notify } from '@/components/ui/Toast';
import { storage } from '@/lib/storage';
import { AccountModeSwitcher } from '@/components/account/AccountModeSwitcher';
import { isSwitchableAccountRole } from '@/lib/role-navigation';
import { useUser } from '@/store/auth.store';
import {
  Settings,
  Moon,
  Sun,
  BellRing,
  Sparkles,
  KeyRound,
  ShieldAlert,
  MessageSquareText,
  BellPlus,
  AlarmClock,
  HeartPulse,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';

const HEALTH_CONNECT_SYNC_KEY = 'meditrack_health_connect_sync_enabled';
const HEALTH_CONNECT_LAST_SYNC_KEY = 'meditrack_health_connect_last_sync';
const HEALTH_CONNECT_METRIC_LABELS: Record<HealthConnectMetricType, string> = {
  HEART_RATE: 'Heart rate',
  OXYGEN_SATURATION: 'Oxygen saturation',
  BLOOD_PRESSURE: 'Blood pressure',
  BLOOD_GLUCOSE: 'Blood glucose',
};

export default function SettingsPage() {
  const currentUser = useUser();
  const isPatient = currentUser?.role === 'PATIENT';
  const { theme, toggleTheme } = useTheme();
  const sendPhoneTest = useSendPhoneNotificationTest();
  const sendEmailTest = useSendEmailNotificationTest();
  const addVital = useAddVital();

  const { data: userProfile } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => authService.me(),
    staleTime: 0,
  });
  const {
    data: notificationPreferences,
    isLoading: isNotificationPreferencesLoading,
    refetch: refetchNotificationPreferences,
  } = useQuery({
    queryKey: ['notifications', 'preferences'],
    queryFn: () => notificationsService.preferences(),
    staleTime: 30_000,
  });
  const updateEmailPreferences = useMutation({
    mutationFn: (input: UpdateNotificationPreferences) =>
      notificationsService.updatePreferences(input),
    onSuccess: () => refetchNotificationPreferences(),
  });
  const {
    data: aiStatus,
    isLoading: isAiStatusLoading,
    isFetching: isAiStatusFetching,
    isError: isAiStatusError,
    refetch: refetchAiStatus,
  } = useQuery({
    queryKey: ['ai-voice', 'status'],
    queryFn: () => voiceService.getStatus(),
    enabled: isPatient,
    staleTime: 30_000,
    retry: 1,
  });

  // Local storage keys for preferences
  const PREFS_KEY = 'meditrack_notif_prefs';

  // Notification States
  const emailAlerts = notificationPreferences?.emailEnabled ?? false;
  const [smsAlerts, setSmsAlerts] = useState(
    () => storage.get<boolean>(`${PREFS_KEY}_sms`) ?? false,
  );
  const [pushAlerts, setPushAlerts] = useState(
    () => storage.get<boolean>(`${PREFS_KEY}_push`) ?? true,
  );
  const [isSyncingLocalReminders, setIsSyncingLocalReminders] = useState(false);
  const [isTestingLocalReminder, setIsTestingLocalReminder] = useState(false);
  const healthConnectSupported = healthConnectService.isSupported();
  const [healthConnectEnabled, setHealthConnectEnabled] = useState(
    () => storage.get<boolean>(HEALTH_CONNECT_SYNC_KEY) ?? false,
  );
  const [healthConnectStatus, setHealthConnectStatus] =
    useState<HealthConnectStatus | null>(null);
  const [isConnectingHealth, setIsConnectingHealth] = useState(false);
  const [isSyncingHealth, setIsSyncingHealth] = useState(false);
  const [lastHealthConnectSync, setLastHealthConnectSync] =
    useState<HealthConnectSyncResult | null>(() =>
      storage.get<HealthConnectSyncResult>(HEALTH_CONNECT_LAST_SYNC_KEY),
    );
  const [manualHeartRate, setManualHeartRate] = useState('');
  const [manualHeartRateContext, setManualHeartRateContext] = useState<
    'RESTING' | 'ACTIVE' | 'SLEEPING' | 'UNKNOWN'
  >('RESTING');

  // Password States
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  // Handle Preferences Save
  const handleLocalTogglePreference = (
    type: 'sms' | 'push',
    value: boolean,
  ) => {
    storage.set(`${PREFS_KEY}_${type}`, value);
    if (type === 'sms') setSmsAlerts(value);
    if (type === 'push') setPushAlerts(value);
    notify.success('Preferences updated locally!');
  };

  const handleEmailPreferenceChange = async (
    input: UpdateNotificationPreferences,
  ) => {
    try {
      await updateEmailPreferences.mutateAsync(input);
      notify.success('Email preferences saved');
    } catch (error: any) {
      notify.error(
        error?.response?.data?.message || 'Unable to save email preferences',
      );
    }
  };

  // Handle Password Update
  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentPassword || !newPassword || !confirmPassword) {
      notify.error('All password fields are required');
      return;
    }

    if (newPassword !== confirmPassword) {
      notify.error('New passwords do not match');
      return;
    }

    if (newPassword.length < 8) {
      notify.error('New password must be at least 8 characters long');
      return;
    }

    setIsUpdatingPassword(true);
    try {
      await http.post('/auth/change-password', {
        currentPassword,
        newPassword,
      });
      notify.success('Password updated successfully!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      notify.error(
        err.response?.data?.message ||
          'Failed to update password. Verify current password.',
      );
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  const isAiConfigured = aiStatus?.configured ?? false;
  const aiStatusLabel = isAiStatusLoading
    ? 'CHECKING'
    : isAiStatusError
      ? 'STATUS UNKNOWN'
      : isAiConfigured
        ? 'CONFIGURED'
        : 'UNAVAILABLE';
  const aiStatusTone = isAiStatusLoading
    ? 'bg-slate-800 text-text-muted ring-1 ring-inset ring-slate-700'
    : isAiStatusError
      ? 'bg-warning-soft text-warning ring-1 ring-inset ring-warning/20'
      : isAiConfigured
        ? 'bg-success-soft text-success ring-1 ring-inset ring-success/20'
        : 'bg-danger-soft text-danger ring-1 ring-inset ring-danger/20';
  const aiStatusDot = isAiStatusLoading
    ? 'bg-text-muted'
    : isAiStatusError
      ? 'bg-warning'
      : isAiConfigured
        ? 'bg-success'
        : 'bg-danger';
  const registeredPhone = userProfile?.phone;
  const smsTestUnavailableReason = registeredPhone
    ? null
    : 'No account phone number is registered yet. SMS reminders use the phone saved on your login account.';

  useEffect(() => {
    if (!isPatient || !healthConnectSupported) return;
    healthConnectService
      .getStatus()
      .then(setHealthConnectStatus)
      .catch(() => setHealthConnectStatus(null));
  }, [healthConnectSupported, isPatient]);

  const hasAnyHealthPermission = healthConnectStatus
    ? Object.values(healthConnectStatus.permissions).some(Boolean)
    : false;

  const handleHealthConnectToggle = async (enabled: boolean) => {
    if (!enabled) {
      storage.set(HEALTH_CONNECT_SYNC_KEY, false);
      setHealthConnectEnabled(false);
      notify.message('Health Connect sync paused on this device.');
      return;
    }

    setIsConnectingHealth(true);
    try {
      const status = await healthConnectService.requestReadPermissions();
      const granted = Object.values(status.permissions).some(Boolean);
      setHealthConnectStatus(status);
      storage.set(HEALTH_CONNECT_SYNC_KEY, granted);
      setHealthConnectEnabled(granted);
      if (granted) {
        notify.success(
          status.allGranted
            ? 'Health Connect connected.'
            : 'Health Connect connected with limited access.',
        );
      } else {
        notify.error('No Health Connect read access was granted.');
      }
    } catch (error: any) {
      notify.error(error?.message || 'Unable to connect Health Connect.');
    } finally {
      setIsConnectingHealth(false);
    }
  };

  const handleHealthConnectSync = async () => {
    setIsSyncingHealth(true);
    try {
      const result = await healthConnectService.sync(168);
      setLastHealthConnectSync(result);
      storage.set(HEALTH_CONNECT_LAST_SYNC_KEY, result);
      if (result.read === 0) {
        if (result.deniedTypes.length > 0) {
          notify.message(
            `No approved readings were found in Health Connect for the last 7 days. Additional access is not granted for: ${result.deniedTypes.join(', ').toLowerCase().replace(/_/g, ' ')}.`,
          );
        } else {
          notify.message(
            'No supported readings were found in Health Connect for the last 7 days. Check that your watch or health app writes data to Health Connect.',
          );
        }
        return;
      }
      notify.success(
        `Health sync complete: ${result.read} read, ${result.imported} new, ${result.duplicates} already synced.`,
      );
      if (result.rejected > 0)
        notify.error(
          `${result.rejected} invalid reading${result.rejected === 1 ? '' : 's'} were not imported.`,
        );
      if (result.truncated)
        notify.message(
          'The device returned many records. Sync again to continue safely.',
        );
    } catch (error: any) {
      notify.error(error?.message || 'Unable to sync Health Connect data.');
      const status = await healthConnectService.getStatus().catch(() => null);
      if (status) setHealthConnectStatus(status);
    } finally {
      setIsSyncingHealth(false);
    }
  };

  const handleManualHeartRateSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const heartRate = Number(manualHeartRate);
    if (!Number.isFinite(heartRate) || heartRate < 20 || heartRate > 300) {
      notify.error('Enter a heart rate between 20 and 300 bpm.');
      return;
    }

    try {
      await addVital.mutateAsync({
        metricType: 'HEART_RATE',
        value: { heartRate, context: manualHeartRateContext },
        recordedAt: new Date().toISOString(),
        unit: 'bpm',
        timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      });
      setManualHeartRate('');
      notify.success('Heart-rate reading saved as user reported.');
    } catch (error: any) {
      notify.error(error?.message || 'Unable to save the heart-rate reading.');
    }
  };

  const handleOpenHealthConnectSettings = async () => {
    try {
      await healthConnectService.openSettings();
    } catch {
      notify.error('Unable to open Health Connect settings.');
    }
  };

  const handleSyncLocalReminders = async () => {
    setIsSyncingLocalReminders(true);
    try {
      const plan = await deviceRemindersService.getPlan(14);
      const result = await syncLocalDoseReminders(plan);

      if (result.mode === 'denied') {
        notify.error(
          result.warning || 'Notification permission was not granted.',
        );
        return;
      }

      if (result.mode === 'unsupported') {
        notify.message(
          result.warning || 'This device does not support local reminders yet.',
        );
        return;
      }

      const modeLabel = result.mode === 'native' ? 'device' : 'browser preview';
      notify.success(
        `Synced ${result.scheduledCount} ${modeLabel} reminder${result.scheduledCount === 1 ? '' : 's'}.`,
      );
      if (result.warning) notify.message(result.warning);
    } catch (err: any) {
      notify.error(
        err.response?.data?.message || 'Unable to sync device reminders',
      );
    } finally {
      setIsSyncingLocalReminders(false);
    }
  };

  const handleTestLocalReminder = async () => {
    setIsTestingLocalReminder(true);
    try {
      const result = await scheduleLocalReminderTest(10);
      if (result.mode === 'denied') {
        notify.error(
          result.warning || 'Notification permission was not granted.',
        );
        return;
      }
      if (result.mode === 'unsupported') {
        notify.error(
          result.warning || 'Local reminders are unavailable on this device.',
        );
        return;
      }
      notify.success(
        'Test reminder scheduled for 10 seconds from now. You can close the app.',
      );
      if (result.warning) notify.message(result.warning);
    } catch (error: any) {
      notify.error(error?.message || 'Unable to schedule the test reminder.');
    } finally {
      setIsTestingLocalReminder(false);
    }
  };

  const handleOpenExactAlarmSettings = async () => {
    try {
      const granted = await openExactAlarmSettings();
      if (granted) notify.success('Exact reminder timing is enabled.');
    } catch {
      notify.error('Unable to open exact-alarm settings on this device.');
    }
  };

  const handleSendPhoneTest = async () => {
    if (!registeredPhone) {
      notify.error('Add a registered phone number before testing SMS alerts.');
      return;
    }

    try {
      const result = await sendPhoneTest.mutateAsync();
      const delivery = result.delivery;
      if (delivery?.status === 'SENT') {
        notify.success(
          `Test SMS sent to ${delivery.recipientMasked ?? 'your registered number'}`,
        );
      } else if (delivery?.status === 'SKIPPED') {
        notify.message(
          delivery.reason || 'Phone notifications are not enabled yet.',
        );
      } else {
        notify.error(
          delivery?.error ||
            'Phone notification failed. Check backend provider settings.',
        );
      }
    } catch (err: any) {
      notify.error(err.response?.data?.message || 'Unable to send test SMS');
    }
  };

  const handleSendEmailTest = async () => {
    try {
      const result = await sendEmailTest.mutateAsync();
      const delivery = result.delivery;
      if (delivery?.status === 'SENT') {
        notify.success(
          `Test email accepted for ${delivery.recipientMasked ?? 'your verified email'}`,
        );
      } else if (delivery?.status === 'SKIPPED') {
        notify.message(
          delivery.reason || 'Enable email notifications before testing.',
        );
      } else {
        notify.error(
          delivery?.lastErrorCode ||
            'Email delivery failed. The backend will retry transient failures.',
        );
      }
    } catch (error: any) {
      notify.error(
        error?.response?.data?.message || 'Unable to send the test email',
      );
    }
  };

  const healthIntegrationLabel = !hasAnyHealthPermission
    ? 'Not connected'
    : !lastHealthConnectSync
      ? 'Access approved'
      : lastHealthConnectSync.integrationState === 'HEALTH_CONNECT_AVAILABLE'
        ? 'Records available'
        : lastHealthConnectSync.integrationState === 'HEALTH_CONNECT_NO_RECORDS'
          ? 'No records'
          : 'Manual entry required';

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-12">
      <PageHeader
        title="Settings"
        description="Configure account preferences, styling theme, alerts, and security options."
      />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        {/* Navigation Sidebar for settings sections */}
        <div className="space-y-1">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-4 space-y-1 shadow-md">
            <button className="flex w-full items-center gap-3 rounded-xl bg-slate-950/60 border border-slate-850 px-3.5 py-2.5 text-sm font-semibold text-brand-400">
              <Settings className="h-4.5 w-4.5" />
              General Preferences
            </button>
          </div>
        </div>

        {/* Settings options panel */}
        <div className="md:col-span-2 space-y-6">
          {isSwitchableAccountRole(currentUser?.role) && (
            <Card className="space-y-4 border-slate-800 bg-slate-900 p-6 shadow-xl">
              <div>
                <h2 className="text-base font-semibold text-text-primary">
                  Account mode
                </h2>
                <p className="mt-1 text-sm text-text-muted">
                  Choose whether you are managing your own medicines or viewing
                  information a patient shared with you.
                </p>
              </div>
              <AccountModeSwitcher />
            </Card>
          )}

          {isPatient && (
            <>
              {/* Patient companion provider status */}
              <Card className="p-6 bg-slate-900 border-slate-800 shadow-xl space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                  <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
                    <Sparkles className="h-4.5 w-4.5 text-brand-500 animate-pulse" />
                    Patient Companion AI
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${aiStatusTone}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${aiStatusDot}`}
                    />
                    {aiStatusLabel}
                  </span>
                </div>

                {isAiStatusLoading ? (
                  <p className="text-xs text-text-secondary">
                    Checking the secured backend provider configuration...
                  </p>
                ) : isAiStatusError ? (
                  <div className="space-y-3 rounded-xl border border-warning/15 bg-warning-soft/20 p-3">
                    <div className="flex gap-2">
                      <ShieldAlert className="mt-0.5 h-4.5 w-4.5 shrink-0 text-warning" />
                      <p className="text-xs leading-relaxed text-text-secondary">
                        <strong className="mb-1 block text-text-primary">
                          Provider status could not be checked
                        </strong>
                        The backend may be waking up or deploying. This does not
                        mean the Groq key is missing. The companion remains in
                        safe fallback mode until the status endpoint responds.
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void refetchAiStatus()}
                      isLoading={isAiStatusFetching}
                      leftIcon={<RefreshCw className="h-4 w-4" />}
                    >
                      Check again
                    </Button>
                  </div>
                ) : isAiConfigured ? (
                  <div className="space-y-2">
                    <p className="text-xs text-text-secondary leading-relaxed">
                      The patient companion is configured to use{' '}
                      <strong className="text-text-primary">
                        {aiStatus?.preferredProvider ?? 'a secured provider'}
                      </strong>
                      . Provider configuration does not replace clinical review
                      or emergency services.
                    </p>
                    <ul className="text-xs text-text-muted list-disc list-inside space-y-1 pl-1">
                      <li>
                        Model: {aiStatus?.activeModel ?? 'configured by server'}
                      </li>
                      <li>
                        Deterministic emergency checks run before AI generation
                      </li>
                      <li>No diagnosis or medication changes are permitted</li>
                    </ul>
                  </div>
                ) : (
                  <div className="space-y-3 p-3 bg-danger-soft/30 rounded-xl border border-danger/10">
                    <div className="flex gap-2">
                      <ShieldAlert className="h-4.5 w-4.5 text-danger shrink-0 mt-0.5" />
                      <p className="text-xs text-text-secondary leading-relaxed">
                        <strong className="text-text-primary block mb-1">
                          No AI provider configured
                        </strong>
                        Configure Groq on the backend for cloud use or Ollama
                        for local development. The companion will remain in safe
                        fallback mode until a provider is available.
                      </p>
                    </div>
                  </div>
                )}
              </Card>

              {healthConnectSupported && (
                <Card className="p-6 bg-slate-900 border-slate-800 shadow-xl space-y-5">
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
                      <HeartPulse className="h-4.5 w-4.5 text-rose-400" />
                      Health Connect
                    </h3>
                    <span
                      className={`text-xs font-semibold ${lastHealthConnectSync?.integrationState === 'HEALTH_CONNECT_NO_RECORDS' ? 'text-warning' : hasAnyHealthPermission ? 'text-success' : 'text-text-muted'}`}
                    >
                      {healthConnectStatus?.availability === 'UPDATE_REQUIRED'
                        ? 'Update required'
                        : healthIntegrationLabel}
                    </span>
                  </div>

                  <div className="flex items-center justify-between gap-4 border-t border-slate-850 pt-4">
                    <div>
                      <h4 className="text-sm font-medium text-text-primary">
                        Sync approved health readings
                      </h4>
                      <p className="text-xs text-text-muted">
                        Read-only access. MediTrack imports data only when you
                        tap Sync now.
                      </p>
                    </div>
                    <Switch
                      checked={healthConnectEnabled && hasAnyHealthPermission}
                      onChange={(event) =>
                        void handleHealthConnectToggle(event.target.checked)
                      }
                      disabled={
                        isConnectingHealth ||
                        healthConnectStatus?.availability !== 'AVAILABLE'
                      }
                    />
                  </div>

                  <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                    Imported readings support personal tracking. They are not
                    emergency monitoring or a diagnosis.
                  </div>

                  {lastHealthConnectSync?.integrationState ===
                    'HEALTH_CONNECT_NO_RECORDS' && (
                    <div
                      className="rounded-lg border border-rose-500/25 bg-rose-500/10 px-3 py-3 text-xs leading-5 text-rose-100"
                      role="status"
                    >
                      <strong className="block text-text-primary">
                        Automatic watch import unavailable
                      </strong>
                      Health Connect returned zero approved records. A connected
                      watch app can display readings without publishing them to
                      Health Connect. Complete Health Connect setup in the
                      source app, take a fresh reading, sync that app, and try
                      again.
                    </div>
                  )}

                  {lastHealthConnectSync &&
                    lastHealthConnectSync.metricDiagnostics?.length > 0 && (
                      <div className="space-y-2 border-t border-slate-800 pt-4">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-medium text-text-primary">
                            Last sync
                          </span>
                          <span className="text-text-muted">
                            {lastHealthConnectSync.read} read ·{' '}
                            {lastHealthConnectSync.imported} imported ·{' '}
                            {lastHealthConnectSync.duplicates} already synced
                          </span>
                        </div>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {lastHealthConnectSync.metricDiagnostics.map(
                            (metric) => {
                              const status = !metric.permissionGranted
                                ? 'Access off'
                                : metric.errorCode
                                  ? 'Read failed'
                                  : metric.truncated
                                    ? `${metric.outputRecordCount} read · partial`
                                    : metric.outputRecordCount > 0
                                      ? `${metric.outputRecordCount} read`
                                      : 'No records';
                              return (
                                <div
                                  key={metric.metricType}
                                  className="flex items-center justify-between gap-3 rounded-md bg-bg-inset px-3 py-2 text-xs"
                                >
                                  <span className="text-text-secondary">
                                    {
                                      HEALTH_CONNECT_METRIC_LABELS[
                                        metric.metricType
                                      ]
                                    }
                                  </span>
                                  <span
                                    className={
                                      metric.errorCode || metric.truncated
                                        ? 'text-warning'
                                        : 'text-text-muted'
                                    }
                                  >
                                    {status}
                                  </span>
                                </div>
                              );
                            },
                          )}
                        </div>
                      </div>
                    )}

                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleHealthConnectSync}
                      isLoading={isSyncingHealth}
                      disabled={
                        !healthConnectEnabled ||
                        !hasAnyHealthPermission ||
                        isSyncingHealth ||
                        isConnectingHealth
                      }
                      leftIcon={<RefreshCw className="h-4 w-4" />}
                    >
                      Sync now
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleOpenHealthConnectSettings}
                      leftIcon={<ExternalLink className="h-4 w-4" />}
                    >
                      Manage access
                    </Button>
                  </div>

                  {healthConnectStatus?.build && (
                    <p className="text-[11px] text-text-muted">
                      App {healthConnectStatus.build.versionName} (
                      {healthConnectStatus.build.versionCode}) ·{' '}
                      {healthConnectStatus.build.commitSha}
                      {healthConnectStatus.build.dirty
                        ? ' · local changes present'
                        : ''}
                    </p>
                  )}
                </Card>
              )}

              <Card className="p-6 bg-slate-900 border-slate-800 shadow-xl space-y-5">
                <div>
                  <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
                    <HeartPulse className="h-4.5 w-4.5 text-rose-400" />
                    Manual heart-rate reading
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-text-muted">
                    Use a value you measured on a watch, pulse oximeter, or
                    other device. It is stored as user reported, not as verified
                    wearable telemetry.
                  </p>
                </div>

                <form
                  onSubmit={handleManualHeartRateSubmit}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
                >
                  <Input
                    label="Heart rate (bpm)"
                    type="number"
                    inputMode="numeric"
                    min={20}
                    max={300}
                    step={1}
                    value={manualHeartRate}
                    onChange={(event) => setManualHeartRate(event.target.value)}
                    placeholder="e.g. 72"
                    required
                  />
                  <div>
                    <label
                      htmlFor="manual-heart-rate-context"
                      className="mb-1.5 block text-sm font-medium text-text-primary"
                    >
                      Measurement context
                    </label>
                    <select
                      id="manual-heart-rate-context"
                      value={manualHeartRateContext}
                      onChange={(event) =>
                        setManualHeartRateContext(
                          event.target.value as typeof manualHeartRateContext,
                        )
                      }
                      className="h-10 w-full rounded-xl border border-border bg-bg-inset px-3.5 text-sm text-text-primary focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/40"
                    >
                      <option value="RESTING">Resting</option>
                      <option value="ACTIVE">Active</option>
                      <option value="SLEEPING">Sleeping</option>
                      <option value="UNKNOWN">Not sure</option>
                    </select>
                  </div>
                  <Button type="submit" isLoading={addVital.isPending}>
                    Save reading
                  </Button>
                </form>
              </Card>
            </>
          )}

          {/* Theme card */}
          <Card className="p-6 bg-slate-900 border-slate-800 shadow-xl space-y-6">
            <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
              {theme === 'dark' ? (
                <Moon className="h-4.5 w-4.5 text-indigo-400" />
              ) : (
                <Sun className="h-4.5 w-4.5 text-amber-500" />
              )}
              Appearance Theme
            </h3>

            <div className="flex items-center justify-between">
              <div>
                <h4 className="text-sm font-medium text-text-primary">
                  Theme Toggle
                </h4>
                <p className="text-xs text-text-muted">
                  Switch between dark mode and light mode interfaces.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={toggleTheme}
                className="border-slate-800 hover:bg-slate-950/60 font-semibold"
              >
                {theme === 'dark' ? 'Switch to Light' : 'Switch to Dark'}
              </Button>
            </div>
          </Card>

          {/* Notifications config */}
          <Card className="p-6 bg-slate-900 border-slate-800 shadow-xl space-y-5">
            <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
              <BellRing className="h-4.5 w-4.5 text-brand-500" />
              Notification Channels
            </h3>

            <div className="space-y-4">
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-text-primary">
                      Email Notifications
                    </h4>
                    <p className="text-xs text-text-muted">
                      Send selected alerts to your verified account email.
                    </p>
                  </div>
                  <Switch
                    checked={emailAlerts}
                    disabled={
                      isNotificationPreferencesLoading ||
                      updateEmailPreferences.isPending
                    }
                    onChange={(event) =>
                      void handleEmailPreferenceChange({
                        emailEnabled: event.target.checked,
                      })
                    }
                  />
                </div>
                <div className="space-y-3 border-l-2 border-slate-800 pl-4">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-text-secondary">
                      Missed-dose and caregiver alerts
                    </span>
                    <Switch
                      checked={
                        notificationPreferences?.missedDoseEmails ?? false
                      }
                      disabled={
                        !emailAlerts || updateEmailPreferences.isPending
                      }
                      onChange={(event) =>
                        void handleEmailPreferenceChange({
                          missedDoseEmails: event.target.checked,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-xs text-text-secondary">
                      Low-stock and refill alerts
                    </span>
                    <Switch
                      checked={notificationPreferences?.refillEmails ?? false}
                      disabled={
                        !emailAlerts || updateEmailPreferences.isPending
                      }
                      onChange={(event) =>
                        void handleEmailPreferenceChange({
                          refillEmails: event.target.checked,
                        })
                      }
                    />
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <span className="text-xs text-text-secondary">
                        Include medicine names
                      </span>
                      <p className="mt-1 text-xs text-warning">
                        Email previews may be visible on a shared device.
                      </p>
                    </div>
                    <Switch
                      checked={
                        notificationPreferences?.includeMedicineNames ?? false
                      }
                      disabled={
                        !emailAlerts || updateEmailPreferences.isPending
                      }
                      onChange={(event) =>
                        void handleEmailPreferenceChange({
                          includeMedicineNames: event.target.checked,
                        })
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSendEmailTest}
                    isLoading={sendEmailTest.isPending}
                    disabled={!emailAlerts || sendEmailTest.isPending}
                  >
                    Send test email
                  </Button>
                </div>
              </div>
              <div className="border-t border-slate-850 pt-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-text-primary">
                      Local Device Reminders
                    </h4>
                    <p className="text-xs text-text-muted">
                      Schedule upcoming medicine alarms on this device. Native
                      app reminders can work offline.
                    </p>
                  </div>
                  <Switch
                    checked={pushAlerts}
                    onChange={(e) =>
                      handleLocalTogglePreference('push', e.target.checked)
                    }
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleSyncLocalReminders}
                    isLoading={isSyncingLocalReminders}
                    disabled={
                      !pushAlerts ||
                      isSyncingLocalReminders ||
                      isTestingLocalReminder
                    }
                    leftIcon={<BellPlus className="h-4 w-4" />}
                    title="Load the next 14 days of medicine reminders onto this device"
                  >
                    Sync reminders
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleTestLocalReminder}
                    isLoading={isTestingLocalReminder}
                    disabled={
                      !pushAlerts ||
                      isTestingLocalReminder ||
                      isSyncingLocalReminders
                    }
                    leftIcon={<AlarmClock className="h-4 w-4" />}
                  >
                    Test in 10 seconds
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleOpenExactAlarmSettings}
                  >
                    Exact timing settings
                  </Button>
                </div>
              </div>

              <div className="border-t border-slate-850 pt-4 space-y-3">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <h4 className="text-sm font-medium text-text-primary">
                      SMS Alerts
                    </h4>
                    <p className="text-xs text-text-muted">
                      Send medicine reminders to your registered number
                      {registeredPhone ? ` (${registeredPhone})` : ''}.
                    </p>
                  </div>
                  <Switch
                    checked={smsAlerts}
                    onChange={(e) =>
                      handleLocalTogglePreference('sms', e.target.checked)
                    }
                  />
                </div>
                {smsTestUnavailableReason && (
                  <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-100">
                    {smsTestUnavailableReason}
                  </div>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSendPhoneTest}
                  isLoading={sendPhoneTest.isPending}
                  disabled={sendPhoneTest.isPending}
                  leftIcon={<MessageSquareText className="h-4 w-4" />}
                  title={
                    registeredPhone
                      ? 'Send a test SMS to your registered number'
                      : 'Add a registered phone number before testing SMS alerts'
                  }
                >
                  Send Test SMS
                </Button>
              </div>
            </div>
          </Card>

          {/* Security Card */}
          <Card className="p-6 bg-slate-900 border-slate-800 shadow-xl space-y-5">
            <h3 className="text-base font-semibold text-text-primary flex items-center gap-2">
              <KeyRound className="h-4.5 w-4.5 text-indigo-400" />
              Account Security
            </h3>

            <form onSubmit={handlePasswordSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                  Current Password
                </label>
                <Input
                  type="password"
                  placeholder="Enter current password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                    New Password
                  </label>
                  <Input
                    type="password"
                    placeholder="Min 8 characters"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2">
                    Confirm New Password
                  </label>
                  <Input
                    type="password"
                    placeholder="Repeat new password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <Button
                  type="submit"
                  disabled={isUpdatingPassword}
                  className="bg-gradient-brand text-text-inverse hover:shadow-glow font-semibold transition-all"
                >
                  {isUpdatingPassword ? 'Updating...' : 'Update Password'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      </div>
    </div>
  );
}
