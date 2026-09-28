import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import {
  AuditAction,
  CareEscalationKind,
  CareEscalationStatus,
  CarePermission,
  CareRelationshipStatus,
  DoseStatus,
  NotificationChannel,
} from '@prisma/client';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';

const DISCOVERY_WINDOW_HOURS = 6;
const MAX_DELIVERY_ATTEMPTS = 5;
const CLAIM_BATCH_SIZE = 50;
const STALE_CLAIM_MINUTES = 10;

@Injectable()
export class CareEscalationService {
  private readonly logger = new Logger(CareEscalationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processMissedDoseEscalations() {
    try {
      await this.discoverEscalations();
      await this.deliverEscalations();
    } catch (error) {
      this.logger.error(
        'Caregiver escalation cycle failed',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  async discoverEscalations(now = new Date()) {
    const windowStart = new Date(
      now.getTime() - DISCOVERY_WINDOW_HOURS * 60 * 60 * 1000,
    );
    const missedDoses = await this.prisma.doseLog.findMany({
      where: {
        status: DoseStatus.MISSED,
        scheduledAt: { gte: windowStart, lte: now },
      },
      select: { id: true, userId: true, scheduledAt: true },
      orderBy: { scheduledAt: 'asc' },
      take: 500,
    });
    if (!missedDoses.length) return 0;

    const patientIds = [...new Set(missedDoses.map((dose) => dose.userId))];
    const relationships = await this.prisma.careRelationship.findMany({
      where: {
        patientId: { in: patientIds },
        status: CareRelationshipStatus.ACTIVE,
        permissions: { has: CarePermission.RECEIVE_MISSED_DOSE_ALERTS },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        caregiver: { isActive: true },
      },
      select: { id: true, patientId: true, patientConsentedAt: true },
    });

    const relationshipsByPatient = new Map<string, typeof relationships>();
    for (const relationship of relationships) {
      const list = relationshipsByPatient.get(relationship.patientId) ?? [];
      list.push(relationship);
      relationshipsByPatient.set(relationship.patientId, list);
    }

    const rows = missedDoses.flatMap((dose) =>
      (relationshipsByPatient.get(dose.userId) ?? [])
        .filter(
          (relationship) => dose.scheduledAt >= relationship.patientConsentedAt,
        )
        .map((relationship) => ({
          relationshipId: relationship.id,
          doseLogId: dose.id,
          kind: CareEscalationKind.MISSED_DOSE,
          status: CareEscalationStatus.PENDING,
        })),
    );
    if (!rows.length) return 0;

    const result = await this.prisma.careEscalation.createMany({
      data: rows,
      skipDuplicates: true,
    });
    return result.count;
  }

  async requestDoseHelp(userId: string, doseLogId: string, now = new Date()) {
    const dose = await this.prisma.doseLog.findUnique({
      where: { id: doseLogId },
      select: { id: true, userId: true, scheduledAt: true },
    });
    if (!dose || dose.userId !== userId) {
      throw new NotFoundException('Dose occurrence not found');
    }

    const relationships = await this.prisma.careRelationship.findMany({
      where: {
        patientId: userId,
        status: CareRelationshipStatus.ACTIVE,
        permissions: { has: CarePermission.RECEIVE_DOSE_HELP_REQUESTS },
        patientConsentedAt: { lte: dose.scheduledAt },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        caregiver: { isActive: true },
      },
      select: { id: true },
    });

    const result = relationships.length
      ? await this.prisma.careEscalation.createMany({
          data: relationships.map((relationship) => ({
            relationshipId: relationship.id,
            doseLogId: dose.id,
            kind: CareEscalationKind.DOSE_HELP_REQUEST,
            status: CareEscalationStatus.PENDING,
          })),
          skipDuplicates: true,
        })
      : { count: 0 };

    await this.auditLogs.log({
      userId,
      action: AuditAction.CARE_DOSE_HELP_REQUESTED,
      entityType: 'DoseLog',
      entityId: dose.id,
      newValues: {
        eligibleCaregivers: relationships.length,
        newlyQueued: result.count,
      },
    });

    return {
      requested: true,
      eligibleCaregivers: relationships.length,
      newlyQueued: result.count,
      alreadyRequested:
        relationships.length > 0 && result.count < relationships.length,
      disclaimer:
        'This requests a caregiver check-in only. It is not emergency monitoring or medical advice.',
    };
  }

  async deliverEscalations(now = new Date()) {
    const staleBefore = new Date(
      now.getTime() - STALE_CLAIM_MINUTES * 60 * 1000,
    );
    const candidates = await this.prisma.careEscalation.findMany({
      where: {
        attempts: { lt: MAX_DELIVERY_ATTEMPTS },
        OR: [
          {
            status: CareEscalationStatus.PENDING,
            OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
          },
          {
            status: CareEscalationStatus.FAILED,
            nextAttemptAt: { lte: now },
          },
          {
            status: CareEscalationStatus.PROCESSING,
            claimedAt: { lte: staleBefore },
          },
        ],
      },
      select: { id: true, status: true },
      orderBy: { createdAt: 'asc' },
      take: CLAIM_BATCH_SIZE,
    });

    let delivered = 0;
    for (const candidate of candidates) {
      const claimed = await this.prisma.careEscalation.updateMany({
        where: { id: candidate.id, status: candidate.status },
        data: {
          status: CareEscalationStatus.PROCESSING,
          claimedAt: now,
          attempts: { increment: 1 },
        },
      });
      if (!claimed.count) continue;
      if (await this.deliverOne(candidate.id, now)) delivered += 1;
    }
    return delivered;
  }

  private async deliverOne(escalationId: string, now: Date) {
    const escalation = await this.prisma.careEscalation.findUnique({
      where: { id: escalationId },
      include: {
        relationship: {
          include: {
            caregiver: { select: { id: true, isActive: true } },
          },
        },
        doseLog: { select: { id: true, scheduledAt: true } },
      },
    });
    if (!escalation) return false;

    const relationship = escalation.relationship;
    const requiredPermission =
      escalation.kind === CareEscalationKind.DOSE_HELP_REQUEST
        ? CarePermission.RECEIVE_DOSE_HELP_REQUESTS
        : CarePermission.RECEIVE_MISSED_DOSE_ALERTS;
    const isAuthorized =
      relationship.status === CareRelationshipStatus.ACTIVE &&
      (!relationship.expiresAt || relationship.expiresAt > now) &&
      relationship.caregiver.isActive &&
      relationship.permissions.includes(requiredPermission) &&
      escalation.doseLog.scheduledAt >= relationship.patientConsentedAt;

    if (!isAuthorized) {
      await this.prisma.careEscalation.update({
        where: { id: escalation.id },
        data: {
          status: CareEscalationStatus.FAILED,
          nextAttemptAt: null,
          lastError: 'Care access is inactive or no longer permits alerts',
        },
      });
      return false;
    }

    try {
      const isHelpRequest =
        escalation.kind === CareEscalationKind.DOSE_HELP_REQUEST;
      const title = isHelpRequest
        ? 'Caregiver check-in requested'
        : 'Care check-in requested';
      const body = isHelpRequest
        ? 'A person you support requested help with a scheduled dose. Open MediTrack to review the shared adherence status.'
        : 'A person you support has a missed dose. Open MediTrack to review the shared adherence status.';
      const type = isHelpRequest
        ? 'CAREGIVER_DOSE_HELP_REQUEST'
        : 'CAREGIVER_MISSED_DOSE';
      const dedupeKey = isHelpRequest
        ? `care-help:${relationship.id}:${escalation.doseLogId}`
        : `care-missed:${relationship.id}:${escalation.doseLogId}`;
      await this.notifications.send({
        userId: relationship.caregiverId,
        title,
        body,
        channel: NotificationChannel.LOCAL,
        dedupeKey,
        metadata: {
          type,
          relationshipId: relationship.id,
          patientId: relationship.patientId,
          actionUrl: `/care/patients/${relationship.patientId}`,
        },
      });
      await this.notifications.sendOptionalEmail(
        {
          userId: relationship.caregiverId,
          title,
          body,
          dedupeKey,
          metadata: {
            type,
            relationshipId: relationship.id,
            patientId: relationship.patientId,
            actionUrl: `/care/patients/${relationship.patientId}`,
          },
        },
        isHelpRequest ? 'CAREGIVER_DOSE_HELP_REQUEST' : 'CAREGIVER_MISSED_DOSE',
      );
      await this.prisma.careEscalation.update({
        where: { id: escalation.id },
        data: {
          status: CareEscalationStatus.SENT,
          notifiedAt: new Date(),
          nextAttemptAt: null,
          lastError: null,
        },
      });
      await this.auditLogs.log({
        userId: relationship.caregiverId,
        action: isHelpRequest
          ? AuditAction.CARE_DOSE_HELP_ESCALATED
          : AuditAction.CARE_MISSED_DOSE_ESCALATED,
        entityType: 'CareEscalation',
        entityId: escalation.id,
        newValues: {
          relationshipId: relationship.id,
          doseLogId: escalation.doseLogId,
          channels: [NotificationChannel.LOCAL, NotificationChannel.EMAIL],
        },
      });
      return true;
    } catch (error) {
      const retryMinutes = Math.min(60, 2 ** escalation.attempts);
      const canRetry = escalation.attempts < MAX_DELIVERY_ATTEMPTS;
      await this.prisma.careEscalation.update({
        where: { id: escalation.id },
        data: {
          status: CareEscalationStatus.FAILED,
          claimedAt: null,
          nextAttemptAt: canRetry
            ? new Date(now.getTime() + retryMinutes * 60 * 1000)
            : null,
          lastError: error instanceof Error ? error.name : 'UnknownError',
        },
      });
      this.logger.warn(
        `Caregiver escalation ${escalation.id} delivery failed (${error instanceof Error ? error.name : 'UnknownError'})`,
      );
      return false;
    }
  }
}
