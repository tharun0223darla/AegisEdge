import { Capacitor } from '@capacitor/core';
import {
  LocalNotifications,
  type LocalNotificationSchema,
} from '@capacitor/local-notifications';
import { deviceRemindersService } from '@/services/device-reminders.service';
import { submitDoseAction } from '@/lib/dose-action-queue';
import { useAuthStore } from '@/store/auth.store';
import type {
  LocalReminderSyncResult,
  MobileReminderItem,
  MobileReminderPlan,
} from '@/types/mobile-reminder';

const browserTimers = new Map<number, number>();
const MAX_TIMER_DELAY_MS = 1000 * 60 * 60 * 24 * 30;
const DOSE_REMINDER_CHANNEL_ID = 'dose-reminders';
const DOSE_ACTION_TYPE_ID = 'meditrack-dose-actions';
const NATIVE_REMINDER_IDS_KEY = 'meditrack-native-reminder-ids';
export const FOREGROUND_DOSE_REMINDER_EVENT =
  'meditrack:foreground-dose-reminder';

export interface ForegroundDoseReminder {
  id: number;
  title: string;
  body: string;
  actionUrl: string | null;
  scheduledAt: string | null;
}

let nativeTapHandlerRegistered = false;
let currentDeviceSync: Promise<LocalReminderSyncResult> | null = null;
let nativeScheduleQueue: Promise<void> = Promise.resolve();

export async function registerLocalReminderTapHandler() {
  if (!isNativeLocalNotificationAvailable() || nativeTapHandlerRegistered)
    return;

  nativeTapHandlerRegistered = true;
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: DOSE_ACTION_TYPE_ID,
        actions: [
          { id: 'TAKEN', title: 'Taken' },
          { id: 'SNOOZE_10', title: 'Snooze 10 min' },
          { id: 'OPEN', title: 'Open' },
        ],
      },
    ],
  });
  await LocalNotifications.addListener(
    'localNotificationActionPerformed',
    async (event) => {
      try {
        if (event.actionId === 'TAKEN' || event.actionId === 'SNOOZE_10') {
          const extra = getDoseActionExtra(event.notification);
          const userId = await waitForAuthenticatedUserId();
          if (extra && userId) {
            const snoozeUntil =
              event.actionId === 'SNOOZE_10'
                ? new Date(Date.now() + 10 * 60 * 1000)
                : null;
            await submitDoseAction(userId, {
              scheduleId: extra.scheduleId,
              scheduledAt: extra.scheduledAt,
              status: snoozeUntil ? 'SNOOZED' : 'TAKEN',
              source: 'DEVICE_NOTIFICATION',
              snoozeUntil: snoozeUntil?.toISOString(),
              clientActionId: nativeActionId(
                extra.doseLogId,
                event.actionId,
                extra.actionRevision,
              ),
            });
            if (extra.relatedNotificationIds.length > 0) {
              await LocalNotifications.cancel({
                notifications: extra.relatedNotificationIds.map((id) => ({
                  id,
                })),
              });
            }
            if (snoozeUntil) {
              await scheduleNativeSnooze(
                event.notification,
                snoozeUntil,
                extra.actionRevision + 1,
              );
            } else {
              void syncCurrentDeviceDoseReminders(14, true).catch(
                () => undefined,
              );
            }
            return;
          }
        }
      } catch {
        console.warn('Dose notification action could not be recorded.');
      }
      const actionUrl = getActionUrl(event.notification);
      if (!actionUrl) return;
      window.location.assign(actionUrl);
    },
  );

  await LocalNotifications.addListener(
    'localNotificationReceived',
    (notification) => {
      const extra = notification.extra as { scheduledAt?: unknown } | undefined;
      window.dispatchEvent(
        new CustomEvent<ForegroundDoseReminder>(
          FOREGROUND_DOSE_REMINDER_EVENT,
          {
            detail: {
              id: notification.id,
              title: notification.title ?? 'Medicine reminder',
              body:
                notification.body ?? 'It is time for your scheduled medicine.',
              actionUrl: getActionUrl(notification),
              scheduledAt:
                typeof extra?.scheduledAt === 'string'
                  ? extra.scheduledAt
                  : null,
            },
          },
        ),
      );
    },
  );
}

export async function syncCurrentDeviceDoseReminders(
  days = 14,
  forceFresh = false,
): Promise<LocalReminderSyncResult> {
  if (currentDeviceSync) {
    if (!forceFresh) return currentDeviceSync;
    try {
      await currentDeviceSync;
    } catch {
      // A forced post-mutation sync still gets a fresh attempt.
    }
  }

  const request = deviceRemindersService
    .getPlan(days)
    .then((plan) => syncLocalDoseReminders(plan));
  currentDeviceSync = request;

  try {
    return await request;
  } finally {
    if (currentDeviceSync === request) currentDeviceSync = null;
  }
}

export async function syncLocalDoseReminders(
  plan: MobileReminderPlan,
): Promise<LocalReminderSyncResult> {
  const reminders = plan.reminders.filter(
    (item) => new Date(item.scheduledAt).getTime() > Date.now(),
  );

  if (isNativeLocalNotificationAvailable()) {
    return enqueueNativeSchedule(reminders);
  }

  return scheduleBrowserFallback(reminders);
}

function isNativeLocalNotificationAvailable() {
  return (
    Capacitor.isNativePlatform() &&
    Capacitor.isPluginAvailable('LocalNotifications')
  );
}

function enqueueNativeSchedule(
  reminders: MobileReminderItem[],
): Promise<LocalReminderSyncResult> {
  const operation = nativeScheduleQueue.then(
    () => scheduleNative(reminders),
    () => scheduleNative(reminders),
  );
  nativeScheduleQueue = operation.then(
    () => undefined,
    () => undefined,
  );
  return operation;
}

async function scheduleNative(
  reminders: MobileReminderItem[],
): Promise<LocalReminderSyncResult> {
  if (reminders.length > 0) {
    const permission = await ensureNativePermission();
    if (permission !== 'granted') {
      return {
        mode: 'denied',
        scheduledCount: 0,
        warning: 'Device notification permission was not granted.',
      };
    }

    await ensureAndroidReminderChannel();
  }

  const relatedIdsByDose = new Map<string, number[]>();
  for (const item of reminders) {
    const ids = relatedIdsByDose.get(item.doseLogId) ?? [];
    ids.push(item.id);
    relatedIdsByDose.set(item.doseLogId, ids);
  }

  const notifications = reminders.map(
    (item) =>
      ({
        id: item.id,
        title: item.title,
        body: item.body,
        largeBody: item.body,
        channelId: DOSE_REMINDER_CHANNEL_ID,
        actionTypeId: DOSE_ACTION_TYPE_ID,
        autoCancel: true,
        schedule: { at: new Date(item.scheduledAt), allowWhileIdle: true },
        extra: {
          scheduleId: item.scheduleId,
          doseLogId: item.doseLogId,
          medicineId: item.medicineId,
          scheduledAt: item.doseScheduledAt,
          reminderKind: item.kind,
          actionUrl: item.actionUrl,
          actionRevision: 0,
          relatedNotificationIds: relatedIdsByDose.get(item.doseLogId) ?? [
            item.id,
          ],
        },
      }) satisfies LocalNotificationSchema,
  );

  const desiredIds = notifications.map((item) => item.id);
  const desiredIdSet = new Set(desiredIds);
  const previousIds = readNativeReminderIds();
  const pendingBefore = await LocalNotifications.getPending();
  const pendingIdSet = new Set(
    pendingBefore.notifications.map((item) => item.id),
  );

  const removedIds = previousIds.filter(
    (id) => pendingIdSet.has(id) && !desiredIdSet.has(id),
  );
  if (removedIds.length > 0) {
    await LocalNotifications.cancel({
      notifications: removedIds.map((id) => ({ id })),
    });
  }

  const missingNotifications = notifications.filter(
    (item) => !pendingIdSet.has(item.id),
  );
  if (missingNotifications.length > 0) {
    await LocalNotifications.schedule({ notifications: missingNotifications });
  }
  writeNativeReminderIds(desiredIds);

  if (notifications.length === 0) {
    return { mode: 'native', scheduledCount: 0 };
  }

  const exactAlarmWarning = await getExactAlarmWarning();
  const pendingAfter = await LocalNotifications.getPending();
  const scheduledCount = pendingAfter.notifications.filter((item) =>
    desiredIdSet.has(item.id),
  ).length;
  const warnings = [
    exactAlarmWarning,
    scheduledCount < notifications.length
      ? `Android accepted ${scheduledCount} of ${notifications.length} requested reminders.`
      : null,
  ].filter((value): value is string => Boolean(value));

  return {
    mode: 'native',
    scheduledCount,
    warning: warnings.length > 0 ? warnings.join(' ') : undefined,
  };
}
export async function scheduleLocalReminderTest(
  delaySeconds = 10,
): Promise<LocalReminderSyncResult> {
  const scheduledAt = new Date(Date.now() + Math.max(5, delaySeconds) * 1000);

  if (!isNativeLocalNotificationAvailable()) {
    return scheduleBrowserFallback([
      {
        id: 2_147_483_000,
        scheduleId: 'local-test',
        doseLogId: 'local-test',
        medicineId: 'local-test',
        medicineName: 'Test medicine',
        dosage: '1 dose',
        scheduledAt: scheduledAt.toISOString(),
        doseScheduledAt: scheduledAt.toISOString(),
        kind: 'PRIMARY',
        title: 'MediTrack reminder test',
        body: 'Local device reminders are working.',
        actionUrl: '/settings',
      },
    ]);
  }

  const permission = await ensureNativePermission();
  if (permission !== 'granted') {
    return {
      mode: 'denied',
      scheduledCount: 0,
      warning: 'Device notification permission was not granted.',
    };
  }

  await ensureAndroidReminderChannel();
  const id = 2_147_483_000;
  await LocalNotifications.cancel({ notifications: [{ id }] });
  await LocalNotifications.schedule({
    notifications: [
      {
        id,
        title: 'MediTrack reminder test',
        body: 'Local device reminders are working.',
        largeBody: 'Local device reminders are working.',
        channelId: DOSE_REMINDER_CHANNEL_ID,
        autoCancel: true,
        schedule: { at: scheduledAt, allowWhileIdle: true },
        extra: { actionUrl: '/settings' },
      },
    ],
  });

  return {
    mode: 'native',
    scheduledCount: 1,
    warning: (await getExactAlarmWarning()) ?? undefined,
  };
}

export async function openExactAlarmSettings(): Promise<boolean> {
  if (
    !isNativeLocalNotificationAvailable() ||
    Capacitor.getPlatform() !== 'android'
  )
    return false;
  const status = await LocalNotifications.changeExactNotificationSetting();
  return status.exact_alarm === 'granted';
}

async function ensureNativePermission(): Promise<'granted' | 'denied'> {
  const current = await LocalNotifications.checkPermissions();
  if (current.display === 'granted') return 'granted';
  const next = await LocalNotifications.requestPermissions();
  return next.display === 'granted' ? 'granted' : 'denied';
}

async function ensureAndroidReminderChannel() {
  if (Capacitor.getPlatform() !== 'android') return;

  await LocalNotifications.createChannel({
    id: DOSE_REMINDER_CHANNEL_ID,
    name: 'Dose reminders',
    description: 'Medication dose reminders from MediTrack AI.',
    importance: 5,
    visibility: 1,
    lights: true,
    lightColor: '#2DD4BF',
    vibration: true,
  });
}

async function getExactAlarmWarning(): Promise<string | null> {
  if (Capacitor.getPlatform() !== 'android') return null;

  try {
    const status = await LocalNotifications.checkExactNotificationSetting();
    if (status.exact_alarm === 'granted') return null;
    return 'Android exact-alarm permission is not enabled, so the system may delay reminders on some devices.';
  } catch {
    return null;
  }
}

function readNativeReminderIds(): number[] {
  try {
    const raw = window.localStorage.getItem(NATIVE_REMINDER_IDS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (value): value is number => Number.isInteger(value) && value > 0,
    );
  } catch {
    return [];
  }
}

function writeNativeReminderIds(ids: number[]) {
  try {
    window.localStorage.setItem(NATIVE_REMINDER_IDS_KEY, JSON.stringify(ids));
  } catch {
    // Reminder scheduling still works when web storage is unavailable.
  }
}

function getActionUrl(notification: LocalNotificationSchema) {
  const extra = notification.extra as { actionUrl?: unknown } | undefined;
  return typeof extra?.actionUrl === 'string' ? extra.actionUrl : null;
}

function getDoseActionExtra(notification: LocalNotificationSchema) {
  const extra = notification.extra as Record<string, unknown> | undefined;
  if (
    typeof extra?.doseLogId !== 'string' ||
    typeof extra.scheduleId !== 'string' ||
    typeof extra.scheduledAt !== 'string'
  ) {
    return null;
  }
  return {
    doseLogId: extra.doseLogId,
    scheduleId: extra.scheduleId,
    scheduledAt: extra.scheduledAt,
    actionRevision:
      typeof extra.actionRevision === 'number' &&
      Number.isSafeInteger(extra.actionRevision) &&
      extra.actionRevision >= 0
        ? extra.actionRevision
        : 0,
    relatedNotificationIds: Array.isArray(extra.relatedNotificationIds)
      ? extra.relatedNotificationIds.filter(
          (value): value is number => Number.isSafeInteger(value) && value > 0,
        )
      : [notification.id],
  };
}

async function scheduleNativeSnooze(
  notification: LocalNotificationSchema,
  at: Date,
  actionRevision: number,
) {
  await LocalNotifications.schedule({
    notifications: [
      {
        ...notification,
        id: notification.id,
        actionTypeId: DOSE_ACTION_TYPE_ID,
        schedule: { at, allowWhileIdle: true },
        extra: {
          ...(notification.extra as Record<string, unknown> | undefined),
          actionRevision,
        },
      },
    ],
  });
}

function nativeActionId(
  doseLogId: string,
  actionId: string,
  actionRevision: number,
) {
  return `native:${doseLogId}:${actionId}:${actionRevision}`;
}

async function waitForAuthenticatedUserId(
  timeoutMs = 2_000,
): Promise<string | null> {
  const current = useAuthStore.getState();
  if (current.isInitialized) return current.user?.id ?? null;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (userId: string | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      unsubscribe();
      resolve(userId);
    };
    const unsubscribe = useAuthStore.subscribe((state) => {
      if (state.isInitialized) finish(state.user?.id ?? null);
    });
    const timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

async function scheduleBrowserFallback(
  reminders: MobileReminderItem[],
): Promise<LocalReminderSyncResult> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return {
      mode: 'unsupported',
      scheduledCount: 0,
      warning:
        'This browser cannot schedule local notifications. Native mobile build is required for offline reminders.',
    };
  }

  let permission = Notification.permission;
  if (permission === 'default') {
    permission = await Notification.requestPermission();
  }

  if (permission !== 'granted') {
    return {
      mode: 'denied',
      scheduledCount: 0,
      warning: 'Browser notification permission was not granted.',
    };
  }

  clearBrowserTimers();
  let scheduledCount = 0;

  for (const item of reminders) {
    const delay = new Date(item.scheduledAt).getTime() - Date.now();
    if (delay <= 0 || delay > MAX_TIMER_DELAY_MS) continue;

    const timerId = window.setTimeout(() => {
      const notification = new Notification(item.title, {
        body: item.body,
        tag: `meditrack-dose-${item.id}`,
        data: item,
      });
      notification.onclick = () => {
        window.focus();
        window.location.assign(item.actionUrl);
      };
      browserTimers.delete(item.id);
    }, delay);

    browserTimers.set(item.id, timerId);
    scheduledCount += 1;
  }

  return {
    mode: 'browser-tab',
    scheduledCount,
    warning:
      'Browser reminders work only while this tab stays open. The mobile app will use offline device reminders.',
  };
}

function clearBrowserTimers() {
  for (const timerId of browserTimers.values()) {
    window.clearTimeout(timerId);
  }
  browserTimers.clear();
}
