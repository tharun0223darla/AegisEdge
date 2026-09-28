import { promises as fs } from 'fs';
import { join } from 'path';
import { CleanupService } from './cleanup.service';

describe('CleanupService package image retention', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('removes only stale package images with no database reference', async () => {
    jest.spyOn(fs, 'mkdir').mockResolvedValue(undefined);
    jest
      .spyOn(fs, 'readdir')
      .mockResolvedValue(['medicine.jpg', 'review.jpg', 'orphan.jpg'] as never);
    jest.spyOn(fs, 'stat').mockResolvedValue({
      isFile: () => true,
      mtimeMs: 0,
    } as Awaited<ReturnType<typeof fs.stat>>);
    const unlink = jest.spyOn(fs, 'unlink').mockResolvedValue(undefined);

    const prisma = {
      medicine: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { userStripImageUrl: '/api/medicines/package-image/medicine.jpg' },
          ]),
      },
      medicineDataReview: {
        findMany: jest
          .fn()
          .mockResolvedValue([
            { userStripImageUrl: 'https://api.test/package-images/review.jpg' },
          ]),
      },
    };
    const service = new CleanupService(prisma as never);

    await service.sweepOrphanPackageImages();

    expect(unlink).toHaveBeenCalledTimes(1);
    expect(unlink).toHaveBeenCalledWith(
      join(process.cwd(), 'uploads', 'package-images', 'orphan.jpg'),
    );
  });
});
