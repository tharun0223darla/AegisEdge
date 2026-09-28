import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AuditAction,
  CareEscalationStatus,
  CareInvitationStatus,
  CarePermission,
  CareRelationshipStatus,
  DoseStatus,
  Prisma,
} from '@prisma/client';
import type { CareInvitation as CareInvitationRecord } from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailNotificationService } from '../notifications/email-notification.service';
import { zonedDayBounds } from '../schedules/schedule-timezone';
import {
  AcceptCareInvitationDto,
  CreateCareInvitationDto,
  UpdateCarePermissionsDto,
} from './dto/care.dto';

const CARE_CONSENT_VERSION = 'care-sharing-v1-2026-07-30';
const INVITATION_LIFETIME_DAYS = 7;
const MAX_ACTIVE_CAREGIVERS = 10;
const MAX_PENDING_INVITATIONS = 10;

type AuditContext = {
  ipAddress?: string;
  userAgent?: string;
};

type NamedUser = {
  id: string;
  email: string;
  patientProfile: {
    firstName: string;
    lastName: string;
  } | null;
};

@Injectable()
export class CareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
    private readonly emailNotifications: EmailNotificationService,
  ) {}

  async createInvitation(
    patientId: string,
    dto: CreateCareInvitationDto,
    auditContext: AuditContext = {},
  ) {
    await this.expireStaleRecords();
    const now = new Date();
    const patient = await this.prisma.user.findUnique({
      where: { id: patientId },
      select: {
        id: true,
        email: true,
        isActive: true,
        patientProfile: { select: { dateOfBirth: true } },
      },
    });
    if (!patient?.isActive)
      throw new NotFoundException('Patient account not found');
    if (patient.email.toLowerCase() === dto.email) {
      throw new BadRequestException('You cannot invite your own account');
    }
    if (
      patient.patientProfile?.dateOfBirth &&
      this.ageOn(patient.patientProfile.dateOfBirth, now) < 18
    ) {
      throw new BadRequestException(
        'Care sharing for minors requires a verified guardian workflow and is not available yet.',
      );
    }

    const caregiver = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, isActive: true },
    });
    if (caregiver && !caregiver.isActive) {
      throw new BadRequestException(
        'This caregiver account is currently inactive.',
      );
    }

    const existingRelationship = caregiver
      ? await this.prisma.careRelationship.findUnique({
          where: {
            patientId_caregiverId: {
              patientId,
              caregiverId: caregiver.id,
            },
          },
          select: { status: true, expiresAt: true },
        })
      : null;
    if (
      existingRelationship?.status === CareRelationshipStatus.ACTIVE &&
      (!existingRelationship.expiresAt || existingRelationship.expiresAt > now)
    ) {
      throw new ConflictException(
        'This person already has active caregiver access',
      );
    }

    const [activeCount, pendingCount] = await Promise.all([
      this.prisma.careRelationship.count({
        where: {
          patientId,
          status: CareRelationshipStatus.ACTIVE,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      }),
      this.prisma.careInvitation.count({
        where: { patientId, status: CareInvitationStatus.PENDING },
      }),
    ]);
    if (activeCount >= MAX_ACTIVE_CAREGIVERS) {
      throw new BadRequestException(
        `A patient can share access with at most ${MAX_ACTIVE_CAREGIVERS} caregivers.`,
      );
    }
    if (pendingCount >= MAX_PENDING_INVITATIONS) {
      throw new BadRequestException(
        `You can have at most ${MAX_PENDING_INVITATIONS} pending invitations.`,
      );
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const expiresAt = this.addDays(now, INVITATION_LIFETIME_DAYS);
    const accessExpiresAt = this.addDays(now, dto.accessDurationDays ?? 365);
    const permissions = this.normalizePermissions(dto.permissions);

    let invitation: CareInvitationRecord;
    try {
      invitation = await this.prisma.careInvitation.create({
        data: {
          patientId,
          invitedEmail: dto.email,
          tokenHash,
          permissions,
          consentVersion: CARE_CONSENT_VERSION,
          expiresAt,
          accessExpiresAt,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A pending invitation already exists for this caregiver.',
        );
      }
      throw error;
    }

    await this.auditLogs.log({
      userId: patientId,
      action: AuditAction.CARE_INVITATION_CREATED,
      entityType: 'CareInvitation',
      entityId: invitation.id,
      newValues: {
        recipient: this.maskEmail(dto.email),
        permissions,
        consentVersion: CARE_CONSENT_VERSION,
        invitationExpiresAt: expiresAt.toISOString(),
        accessExpiresAt: accessExpiresAt.toISOString(),
      },
      ...auditContext,
    });

    const inviteUrl = this.buildInvitationUrl(token);
    const delivery = await this.emailNotifications.sendDirect({
      recipient: dto.email,
      subject: 'You have a MediTrack Care Circle invitation',
      body: 'A MediTrack user invited you to view selected medication information for a limited time. Sign in or create an account using this exact email address to review the invitation.',
      actionLabel: 'Review invitation',
      actionUrl: inviteUrl,
      tag: 'care-invitation',
    });

    return {
      invitation: this.serializeInvitation(invitation),
      inviteUrl,
      delivery: delivery.status === 'SENT' ? 'EMAIL' : 'COPY_LINK',
      message:
        delivery.status === 'SENT'
          ? 'The invitation was emailed. The private link is also shown once as a fallback.'
          : 'Email delivery was unavailable. Share this one-time link privately; it expires in 7 days.',
    };
  }

  async listForPatient(patientId: string) {
    await this.expireStaleRecords();
    const now = new Date();
    const [relationships, invitations] = await Promise.all([
      this.prisma.careRelationship.findMany({
        where: {
          patientId,
          status: CareRelationshipStatus.ACTIVE,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        include: {
          caregiver: {
            select: {
              id: true,
              email: true,
              patientProfile: { select: { firstName: true, lastName: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.careInvitation.findMany({
        where: { patientId, status: CareInvitationStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      relationships: relationships.map((item) => ({
        id: item.id,
        caregiver: this.serializePerson(item.caregiver),
        permissions: item.permissions,
        consentVersion: item.consentVersion,
        patientConsentedAt: item.patientConsentedAt,
        caregiverAcknowledgedAt: item.caregiverAcknowledgedAt,
        expiresAt: item.expiresAt,
      })),
      invitations: invitations.map((item) => this.serializeInvitation(item)),
      limits: {
        active: MAX_ACTIVE_CAREGIVERS,
        pending: MAX_PENDING_INVITATIONS,
      },
    };
  }

  async listForCaregiver(caregiverId: string) {
    await this.expireStaleRecords();
    const now = new Date();
    const relationships = await this.prisma.careRelationship.findMany({
      where: {
        caregiverId,
        status: CareRelationshipStatus.ACTIVE,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            patientProfile: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return relationships.map((item) => ({
      id: item.id,
      patient: this.serializePerson(item.patient),
      permissions: item.permissions,
      expiresAt: item.expiresAt,
      patientConsentedAt: item.patientConsentedAt,
    }));
  }

  async previewInvitation(caregiverId: string, token: string) {
    const invitation = await this.findUsableInvitation(token);
    const caregiver = await this.prisma.user.findUnique({
      where: { id: caregiverId },
      select: { email: true, isActive: true, isVerified: true },
    });
    if (!caregiver?.isActive)
      throw new ForbiddenException('Account is not active');
    if (!caregiver.isVerified)
      throw new ForbiddenException(
        'Verify your email before using this invitation',
      );
    if (caregiver.email.toLowerCase() !== invitation.invitedEmail) {
      throw new ForbiddenException(
        'This invitation was issued to a different email address.',
      );
    }

    return {
      id: invitation.id,
      patient: this.serializePerson(invitation.patient),
      permissions: invitation.permissions,
      expiresAt: invitation.expiresAt,
      accessExpiresAt: invitation.accessExpiresAt,
      consentVersion: invitation.consentVersion,
    };
  }

  async acceptInvitation(
    caregiverId: string,
    dto: AcceptCareInvitationDto,
    auditContext: AuditContext = {},
  ) {
    const tokenHash = this.hashToken(dto.token);
    const now = new Date();
    const caregiver = await this.prisma.user.findUnique({
      where: { id: caregiverId },
      select: { id: true, email: true, isActive: true, isVerified: true },
    });
    if (!caregiver?.isActive)
      throw new ForbiddenException('Account is not active');
    if (!caregiver.isVerified)
      throw new ForbiddenException(
        'Verify your email before accepting this invitation',
      );

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tokenHash}))`;
      const invitation = await tx.careInvitation.findUnique({
        where: { tokenHash },
      });
      if (!invitation) throw new NotFoundException('Invitation not found');
      if (invitation.status !== CareInvitationStatus.PENDING) {
        throw new GoneException('This invitation is no longer active');
      }
      if (invitation.expiresAt <= now) {
        throw new GoneException('This invitation has expired');
      }
      if (invitation.invitedEmail !== caregiver.email.toLowerCase()) {
        throw new ForbiddenException(
          'This invitation was issued to a different email address.',
        );
      }
      if (invitation.patientId === caregiverId) {
        throw new BadRequestException('You cannot become your own caregiver');
      }

      const relationship = await tx.careRelationship.upsert({
        where: {
          patientId_caregiverId: {
            patientId: invitation.patientId,
            caregiverId,
          },
        },
        create: {
          patientId: invitation.patientId,
          caregiverId,
          permissions: invitation.permissions,
          consentVersion: invitation.consentVersion,
          patientConsentedAt: invitation.createdAt,
          caregiverAcknowledgedAt: now,
          expiresAt: invitation.accessExpiresAt,
        },
        update: {
          status: CareRelationshipStatus.ACTIVE,
          permissions: invitation.permissions,
          consentVersion: invitation.consentVersion,
          patientConsentedAt: invitation.createdAt,
          caregiverAcknowledgedAt: now,
          expiresAt: invitation.accessExpiresAt,
          revokedAt: null,
          revokedById: null,
        },
      });

      await tx.careInvitation.update({
        where: { id: invitation.id },
        data: {
          status: CareInvitationStatus.ACCEPTED,
          acceptedAt: now,
          acceptedById: caregiverId,
          relationshipId: relationship.id,
        },
      });
      return { invitation, relationship };
    });

    await this.auditLogs.log({
      userId: caregiverId,
      action: AuditAction.CARE_INVITATION_ACCEPTED,
      entityType: 'CareRelationship',
      entityId: result.relationship.id,
      newValues: {
        patientId: result.relationship.patientId,
        permissions: result.relationship.permissions,
        consentVersion: result.relationship.consentVersion,
        expiresAt: result.relationship.expiresAt?.toISOString() ?? null,
      },
      ...auditContext,
    });

    return {
      id: result.relationship.id,
      patientId: result.relationship.patientId,
      permissions: result.relationship.permissions,
      expiresAt: result.relationship.expiresAt,
      status: result.relationship.status,
    };
  }

  async revokeInvitation(
    patientId: string,
    invitationId: string,
    auditContext: AuditContext = {},
  ) {
    const invitation = await this.prisma.careInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.patientId !== patientId) {
      throw new ForbiddenException('You cannot revoke this invitation');
    }
    if (invitation.status !== CareInvitationStatus.PENDING) {
      throw new ConflictException('Only pending invitations can be revoked');
    }

    const revokedAt = new Date();
    await this.prisma.careInvitation.update({
      where: { id: invitationId },
      data: { status: CareInvitationStatus.REVOKED, revokedAt },
    });
    await this.auditLogs.log({
      userId: patientId,
      action: AuditAction.CARE_INVITATION_REVOKED,
      entityType: 'CareInvitation',
      entityId: invitationId,
      newValues: { revokedAt: revokedAt.toISOString() },
      ...auditContext,
    });
    return { id: invitationId, status: CareInvitationStatus.REVOKED };
  }

  async updatePermissions(
    patientId: string,
    relationshipId: string,
    dto: UpdateCarePermissionsDto,
    auditContext: AuditContext = {},
  ) {
    const relationship = await this.findPatientRelationship(
      patientId,
      relationshipId,
    );
    const permissions = this.normalizePermissions(dto.permissions);
    const updated = await this.prisma.careRelationship.update({
      where: { id: relationshipId },
      data: { permissions },
    });
    await this.auditLogs.log({
      userId: patientId,
      action: AuditAction.CARE_ACCESS_UPDATED,
      entityType: 'CareRelationship',
      entityId: relationshipId,
      oldValues: { permissions: relationship.permissions },
      newValues: { permissions },
      ...auditContext,
    });
    return {
      id: updated.id,
      permissions: updated.permissions,
      expiresAt: updated.expiresAt,
    };
  }

  async revokeRelationship(
    patientId: string,
    relationshipId: string,
    auditContext: AuditContext = {},
  ) {
    await this.findPatientRelationship(patientId, relationshipId);
    const revokedAt = new Date();
    await this.prisma.$transaction([
      this.prisma.careRelationship.update({
        where: { id: relationshipId },
        data: {
          status: CareRelationshipStatus.REVOKED,
          revokedAt,
          revokedById: patientId,
        },
      }),
      this.prisma.careEscalation.updateMany({
        where: {
          relationshipId,
          status: {
            in: [CareEscalationStatus.PENDING, CareEscalationStatus.PROCESSING],
          },
        },
        data: {
          status: CareEscalationStatus.FAILED,
          nextAttemptAt: null,
          lastError: 'Care access revoked before delivery',
        },
      }),
    ]);
    await this.auditLogs.log({
      userId: patientId,
      action: AuditAction.CARE_ACCESS_REVOKED,
      entityType: 'CareRelationship',
      entityId: relationshipId,
      newValues: { revokedAt: revokedAt.toISOString() },
      ...auditContext,
    });
    return { id: relationshipId, status: CareRelationshipStatus.REVOKED };
  }

  async getCaregiverDashboard(
    caregiverId: string,
    patientId: string,
    auditContext: AuditContext = {},
  ) {
    const relationship = await this.assertActiveRelationship(
      caregiverId,
      patientId,
    );
    const permissions = new Set(relationship.permissions);
    const canViewAdherence = permissions.has(CarePermission.VIEW_ADHERENCE);
    const canViewMedicines = permissions.has(CarePermission.VIEW_MEDICATIONS);
    const canViewRefills = permissions.has(CarePermission.VIEW_REFILLS);

    const schedule = await this.prisma.medicineSchedule.findFirst({
      where: { userId: patientId, isActive: true },
      select: { timezone: true },
      orderBy: { updatedAt: 'desc' },
    });
    const timezone = schedule?.timezone ?? 'UTC';
    const bounds = zonedDayBounds(new Date(), timezone);

    let adherence: Record<string, number> | null = null;
    let doses: Array<Record<string, unknown>> | null = null;
    if (canViewAdherence) {
      const logs = await this.prisma.doseLog.findMany({
        where: {
          userId: patientId,
          scheduledAt: { gte: bounds.start, lte: bounds.end },
        },
        select: {
          id: true,
          scheduledAt: true,
          actionAt: true,
          status: true,
          medicine: canViewMedicines
            ? { select: { id: true, name: true, strength: true, form: true } }
            : false,
          schedule: { select: { dosesPerIntake: true, unit: true } },
        },
        orderBy: { scheduledAt: 'asc' },
      });
      adherence = this.summarizeStatuses(logs.map((item) => item.status));
      doses = logs.map((item) => ({
        id: item.id,
        scheduledAt: item.scheduledAt,
        actionAt: item.actionAt,
        status: item.status,
        ...(canViewMedicines && 'medicine' in item
          ? { medicine: item.medicine }
          : {}),
        dose: {
          quantity: item.schedule.dosesPerIntake,
          unit: item.schedule.unit,
        },
      }));
    }

    let medicines: Array<Record<string, unknown>> | null = null;
    if (canViewMedicines) {
      medicines = await this.prisma.medicine.findMany({
        where: { userId: patientId, isActive: true },
        select: {
          id: true,
          name: true,
          genericName: true,
          strength: true,
          form: true,
          unit: true,
        },
        orderBy: { name: 'asc' },
      });
    }

    let refills: Array<Record<string, unknown>> | null = null;
    if (canViewRefills) {
      const refillMedicines = await this.prisma.medicine.findMany({
        where: { userId: patientId, isActive: true },
        select: {
          id: true,
          name: true,
          strength: true,
          unit: true,
          remainingQuantity: true,
          refillThreshold: true,
        },
        orderBy: { name: 'asc' },
      });
      refills = refillMedicines.map((medicine) => {
        const threshold = medicine.refillThreshold ?? 5;
        return {
          id: medicine.id,
          name: medicine.name,
          strength: medicine.strength,
          unit: medicine.unit,
          remainingQuantity: medicine.remainingQuantity,
          needsAttention:
            medicine.remainingQuantity !== null &&
            medicine.remainingQuantity <= threshold,
        };
      });
    }

    await this.auditLogs.log({
      userId: caregiverId,
      action: AuditAction.CAREGIVER_DATA_ACCESSED,
      entityType: 'CareRelationship',
      entityId: relationship.id,
      newValues: {
        patientId,
        sections: {
          adherence: canViewAdherence,
          medicines: canViewMedicines,
          refills: canViewRefills,
        },
      },
      ...auditContext,
    });

    return {
      relationship: {
        id: relationship.id,
        permissions: relationship.permissions,
        expiresAt: relationship.expiresAt,
      },
      patient: this.serializePerson(relationship.patient),
      day: { date: bounds.dateKey, timezone },
      adherence,
      doses,
      medicines,
      refills,
      disclaimer:
        'Shared adherence information supports personal coordination only. It is not emergency monitoring, a diagnosis, or permission to change treatment.',
    };
  }

  async getPatientAccessLog(patientId: string) {
    const relationships = await this.prisma.careRelationship.findMany({
      where: { patientId },
      select: {
        id: true,
        caregiver: {
          select: {
            id: true,
            email: true,
            patientProfile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    const relationshipById = new Map(
      relationships.map((item) => [item.id, item.caregiver]),
    );
    const logs = await this.prisma.auditLog.findMany({
      where: {
        action: AuditAction.CAREGIVER_DATA_ACCESSED,
        entityType: 'CareRelationship',
        entityId: { in: relationships.map((item) => item.id) },
      },
      select: { id: true, entityId: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return logs.flatMap((log) => {
      const caregiver = log.entityId
        ? relationshipById.get(log.entityId)
        : undefined;
      return caregiver
        ? [
            {
              id: log.id,
              caregiver: this.serializePerson(caregiver),
              accessedAt: log.createdAt,
            },
          ]
        : [];
    });
  }

  private async findUsableInvitation(token: string) {
    const invitation = await this.prisma.careInvitation.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            patientProfile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    if (invitation.status !== CareInvitationStatus.PENDING) {
      throw new GoneException('This invitation is no longer active');
    }
    if (invitation.expiresAt <= new Date()) {
      await this.prisma.careInvitation.update({
        where: { id: invitation.id },
        data: { status: CareInvitationStatus.EXPIRED },
      });
      throw new GoneException('This invitation has expired');
    }
    return invitation;
  }

  private async findPatientRelationship(
    patientId: string,
    relationshipId: string,
  ) {
    const relationship = await this.prisma.careRelationship.findUnique({
      where: { id: relationshipId },
    });
    if (!relationship)
      throw new NotFoundException('Care relationship not found');
    if (relationship.patientId !== patientId) {
      throw new ForbiddenException('You cannot manage this care relationship');
    }
    if (
      relationship.status !== CareRelationshipStatus.ACTIVE ||
      (relationship.expiresAt && relationship.expiresAt <= new Date())
    ) {
      throw new GoneException('This care relationship is no longer active');
    }
    return relationship;
  }

  private async assertActiveRelationship(
    caregiverId: string,
    patientId: string,
  ) {
    const now = new Date();
    const relationship = await this.prisma.careRelationship.findUnique({
      where: { patientId_caregiverId: { patientId, caregiverId } },
      include: {
        patient: {
          select: {
            id: true,
            email: true,
            isActive: true,
            patientProfile: { select: { firstName: true, lastName: true } },
          },
        },
      },
    });
    if (!relationship || relationship.patientId !== patientId) {
      throw new ForbiddenException('Caregiver access has not been granted');
    }
    if (
      relationship.status !== CareRelationshipStatus.ACTIVE ||
      (relationship.expiresAt && relationship.expiresAt <= now) ||
      !relationship.patient.isActive
    ) {
      throw new ForbiddenException('Caregiver access is inactive or expired');
    }
    return relationship;
  }

  private async expireStaleRecords() {
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.careInvitation.updateMany({
        where: {
          status: CareInvitationStatus.PENDING,
          expiresAt: { lte: now },
        },
        data: { status: CareInvitationStatus.EXPIRED },
      }),
      this.prisma.careRelationship.updateMany({
        where: {
          status: CareRelationshipStatus.ACTIVE,
          expiresAt: { lte: now },
        },
        data: { status: CareRelationshipStatus.EXPIRED },
      }),
    ]);
  }

  private serializeInvitation(invitation: {
    id: string;
    invitedEmail: string;
    permissions: CarePermission[];
    status: CareInvitationStatus;
    expiresAt: Date;
    accessExpiresAt: Date;
    createdAt: Date;
  }) {
    return {
      id: invitation.id,
      invitedEmail: this.maskEmail(invitation.invitedEmail),
      permissions: invitation.permissions,
      status: invitation.status,
      expiresAt: invitation.expiresAt,
      accessExpiresAt: invitation.accessExpiresAt,
      createdAt: invitation.createdAt,
    };
  }

  private serializePerson(user: NamedUser) {
    const fullName = user.patientProfile
      ? `${user.patientProfile.firstName} ${user.patientProfile.lastName}`.trim()
      : '';
    return {
      id: user.id,
      displayName: fullName || this.maskEmail(user.email),
    };
  }

  private summarizeStatuses(statuses: DoseStatus[]) {
    const summary: Record<string, number> = {
      total: statuses.length,
      taken: 0,
      missed: 0,
      snoozed: 0,
      skipped: 0,
      pending: 0,
      completionPercent: 0,
    };
    for (const status of statuses) {
      summary[status.toLowerCase()] += 1;
    }
    const finalized =
      summary.taken + summary.missed + summary.snoozed + summary.skipped;
    summary.completionPercent = finalized
      ? Math.round((summary.taken / finalized) * 100)
      : 0;
    return summary;
  }

  private normalizePermissions(permissions: CarePermission[]) {
    return [...new Set(permissions)].sort();
  }

  private buildInvitationUrl(token: string) {
    const configured = process.env.FRONTEND_URL?.split(',')[0]?.trim();
    const base = configured || 'http://localhost:5173';
    const url = new URL('/care/invitations/accept', base);
    url.hash = `token=${encodeURIComponent(token)}`;
    return url.toString();
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private maskEmail(email: string) {
    const [local, domain] = email.split('@');
    if (!domain) return 'hidden';
    return `${local.slice(0, 1)}***@${domain}`;
  }

  private addDays(date: Date, days: number) {
    return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private ageOn(dateOfBirth: Date, today: Date) {
    let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
    const beforeBirthday =
      today.getUTCMonth() < dateOfBirth.getUTCMonth() ||
      (today.getUTCMonth() === dateOfBirth.getUTCMonth() &&
        today.getUTCDate() < dateOfBirth.getUTCDate());
    if (beforeBirthday) age -= 1;
    return age;
  }
}
