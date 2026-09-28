import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogsService } from '../audit-logs/audit-logs.service';
import { MedicineImportEngine } from './import/medicine-import.engine';

@Injectable()
export class MedicineImportService {
  private readonly engine: MedicineImportEngine;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditLogs: AuditLogsService,
  ) {
    this.engine = new MedicineImportEngine(this.prisma);
  }

  async ingestUpload(
    adminId: string,
    file: Express.Multer.File,
    input: { datasetName?: string; datasetVersion?: string },
  ) {
    if (!file) {
      throw new BadRequestException('CSV file is required.');
    }

    const preview = await this.engine.ingestCsv({
      uploadedById: adminId,
      filePath: file.path,
      originalFileName: file.originalname,
      datasetName: input.datasetName,
      datasetVersion: input.datasetVersion,
    });

    await this.auditLogs.log({
      userId: adminId,
      action: 'CREATED',
      entityType: 'MedicineImportBatch',
      entityId: preview.batch.id,
      newValues: {
        originalFileName: file.originalname,
        datasetName: input.datasetName,
        datasetVersion: input.datasetVersion,
        totalRows: preview.batch.totalRows,
      },
    });

    return preview;
  }

  async list(page = 1, limit = 20) {
    const take = Math.max(1, Math.min(limit, 100));
    const skip = (Math.max(1, page) - 1) * take;

    const [total, batches] = await Promise.all([
      this.prisma.medicineImportBatch.count(),
      this.prisma.medicineImportBatch.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
        include: {
          uploadedBy: { select: { id: true, email: true, role: true } },
        },
      }),
    ]);

    return {
      data: batches,
      meta: { total, page, limit: take, totalPages: Math.ceil(total / take) },
    };
  }

  async preview(batchId: string) {
    await this.assertBatchExists(batchId);
    return this.engine.preview(batchId);
  }

  async commit(adminId: string, batchId: string, batchSize?: number) {
    await this.assertBatchExists(batchId);
    const result = await this.engine.commit(batchId, { batchSize });

    await this.auditLogs.log({
      userId: adminId,
      action: 'UPDATED',
      entityType: 'MedicineImportBatch',
      entityId: batchId,
      newValues: result,
    });

    return result;
  }

  async discard(adminId: string, batchId: string) {
    await this.assertBatchExists(batchId);
    const batch = await this.engine.discard(batchId);

    await this.auditLogs.log({
      userId: adminId,
      action: 'UPDATED',
      entityType: 'MedicineImportBatch',
      entityId: batchId,
      newValues: { status: 'DISCARDED' },
    });

    return batch;
  }

  private async assertBatchExists(batchId: string) {
    const exists = await this.prisma.medicineImportBatch.findUnique({
      where: { id: batchId },
      select: { id: true },
    });

    if (!exists) {
      throw new NotFoundException('Medicine import batch not found.');
    }
  }
}
