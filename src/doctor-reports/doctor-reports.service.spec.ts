import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DoctorReportAccessAction, DoctorReportSection } from '@prisma/client';
import { createHash } from 'node:crypto';
import { DoctorReportsService } from './doctor-reports.service';

const snapshot = {
  version: 1 as const,
  generatedAt: '2026-08-10T10:00:00.000Z',
  range: {
    start: '2026-08-01T00:00:00.000Z',
    end: '2026-08-10T23:59:59.999Z',
  },
  sections: [DoctorReportSection.MEDICATIONS],
  patient: {
    displayName: 'Asha Rao',
    dateOfBirth: null,
    bloodGroup: null,
    conditions: [],
  },
  limitations: [],
  disclaimer: 'Not medical advice.',
};

describe('DoctorReportsService', () => {
  const report = {
    id: 'report-1',
    userId: 'patient-1',
    title: 'Visit report',
    rangeStart: new Date(snapshot.range.start),
    rangeEnd: new Date(snapshot.range.end),
    sections: snapshot.sections,
    snapshot,
    snapshotVersion: 1,
    archivedAt: null,
    createdAt: new Date('2026-08-10T10:00:00.000Z'),
    shares: [],
  };
  const prisma = {
    doctorVisitReport: {
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    doctorReportShare: {
      count: jest.fn(),
      create: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    doctorReportShareAccess: { create: jest.fn() },
    $transaction: jest.fn(),
  };
  const composer = { compose: jest.fn() };
  const pdf = { render: jest.fn() };
  const audit = { log: jest.fn() };
  const config = { get: jest.fn() };

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.doctorVisitReport.findFirst.mockResolvedValue(report);
    prisma.doctorReportShare.count.mockResolvedValue(0);
    config.get.mockReturnValue('https://app.example.test');
    audit.log.mockResolvedValue(undefined);
  });

  function createService() {
    return new DoctorReportsService(
      prisma as never,
      config as unknown as ConfigService,
      composer as never,
      pdf as never,
      audit as never,
    );
  }

  it('returns a raw link once but stores only its SHA-256 token hash', async () => {
    let storedTokenHash: string | null = null;
    prisma.doctorReportShare.create.mockImplementation(
      ({ data }: { data: { tokenHash: string; expiresAt: Date } }) => {
        storedTokenHash = data.tokenHash;
        return Promise.resolve({
          id: 'share-1',
          reportId: report.id,
          tokenHash: data.tokenHash,
          expiresAt: data.expiresAt,
          revokedAt: null,
          lastAccessedAt: null,
          accessCount: 0,
          createdAt: new Date(),
        });
      },
    );

    const result = await createService().createShare('patient-1', report.id, {
      expiresInDays: 7,
      consentAcknowledged: true,
    });
    const token = result.shareUrl.split('#token=')[1];

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(storedTokenHash).not.toBe(token);
    expect(storedTokenHash).toBe(
      createHash('sha256').update(token).digest('hex'),
    );
    expect(result.shareUrl).toBe(
      `https://app.example.test/shared/report#token=${token}`,
    );
  });

  it('rejects expired shared links without recording access', async () => {
    prisma.doctorReportShare.findUnique.mockResolvedValue({
      id: 'share-1',
      expiresAt: new Date(Date.now() - 1_000),
      revokedAt: null,
      report,
    });

    await expect(
      createService().sharedView('a'.repeat(43)),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('records successful shared views without storing client identifiers', async () => {
    let recordedAccess:
      | {
          shareId: string;
          action: DoctorReportAccessAction;
          accessedAt: Date;
        }
      | undefined;
    prisma.doctorReportShare.findUnique.mockResolvedValue({
      id: 'share-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      report,
    });
    prisma.doctorReportShare.update.mockReturnValue({ operation: 'update' });
    prisma.doctorReportShareAccess.create.mockImplementation(
      ({
        data,
      }: {
        data: {
          shareId: string;
          action: DoctorReportAccessAction;
          accessedAt: Date;
        };
      }) => {
        recordedAccess = data;
        return { operation: 'create' };
      },
    );
    prisma.$transaction.mockResolvedValue([]);

    const result = await createService().sharedView('a'.repeat(43));

    expect(result.snapshot).toBe(snapshot);
    expect(recordedAccess).toMatchObject({
      shareId: 'share-1',
      action: DoctorReportAccessAction.VIEWED,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not record a PDF download when rendering fails', async () => {
    prisma.doctorReportShare.findUnique.mockResolvedValue({
      id: 'share-1',
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      report,
    });
    pdf.render.mockRejectedValue(new Error('PDF render failed'));

    await expect(createService().sharedPdf('a'.repeat(43))).rejects.toThrow(
      'PDF render failed',
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('soft-archives an owned report and revokes every active link atomically', async () => {
    prisma.doctorVisitReport.update.mockResolvedValue({});
    prisma.doctorReportShare.updateMany.mockResolvedValue({ count: 2 });
    prisma.$transaction.mockImplementation(
      (callback: (transaction: typeof prisma) => unknown) => callback(prisma),
    );

    const result = await createService().archive('patient-1', report.id);

    expect(prisma.doctorVisitReport.findFirst).toHaveBeenCalledWith({
      where: { id: report.id, userId: 'patient-1', archivedAt: null },
      select: { id: true },
    });
    expect(prisma.doctorVisitReport.update).toHaveBeenCalledWith({
      where: { id: report.id },
      data: { archivedAt: result.archivedAt },
    });
    expect(prisma.doctorReportShare.updateMany).toHaveBeenCalledWith({
      where: { reportId: report.id, revokedAt: null },
      data: { revokedAt: result.archivedAt },
    });
    expect(result.archivedAt).toBeInstanceOf(Date);
    expect(result).toMatchObject({ reportId: report.id, revokedLinks: 2 });
  });
});
