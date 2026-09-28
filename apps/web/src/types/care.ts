export type CarePermission =
  | 'VIEW_ADHERENCE'
  | 'VIEW_MEDICATIONS'
  | 'VIEW_MEDICATION_SAFETY'
  | 'VIEW_REFILLS'
  | 'RECEIVE_MISSED_DOSE_ALERTS'
  | 'RECEIVE_DOSE_HELP_REQUESTS';

export interface DoseHelpRequestResult {
  requested: true;
  eligibleCaregivers: number;
  newlyQueued: number;
  alreadyRequested: boolean;
  disclaimer: string;
}

export interface CarePerson {
  id: string;
  displayName: string;
}

export interface CareRelationship {
  id: string;
  caregiver?: CarePerson;
  patient?: CarePerson;
  permissions: CarePermission[];
  expiresAt: string | null;
  patientConsentedAt: string;
  caregiverAcknowledgedAt?: string;
  consentVersion?: string;
}

export interface CareInvitation {
  id: string;
  invitedEmail: string;
  permissions: CarePermission[];
  status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
  expiresAt: string;
  accessExpiresAt: string;
  createdAt: string;
}

export interface CareCircle {
  relationships: CareRelationship[];
  invitations: CareInvitation[];
  limits: { active: number; pending: number };
}

export interface CareAccessLogEntry {
  id: string;
  caregiver: CarePerson;
  accessedAt: string;
}

export interface CareInvitationPreview {
  id: string;
  patient: CarePerson;
  permissions: CarePermission[];
  expiresAt: string;
  accessExpiresAt: string;
  consentVersion: string;
}

export interface CareDashboard {
  relationship: {
    id: string;
    permissions: CarePermission[];
    expiresAt: string | null;
  };
  patient: CarePerson;
  day: { date: string; timezone: string };
  adherence: {
    total: number;
    taken: number;
    missed: number;
    snoozed: number;
    skipped: number;
    pending: number;
    completionPercent: number;
  } | null;
  doses: Array<{
    id: string;
    scheduledAt: string;
    actionAt: string | null;
    status: 'TAKEN' | 'MISSED' | 'SNOOZED' | 'SKIPPED' | 'PENDING';
    medicine?: {
      id: string;
      name: string;
      strength: string | null;
      form: string;
    };
    dose: { quantity: number; unit: string };
  }> | null;
  medicines: Array<{
    id: string;
    name: string;
    genericName: string | null;
    strength: string | null;
    form: string;
    unit: string | null;
  }> | null;
  refills: Array<{
    id: string;
    name: string;
    strength: string | null;
    unit: string | null;
    remainingQuantity: number | null;
    needsAttention: boolean;
  }> | null;
  disclaimer: string;
}

export interface CreateCareInvitationInput {
  email: string;
  permissions: CarePermission[];
  confirmAdult: true;
  consentAcknowledged: true;
  accessDurationDays?: number;
}
