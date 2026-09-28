import type { DoseBarrierReason } from '@/types/dose-log';

export const DOSE_BARRIER_OPTIONS: Array<{
  value: DoseBarrierReason;
  label: string;
}> = [
  { value: 'FORGOT', label: 'Forgot' },
  { value: 'ASLEEP', label: 'Was asleep' },
  { value: 'AWAY_FROM_HOME', label: 'Away from home' },
  { value: 'ROUTINE_CHANGED', label: 'Routine changed' },
  { value: 'RAN_OUT', label: 'Ran out' },
  { value: 'COST_OR_ACCESS', label: 'Cost or access problem' },
  { value: 'SIDE_EFFECT_CONCERN', label: 'Side-effect concern' },
  { value: 'DID_NOT_WANT_TO_TAKE', label: 'Did not want to take it' },
  { value: 'OTHER', label: 'Another reason' },
];

export const doseBarrierLabel = (reason?: DoseBarrierReason | null) =>
  DOSE_BARRIER_OPTIONS.find((option) => option.value === reason)?.label ??
  'Add reason';
