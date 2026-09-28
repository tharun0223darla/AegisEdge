import axios from 'axios';
import { doseLogsService } from '@/services/dose-logs.service';
import type { CreateDoseLogPayload, DoseLog } from '@/types/dose-log';

const QUEUE_PREFIX = 'meditrack-dose-actions-v1';
const MAX_QUEUE_SIZE = 100;

interface QueuedDoseAction extends CreateDoseLogPayload {
  clientActionId: string;
  queuedAt: string;
}

export interface DoseActionSubmission {
  queued: boolean;
  doseLog?: DoseLog;
}

export function createDoseActionId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export async function submitDoseAction(
  userId: string,
  payload: CreateDoseLogPayload,
): Promise<DoseActionSubmission> {
  const action: QueuedDoseAction = {
    ...payload,
    clientActionId: payload.clientActionId ?? createDoseActionId(),
    source: payload.source ?? 'APP',
    queuedAt: new Date().toISOString(),
  };

  try {
    return {
      queued: false,
      doseLog: await doseLogsService.create(toPayload(action)),
    };
  } catch (error) {
    if (!isRetryableNetworkError(error)) throw error;
    enqueue(userId, action);
    return { queued: true };
  }
}

export async function flushDoseActionQueue(userId: string): Promise<{
  synced: number;
  discarded: number;
  remaining: number;
}> {
  const queued = readQueue(userId);
  const remaining: QueuedDoseAction[] = [];
  let synced = 0;
  let discarded = 0;

  for (const action of queued) {
    try {
      await doseLogsService.create({
        ...toPayload(action),
        source: 'OFFLINE_SYNC',
      });
      synced += 1;
    } catch (error) {
      if (isRetryableNetworkError(error)) {
        remaining.push(action);
        remaining.push(...queued.slice(synced + discarded + 1));
        break;
      }
      if (axios.isAxiosError(error) && error.response?.status === 401) {
        remaining.push(action);
        remaining.push(...queued.slice(synced + discarded + 1));
        break;
      }
      discarded += 1;
    }
  }

  writeQueue(userId, remaining);
  return { synced, discarded, remaining: remaining.length };
}

function enqueue(userId: string, action: QueuedDoseAction) {
  const queue = readQueue(userId);
  if (!queue.some((item) => item.clientActionId === action.clientActionId)) {
    queue.push(action);
  }
  writeQueue(userId, queue.slice(-MAX_QUEUE_SIZE));
}

function readQueue(userId: string): QueuedDoseAction[] {
  try {
    const raw = window.localStorage.getItem(queueKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as QueuedDoseAction[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(userId: string, queue: QueuedDoseAction[]) {
  try {
    if (queue.length === 0) {
      window.localStorage.removeItem(queueKey(userId));
      return;
    }
    window.localStorage.setItem(queueKey(userId), JSON.stringify(queue));
  } catch {
    // The online request path remains usable when storage is unavailable.
  }
}

function queueKey(userId: string) {
  return `${QUEUE_PREFIX}:${userId}`;
}

function toPayload(action: QueuedDoseAction): CreateDoseLogPayload {
  const { queuedAt, ...payload } = action;
  void queuedAt;
  return payload;
}

function isRetryableNetworkError(error: unknown) {
  return (
    (typeof navigator !== 'undefined' && !navigator.onLine) ||
    (axios.isAxiosError(error) && !error.response)
  );
}
