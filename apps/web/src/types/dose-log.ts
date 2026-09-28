export type DoseStatus = 'TAKEN' | 'MISSED' | 'SNOOZED' | 'SKIPPED' | 'PENDING';
export type DoseActionSource = 'APP' | 'DEVICE_NOTIFICATION' | 'OFFLINE_SYNC';
export type DoseBarrierReason =
  | 'FORGOT'
  | 'ASLEEP'
  | 'AWAY_FROM_HOME'
  | 'ROUTINE_CHANGED'
  | 'RAN_OUT'
  | 'COST_OR_ACCESS'
  | 'SIDE_EFFECT_CONCERN'
  | 'DID_NOT_WANT_TO_TAKE'
  | 'OTHER';
export type DoseOccurrenceState =
  | 'UPCOMING'
  | 'DUE'
  | 'OVERDUE'
  | 'SNOOZED'
  | 'TAKEN'
  | 'MISSED'
  | 'SKIPPED';

export interface DoseLog {
  id: string;
  scheduleId: string;
  medicineId: string;
  medicine?: {
    id: string;
    name: string;
    form: string;
    strength?: string | null;
  };
  scheduledAt: string;
  actionAt?: string | null;
  actionSource?: DoseActionSource | 'SYSTEM' | null;
  status: DoseStatus;
  snoozeUntil?: string | null;
  snoozeCount?: number;
  occurrenceState?: DoseOccurrenceState;
  effectiveDueAt?: string;
  graceEndsAt?: string;
  minutesUntilDue?: number;
  isActionable?: boolean;
  helpRequest?: {
    status: 'PENDING' | 'PROCESSING' | 'SENT' | 'FAILED';
    createdAt: string;
  } | null;
  barrierReason?: DoseBarrierReason | null;
  barrierRecordedAt?: string | null;
  notes?: string | null;
  createdAt: string;
}

export interface DoseBarrierSummaryItem {
  reason: DoseBarrierReason;
  label: string;
  count: number;
  guidance: string;
  urgent: boolean;
}

export interface DoseBarrierSummary {
  periodDays: number;
  finalized: number;
  recorded: number;
  unrecorded: number;
  coveragePercent: number;
  reasons: DoseBarrierSummaryItem[];
  guidance: DoseBarrierSummaryItem[];
  disclaimer: string;
}

export interface CreateDoseLogPayload {
  clientActionId?: string;
  scheduleId: string;
  scheduledAt: string;
  status: DoseStatus;
  source?: DoseActionSource;
  snoozeUntil?: string;
  notes?: string;
}
