import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { promises as fs } from 'fs';
import { basename, join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * CleanupService
 * -----------------------------------------------------------------------------
 * Periodic housekeeping jobs that keep the database lean and the disk healthy.
 *
 * All jobs are wrapped in try/catch + structured logs so a single failure
 * never crashes the scheduler. They are also idempotent and safe to retry.
 */
@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  // Files older than this in /uploads/tmp/ are considered orphaned.
  private readonly TMP_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────
  // Daily 03:00 — purge revoked / expired refresh tokens
  // ───────────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'purge-refresh-tokens' })
  async purgeExpiredRefreshTokens(): Promise<void> {
    try {
      // Skip if model not present in current Prisma client (defensive).
      const client = this.prisma as unknown as {
        refreshToken?: {
          deleteMany: (args: unknown) => Promise<{ count: number }>;
        };
      };
      if (!client.refreshToken) {
        this.logger.debug(
          'RefreshToken model not found in Prisma client; skipping.',
        );
        return;
      }

      const now = new Date();
      const result = await client.refreshToken.deleteMany({
        where: {
          OR: [{ expiresAt: { lt: now } }, { revokedAt: { not: null } }],
        },
      });
      this.logger.log(`Purged ${result.count} expired/revoked refresh tokens.`);
    } catch (err) {
      this.logger.error(
        'Failed to purge refresh tokens',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  // ───────────────────────────────────────────────────────────
  // Hourly — sweep stale files in uploads/tmp/
  // ───────────────────────────────────────────────────────────
  @Cron(CronExpression.EVERY_HOUR, { name: 'sweep-tmp-uploads' })
  async sweepTmpUploads(): Promise<void> {
    const tmpDir = join(process.cwd(), 'uploads', 'tmp');
    try {
      await fs.mkdir(tmpDir, { recursive: true });
      const entries = await fs.readdir(tmpDir);
      const cutoff = Date.now() - this.TMP_TTL_MS;
      let removed = 0;

      for (const entry of entries) {
        const full = join(tmpDir, entry);
        try {
          const stat = await fs.stat(full);
          if (stat.isFile() && stat.mtimeMs < cutoff) {
            await fs.unlink(full);
            removed++;
          }
        } catch (innerErr) {
          this.logger.warn(
            `Could not inspect/delete ${full}: ${String(innerErr)}`,
          );
        }
      }

      if (removed > 0) {
        this.logger.log(`Swept ${removed} stale file(s) from ${tmpDir}.`);
      }
    } catch (err) {
      this.logger.error(
        'tmp upload sweep failed',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  // Hourly - remove abandoned package photos only after confirming that no
  // medicine or review record references them. Confirmed evidence is retained.
  @Cron(CronExpression.EVERY_HOUR, { name: 'sweep-orphan-package-images' })
  async sweepOrphanPackageImages(): Promise<void> {
    const packageDir = join(process.cwd(), 'uploads', 'package-images');
    try {
      await fs.mkdir(packageDir, { recursive: true });
      const [entries, medicines, reviews] = await Promise.all([
        fs.readdir(packageDir),
        this.prisma.medicine.findMany({
          where: { userStripImageUrl: { not: null } },
          select: { userStripImageUrl: true },
        }),
        this.prisma.medicineDataReview.findMany({
          where: { userStripImageUrl: { not: null } },
          select: { userStripImageUrl: true },
        }),
      ]);

      const referencedNames = new Set(
        [...medicines, ...reviews]
          .map((row) => this.storedFileName(row.userStripImageUrl))
          .filter((name): name is string => Boolean(name)),
      );
      const cutoff = Date.now() - this.TMP_TTL_MS;
      let removed = 0;

      for (const entry of entries) {
        if (referencedNames.has(entry)) continue;
        const fullPath = join(packageDir, entry);
        try {
          const stat = await fs.stat(fullPath);
          if (stat.isFile() && stat.mtimeMs < cutoff) {
            await fs.unlink(fullPath);
            removed++;
          }
        } catch (error) {
          this.logger.warn(
            `Could not inspect/delete orphan package image ${entry}: ${String(error)}`,
          );
        }
      }

      if (removed > 0) {
        this.logger.log(`Swept ${removed} orphan package image(s).`);
      }
    } catch (error) {
      this.logger.error(
        'Package image sweep failed',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  // ───────────────────────────────────────────────────────────
  // Weekly Sunday 04:00 — purge soft-deleted notifications > 90 days
  // ───────────────────────────────────────────────────────────
  @Cron('0 4 * * 0', { name: 'purge-old-notifications' })
  async purgeOldNotifications(): Promise<void> {
    try {
      const client = this.prisma as unknown as {
        notification?: {
          deleteMany: (args: unknown) => Promise<{ count: number }>;
        };
      };
      if (!client.notification) return;

      const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      const result = await client.notification.deleteMany({
        where: { createdAt: { lt: cutoff }, isRead: true },
      });
      this.logger.log(`Purged ${result.count} old read notifications.`);
    } catch (err) {
      this.logger.error(
        'Failed to purge old notifications',
        err instanceof Error ? err.stack : String(err),
      );
    }
  }

  private storedFileName(value: string | null): string | null {
    if (!value) return null;
    try {
      return basename(
        decodeURIComponent(new URL(value, 'http://local').pathname),
      );
    } catch {
      return basename(value);
    }
  }
}
