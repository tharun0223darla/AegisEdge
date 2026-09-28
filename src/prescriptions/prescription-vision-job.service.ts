import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  DocumentStatus,
  PrescriptionVisionJob,
  Prisma,
  VisionJobStatus,
} from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import {
  PrescriptionVisionProgressUpdate,
  PrescriptionVisionService,
} from './prescription-vision.service';

@Injectable()
export class PrescriptionVisionJobService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrescriptionVisionJobService.name);

  private readonly pollIntervalMs = Math.max(
    1_000,
    Number(process.env.VISION_JOB_POLL_INTERVAL_MS || 2_000),
  );

  private readonly staleWorkerMs = Math.max(
    60_000,
    Number(process.env.VISION_JOB_STALE_MS || 10 * 60_000),
  );

  private pollTimer?: NodeJS.Timeout;
  private workerBusy = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly visionService: PrescriptionVisionService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.requeueStaleJobs();

    this.pollTimer = setInterval(() => {
      void this.tick();
    }, this.pollIntervalMs);

    this.pollTimer.unref();
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
    }
  }

  async enqueue(userId: string, prescriptionId: string) {
    const prescription = await this.prisma.prescription.findFirst({
      where: {
        id: prescriptionId,
        userId,
      },
      select: {
        id: true,
        localPath: true,
      },
    });

    if (!prescription) {
      throw new NotFoundException('Prescription not found.');
    }

    if (!prescription.localPath) {
      throw new BadRequestException('Prescription file path is unavailable.');
    }

    const activeJob = await this.prisma.prescriptionVisionJob.findFirst({
      where: {
        prescriptionId,
        userId,
        status: {
          in: [VisionJobStatus.QUEUED, VisionJobStatus.PROCESSING],
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (activeJob) {
      return this.toPublicJob(activeJob);
    }

    const job = await this.prisma.prescriptionVisionJob.create({
      data: {
        prescriptionId,
        userId,
        status: VisionJobStatus.QUEUED,
        progress: 0,
        stage: 'queued',
      },
    });

    await this.prisma.prescription.updateMany({
      where: { id: prescriptionId, userId },
      data: { status: DocumentStatus.OCR_PROCESSING },
    });

    void this.tick();

    return this.toPublicJob(job);
  }

  async getJob(userId: string, jobId: string) {
    const job = await this.prisma.prescriptionVisionJob.findFirst({
      where: {
        id: jobId,
        userId,
      },
    });

    if (!job) {
      throw new NotFoundException('Prescription vision job not found.');
    }

    return this.toPublicJob(job);
  }

  async getLatestForPrescription(userId: string, prescriptionId: string) {
    const job = await this.prisma.prescriptionVisionJob.findFirst({
      where: {
        prescriptionId,
        userId,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (!job) {
      throw new NotFoundException('No prescription vision job was found.');
    }

    return this.toPublicJob(job);
  }

  private async tick(): Promise<void> {
    if (this.workerBusy) {
      return;
    }

    this.workerBusy = true;

    try {
      const candidate = await this.prisma.prescriptionVisionJob.findFirst({
        where: {
          status: VisionJobStatus.QUEUED,
        },
        orderBy: {
          createdAt: 'asc',
        },
        select: {
          id: true,
        },
      });

      if (!candidate) {
        return;
      }

      const workerId = randomUUID();
      const now = new Date();

      const claimed = await this.prisma.prescriptionVisionJob.updateMany({
        where: {
          id: candidate.id,
          status: VisionJobStatus.QUEUED,
        },
        data: {
          status: VisionJobStatus.PROCESSING,
          progress: 5,
          stage: 'starting',
          workerId,
          startedAt: now,
          heartbeatAt: now,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
          attemptCount: {
            increment: 1,
          },
        },
      });

      if (claimed.count !== 1) {
        return;
      }

      await this.processJob(candidate.id, workerId);
    } finally {
      this.workerBusy = false;

      setImmediate(() => {
        void this.tick();
      });
    }
  }

  private async processJob(jobId: string, workerId: string): Promise<void> {
    const job = await this.prisma.prescriptionVisionJob.findUnique({
      where: {
        id: jobId,
      },
      include: {
        prescription: {
          select: {
            id: true,
            localPath: true,
          },
        },
      },
    });

    if (
      !job ||
      job.status !== VisionJobStatus.PROCESSING ||
      job.workerId !== workerId
    ) {
      return;
    }

    const heartbeatTimer = setInterval(() => {
      void this.prisma.prescriptionVisionJob
        .updateMany({
          where: {
            id: jobId,
            workerId,
            status: VisionJobStatus.PROCESSING,
          },
          data: {
            heartbeatAt: new Date(),
          },
        })
        .catch(() => undefined);
    }, 30_000);

    heartbeatTimer.unref();

    try {
      const imagePath = isAbsolute(job.prescription.localPath)
        ? job.prescription.localPath
        : resolve(process.cwd(), job.prescription.localPath);

      await this.prisma.prescriptionVisionJob.updateMany({
        where: {
          id: jobId,
          workerId,
          status: VisionJobStatus.PROCESSING,
        },
        data: {
          progress: 10,
          stage: 'running_vision_pipeline',
          heartbeatAt: new Date(),
        },
      });

      const payload = await this.visionService.run({
        userId: job.userId,
        prescriptionId: job.prescriptionId,
        imagePath,
        onProgress: (update) =>
          this.updatePipelineProgress(jobId, workerId, update),
      });

      const { pipeline, ...reviewPayload } = payload;

      const resultPath = pipeline?.outputDirectory
        ? resolve(pipeline.outputDirectory, 'safe-review-payload.json')
        : null;

      await this.prisma.$transaction(async (tx) => {
        const completed = await tx.prescriptionVisionJob.updateMany({
          where: {
            id: jobId,
            workerId,
            status: VisionJobStatus.PROCESSING,
          },
          data: {
            status: VisionJobStatus.COMPLETED,
            progress: 100,
            stage: 'completed',
            resultPath,
            resultJson: reviewPayload as unknown as Prisma.InputJsonValue,
            errorCode: null,
            errorMessage: null,
            heartbeatAt: new Date(),
            completedAt: new Date(),
            workerId: null,
          },
        });
        if (completed.count === 1) {
          await tx.prescription.updateMany({
            where: {
              id: job.prescriptionId,
              userId: job.userId,
            },
            data: { status: DocumentStatus.OCR_PROCESSED },
          });
        }
      });

      this.logger.log(
        `Vision job ${jobId} completed with ` +
          `${payload.row_count} review row(s).`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await this.prisma.$transaction(async (tx) => {
        const failed = await tx.prescriptionVisionJob.updateMany({
          where: {
            id: jobId,
            workerId,
            status: VisionJobStatus.PROCESSING,
          },
          data: {
            status: VisionJobStatus.FAILED,
            stage: 'failed',
            errorCode: 'VISION_PIPELINE_FAILED',
            errorMessage: message.slice(0, 2_000),
            heartbeatAt: new Date(),
            completedAt: new Date(),
            workerId: null,
          },
        });
        if (failed.count === 1) {
          await tx.prescription.updateMany({
            where: {
              id: job.prescriptionId,
              userId: job.userId,
            },
            data: { status: DocumentStatus.FAILED },
          });
        }
      });

      this.logger.error(`Vision job ${jobId} failed: ${message}`);
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  private async requeueStaleJobs(): Promise<void> {
    const staleBefore = new Date(Date.now() - this.staleWorkerMs);

    const result = await this.prisma.prescriptionVisionJob.updateMany({
      where: {
        status: VisionJobStatus.PROCESSING,
        OR: [
          {
            heartbeatAt: {
              lt: staleBefore,
            },
          },
          {
            heartbeatAt: null,
            startedAt: {
              lt: staleBefore,
            },
          },
        ],
      },
      data: {
        status: VisionJobStatus.QUEUED,
        progress: 0,
        stage: 'requeued_after_stale_worker',
        workerId: null,
        startedAt: null,
        heartbeatAt: null,
      },
    });

    if (result.count > 0) {
      this.logger.warn(`Requeued ${result.count} stale vision job(s).`);
    }
  }

  private async updatePipelineProgress(
    jobId: string,
    workerId: string,
    update: PrescriptionVisionProgressUpdate,
  ): Promise<void> {
    const progress = Math.min(99, Math.max(0, Math.round(update.progress)));

    await this.prisma.prescriptionVisionJob.updateMany({
      where: {
        id: jobId,
        workerId,
        status: VisionJobStatus.PROCESSING,
      },
      data: {
        progress,
        stage: update.stage,
        heartbeatAt: new Date(),
      },
    });
  }

  private toPublicJob(job: PrescriptionVisionJob) {
    const {
      workerId: _workerId,
      userId: _userId,
      resultPath: _resultPath,
      resultJson,
      ...publicJob
    } = job;
    void _workerId;
    void _userId;
    void _resultPath;

    return {
      ...publicJob,
      resultJson: this.sanitizeResultJson(resultJson),
    };
  }

  private sanitizeResultJson(
    value: Prisma.JsonValue | null,
  ): Prisma.JsonValue | null {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const payload = value;

    if (!Array.isArray(payload.rows)) {
      return payload;
    }

    const rows = payload.rows.map((row) => {
      if (row === null || typeof row !== 'object' || Array.isArray(row)) {
        return row;
      }

      const rowObject = row;
      const evidence = rowObject.evidence;

      if (
        evidence === null ||
        typeof evidence !== 'object' ||
        Array.isArray(evidence)
      ) {
        return rowObject;
      }

      const evidenceObject = evidence;

      return {
        ...rowObject,
        evidence: {
          ...evidenceObject,
          name_image:
            typeof evidenceObject.name_image === 'string'
              ? this.toPublicUploadUrl(evidenceObject.name_image)
              : null,
          context_image:
            typeof evidenceObject.context_image === 'string'
              ? this.toPublicUploadUrl(evidenceObject.context_image)
              : null,
        },
      };
    });

    return {
      ...payload,
      rows,
    };
  }

  private toPublicUploadUrl(filePath: string): string | null {
    const uploadsRoot = resolve(process.cwd(), 'uploads');

    const absolutePath = resolve(filePath);
    const relativePath = relative(uploadsRoot, absolutePath);

    if (
      !relativePath ||
      relativePath.startsWith('..') ||
      isAbsolute(relativePath)
    ) {
      return null;
    }

    return `/uploads/${relativePath.split(sep).join('/')}`;
  }
}
