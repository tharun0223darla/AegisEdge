import { DocumentStatus, VisionJobStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PrescriptionVisionJobService } from './prescription-vision-job.service';
import { PrescriptionVisionService } from './prescription-vision.service';

describe('PrescriptionVisionJobService document status', () => {
  interface UpdateManyInput {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }

  const job = {
    id: 'job-1',
    userId: 'user-1',
    prescriptionId: 'rx-1',
    status: VisionJobStatus.PROCESSING,
    workerId: 'worker-1',
    prescription: {
      id: 'rx-1',
      localPath: 'uploads/prescriptions/test.png',
    },
  };

  function createHarness(run: jest.Mock) {
    const transactionJobUpdate = jest.fn((input: UpdateManyInput) => {
      void input;
      return Promise.resolve({ count: 1 });
    });
    const transactionPrescriptionUpdate = jest.fn((input: UpdateManyInput) => {
      void input;
      return Promise.resolve({ count: 1 });
    });
    const transactionClient = {
      prescriptionVisionJob: { updateMany: transactionJobUpdate },
      prescription: { updateMany: transactionPrescriptionUpdate },
    };
    const prisma = {
      prescriptionVisionJob: {
        findUnique: jest.fn().mockResolvedValue(job),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      $transaction: jest
        .fn()
        .mockImplementation(
          (callback: (tx: typeof transactionClient) => unknown) =>
            callback(transactionClient),
        ),
    };
    const service = new PrescriptionVisionJobService(
      prisma as unknown as PrismaService,
      { run } as unknown as PrescriptionVisionService,
    );
    return {
      service,
      transactionJobUpdate,
      transactionPrescriptionUpdate,
    };
  }

  it('atomically marks the job completed and prescription OCR processed', async () => {
    const harness = createHarness(
      jest.fn().mockResolvedValue({
        status: 'human_review_required',
        auto_confirmed_count: 0,
        row_count: 1,
        rows: [],
        pipeline: { outputDirectory: '', stdout: 'server-ocr:test' },
      }),
    );

    await (
      harness.service as unknown as {
        processJob(jobId: string, workerId: string): Promise<void>;
      }
    ).processJob('job-1', 'worker-1');

    expect(harness.transactionJobUpdate.mock.calls[0]?.[0].data.status).toBe(
      VisionJobStatus.COMPLETED,
    );
    expect(harness.transactionPrescriptionUpdate).toHaveBeenCalledWith({
      where: { id: 'rx-1', userId: 'user-1' },
      data: { status: DocumentStatus.OCR_PROCESSED },
    });
  });

  it('atomically marks the job and prescription failed when extraction throws', async () => {
    const harness = createHarness(
      jest.fn().mockRejectedValue(new Error('OCR service failed')),
    );

    await (
      harness.service as unknown as {
        processJob(jobId: string, workerId: string): Promise<void>;
      }
    ).processJob('job-1', 'worker-1');

    expect(harness.transactionJobUpdate.mock.calls[0]?.[0].data.status).toBe(
      VisionJobStatus.FAILED,
    );
    expect(harness.transactionPrescriptionUpdate).toHaveBeenCalledWith({
      where: { id: 'rx-1', userId: 'user-1' },
      data: { status: DocumentStatus.FAILED },
    });
  });
});
