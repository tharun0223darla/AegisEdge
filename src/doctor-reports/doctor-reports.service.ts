import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuditAction, DoctorReportAccessAction, Prisma } from '@prisma/client';
import { createHash, randomBytes } from 'node:crypto';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { PrismaService } from '../prisma/prisma.service';
import type {
  ComposeDoctorReportDto,
  CreateDoctorReportShareDto,
} from './dto/doctor-report.dto';
import { DoctorReportComposerService } from './doctor-report-composer.service';
import { DoctorReportPdfService } from './doctor-report-pdf.service';
import type { DoctorReportSnapshot } from './doctor-report.types';

const MAX_ACTIVE_SHARES_PER_REPORT = 5;
const MAX_REPORTS_PER_PATIENT = 100;

type AuditContext = {
  ipAddress?: string;
  userAgent?: string;
};

@Injectable()
export class DoctorReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly composer: DoctorReportComposerService,
    private readonly pdf: DoctorReportPdfService,
    private readonly auditLogs: AuditLogsService,
  ) {}

  preview(userId: string, dto: ComposeDoctorReportDto) {
    return this.composer.compose(userId, dto);
  }

  async create(
    userId: string,
    dto: ComposeDoctorReportDto,
    auditContext: AuditContext = {},
  ) {
    const reportCount = await this.prisma.doctorVisitReport.count({
      where: { userId, archivedAt: null },
    });
    if (reportCount >= MAX_REPORTS_PER_PATIENT) {
      throw new BadRequestException(
        `Archive an older report before creating more than ${MAX_REPORTS_PER_PATIENT} reports.`,
      );
    }
    const composed = await this.composer.compose(userId, dto);
    const report = await this.prisma.doctorVisitReport.create({
      data: {
        userId,
        title: composed.title,
        rangeStart: new Date(composed.snapshot.range.start),
        rangeEnd: new Date(composed.snapshot.range.end),
        sections: composed.snapshot.sections,
        snapshot: composed.snapshot as unknown as Prisma.InputJsonValue,
      },
    });
    await this.auditLogs.log({
      userId,
      action: AuditAction.DOCTOR_REPORT_CREATED,
      entityType: 'DoctorVisitReport',
      entityId: report.id,
      newValues: {
        rangeStart: report.rangeStart.toISOString(),
        rangeEnd: report.rangeEnd.toISOString(),
        sections: report.sections,
        snapshotVersion: report.snapshotVersion,
      },
      ...auditContext,
    });
    return this.serializeReport(report);
  }

  async list(userId: string) {
    const reports = await this.prisma.doctorVisitReport.findMany({
      where: { userId, archivedAt: null },
      take: MAX_REPORTS_PER_PATIENT,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        rangeStart: true,
        rangeEnd: true,
        sections: true,
        snapshotVersion: true,
        createdAt: true,
        shares: {
          select: {
            id: true,
            expiresAt: true,
            revokedAt: true,
            lastAccessedAt: true,
            accessCount: true,
            createdAt: true,
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });
    return reports.map((report) => ({
      id: report.id,
      title: report.title,
      rangeStart: report.rangeStart,
      rangeEnd: report.rangeEnd,
      sections: report.sections,
      snapshotVersion: report.snapshotVersion,
      createdAt: report.createdAt,
      shares: report.shares.map((share) => this.serializeShare(share)),
    }));
  }

  async get(userId: string, reportId: string) {
    const report = await this.requireOwnerReport(userId, reportId);
    return this.serializeReport(report);
  }

  async archive(
    userId: string,
    reportId: string,
    auditContext: AuditContext = {},
  ) {
    const archivedAt = new Date();
    const result = await this.prisma.$transaction(async (transaction) => {
      const report = await transaction.doctorVisitReport.findFirst({
        where: { id: reportId, userId, archivedAt: null },
        select: { id: true },
      });
      if (!report) throw new NotFoundException('Doctor report not found');

      await transaction.doctorVisitReport.update({
        where: { id: report.id },
        data: { archivedAt },
      });
      const revoked = await transaction.doctorReportShare.updateMany({
        where: { reportId: report.id, revokedAt: null },
        data: { revokedAt: archivedAt },
      });
      return { reportId: report.id, revokedLinks: revoked.count };
    });

    await this.auditLogs.log({
      userId,
      action: AuditAction.DOCTOR_REPORT_ARCHIVED,
      entityType: 'DoctorVisitReport',
      entityId: result.reportId,
      newValues: {
        archivedAt: archivedAt.toISOString(),
        revokedLinks: result.revokedLinks,
      },
      ...auditContext,
    });
    return { ...result, archivedAt };
  }

  async createShare(
    userId: string,
    reportId: string,
    dto: CreateDoctorReportShareDto,
    auditContext: AuditContext = {},
  ) {
    await this.requireOwnerRecord(userId, reportId);
    const now = new Date();
    const activeShares = await this.prisma.doctorReportShare.count({
      where: {
        reportId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (activeShares >= MAX_ACTIVE_SHARES_PER_REPORT) {
      throw new BadRequestException(
        `A report can have at most ${MAX_ACTIVE_SHARES_PER_REPORT} active links. Revoke one before creating another.`,
      );
    }

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(now.getTime() + dto.expiresInDays * 86_400_000);
    const share = await this.prisma.doctorReportShare.create({
      data: {
        reportId,
        tokenHash: this.hashToken(token),
        expiresAt,
      },
    });
    await this.auditLogs.log({
      userId,
      action: AuditAction.DOCTOR_REPORT_SHARE_CREATED,
      entityType: 'DoctorReportShare',
      entityId: share.id,
      newValues: {
        reportId,
        expiresAt: expiresAt.toISOString(),
        consentAcknowledged: true,
      },
      ...auditContext,
    });
    return {
      share: this.serializeShare(share),
      shareUrl: this.buildShareUrl(token),
      message:
        'This private link is shown once. Send it only to the intended clinician.',
    };
  }

  async revokeShare(
    userId: string,
    reportId: string,
    shareId: string,
    auditContext: AuditContext = {},
  ) {
    await this.requireOwnerRecord(userId, reportId);
    const share = await this.prisma.doctorReportShare.findFirst({
      where: { id: shareId, reportId },
    });
    if (!share) throw new NotFoundException('Report link not found');
    const revokedAt = share.revokedAt ?? new Date();
    const updated = share.revokedAt
      ? share
      : await this.prisma.doctorReportShare.update({
          where: { id: share.id },
          data: { revokedAt },
        });
    if (!share.revokedAt) {
      await this.auditLogs.log({
        userId,
        action: AuditAction.DOCTOR_REPORT_SHARE_REVOKED,
        entityType: 'DoctorReportShare',
        entityId: share.id,
        newValues: { reportId, revokedAt: revokedAt.toISOString() },
        ...auditContext,
      });
    }
    return this.serializeShare(updated);
  }

  async accessHistory(userId: string, reportId: string) {
    const report = await this.prisma.doctorVisitReport.findFirst({
      where: { id: reportId, userId, archivedAt: null },
      select: {
        id: true,
        shares: {
          orderBy: { createdAt: 'desc' },
          select: {
            id: true,
            expiresAt: true,
            revokedAt: true,
            lastAccessedAt: true,
            accessCount: true,
            createdAt: true,
            accesses: {
              take: 50,
              orderBy: { accessedAt: 'desc' },
            },
          },
        },
      },
    });
    if (!report) throw new NotFoundException('Doctor report not found');
    return {
      reportId: report.id,
      shares: report.shares.map((share) => ({
        ...this.serializeShare(share),
        accesses: share.accesses.map((access) => ({
          id: access.id,
          action: access.action,
          accessedAt: access.accessedAt,
        })),
      })),
    };
  }

  async ownerPdf(userId: string, reportId: string) {
    const report = await this.prisma.doctorVisitReport.findFirst({
      where: { id: reportId, userId, archivedAt: null },
      select: { title: true, snapshot: true },
    });
    if (!report) throw new NotFoundException('Doctor report not found');
    return {
      fileName: this.fileName(report.title),
      content: await this.pdf.render(
        report.title,
        report.snapshot as unknown as DoctorReportSnapshot,
      ),
    };
  }

  async sharedView(token: string) {
    const share = await this.requireActiveShare(token);
    await this.recordAccess(share.id, DoctorReportAccessAction.VIEWED);
    return {
      title: share.report.title,
      createdAt: share.report.createdAt,
      expiresAt: share.expiresAt,
      snapshot: share.report.snapshot as unknown as DoctorReportSnapshot,
    };
  }

  async sharedPdf(token: string) {
    const share = await this.requireActiveShare(token);
    const result = {
      fileName: this.fileName(share.report.title),
      content: await this.pdf.render(
        share.report.title,
        share.report.snapshot as unknown as DoctorReportSnapshot,
      ),
    };
    await this.recordAccess(share.id, DoctorReportAccessAction.DOWNLOADED);
    return result;
  }

  private requireOwnerReport(userId: string, reportId: string) {
    return this.prisma.doctorVisitReport
      .findFirst({
        where: { id: reportId, userId, archivedAt: null },
        include: {
          shares: {
            orderBy: { createdAt: 'desc' },
            select: {
              id: true,
              expiresAt: true,
              revokedAt: true,
              lastAccessedAt: true,
              accessCount: true,
              createdAt: true,
            },
          },
        },
      })
      .then((report) => {
        if (!report) throw new NotFoundException('Doctor report not found');
        return report;
      });
  }

  private requireOwnerRecord(userId: string, reportId: string) {
    return this.prisma.doctorVisitReport
      .findFirst({
        where: { id: reportId, userId, archivedAt: null },
        select: { id: true },
      })
      .then((report) => {
        if (!report) throw new NotFoundException('Doctor report not found');
        return report;
      });
  }

  private async requireActiveShare(token: string) {
    const share = await this.prisma.doctorReportShare.findUnique({
      where: { tokenHash: this.hashToken(token) },
      include: { report: true },
    });
    const now = new Date();
    if (
      !share ||
      share.revokedAt ||
      share.expiresAt <= now ||
      share.report.archivedAt
    ) {
      throw new NotFoundException(
        'This report link is invalid or no longer available.',
      );
    }
    return share;
  }

  private recordAccess(shareId: string, action: DoctorReportAccessAction) {
    const now = new Date();
    return this.prisma.$transaction([
      this.prisma.doctorReportShare.update({
        where: { id: shareId },
        data: {
          accessCount: { increment: 1 },
          lastAccessedAt: now,
        },
      }),
      this.prisma.doctorReportShareAccess.create({
        data: { shareId, action, accessedAt: now },
      }),
    ]);
  }

  private serializeReport(report: {
    id: string;
    title: string;
    rangeStart: Date;
    rangeEnd: Date;
    sections: unknown;
    snapshot: unknown;
    snapshotVersion: number;
    createdAt: Date;
    shares?: Array<{
      id: string;
      expiresAt: Date;
      revokedAt: Date | null;
      lastAccessedAt: Date | null;
      accessCount: number;
      createdAt: Date;
    }>;
  }) {
    return {
      id: report.id,
      title: report.title,
      rangeStart: report.rangeStart,
      rangeEnd: report.rangeEnd,
      sections: report.sections,
      snapshot: report.snapshot as DoctorReportSnapshot,
      snapshotVersion: report.snapshotVersion,
      createdAt: report.createdAt,
      shares: report.shares?.map((share) => this.serializeShare(share)) ?? [],
    };
  }

  private serializeShare(share: {
    id: string;
    expiresAt: Date;
    revokedAt: Date | null;
    lastAccessedAt: Date | null;
    accessCount: number;
    createdAt: Date;
  }) {
    const status = share.revokedAt
      ? 'REVOKED'
      : share.expiresAt <= new Date()
        ? 'EXPIRED'
        : 'ACTIVE';
    return {
      id: share.id,
      status,
      expiresAt: share.expiresAt,
      revokedAt: share.revokedAt,
      lastAccessedAt: share.lastAccessedAt,
      accessCount: share.accessCount,
      createdAt: share.createdAt,
    };
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  private buildShareUrl(token: string) {
    const frontend = (this.config.get<string>('FRONTEND_URL') ?? '')
      .split(',')[0]
      .trim()
      .replace(/\/$/, '');
    if (!frontend) {
      throw new Error('FRONTEND_URL is required to create report links.');
    }
    return `${frontend}/shared/report#token=${token}`;
  }

  private fileName(title: string) {
    const safe = title
      .normalize('NFKD')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60)
      .toLowerCase();
    return `${safe || 'doctor-visit-report'}.pdf`;
  }
}
