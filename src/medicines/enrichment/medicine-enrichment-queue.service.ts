import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { MedicineEnrichmentService } from './medicine-enrichment.service';

interface QueueableSaltProfile {
  id?: string | null;
  enrichmentStatus?: string | null;
}

interface PendingEnrichmentJob {
  saltProfileId: string;
  reason: string;
}

const DEFAULT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class MedicineEnrichmentQueueService {
  private readonly logger = new Logger(MedicineEnrichmentQueueService.name);
  private readonly queued = new Set<string>();
  private readonly inFlight = new Set<string>();
  private readonly pending: PendingEnrichmentJob[] = [];
  private readonly enabled = process.env.MEDICINE_ENRICH_ON_SEARCH !== 'false';
  private readonly cooldownMs = Number(
    process.env.MEDICINE_ENRICH_ON_SEARCH_COOLDOWN_MS ?? DEFAULT_COOLDOWN_MS,
  );
  private readonly maxConcurrent = Math.max(
    1,
    Number(process.env.MEDICINE_ENRICH_ON_SEARCH_CONCURRENCY ?? 2),
  );
  private activeCount = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly enrichment: MedicineEnrichmentService,
  ) {}

  enqueueSaltProfiles(profiles: QueueableSaltProfile[], reason = 'search') {
    if (!this.enabled) return;

    const ids = Array.from(
      new Set(
        profiles
          .filter((profile) => profile.id && profile.enrichmentStatus !== 'COMPLETE')
          .map((profile) => profile.id as string),
      ),
    );

    for (const saltProfileId of ids) {
      if (this.queued.has(saltProfileId) || this.inFlight.has(saltProfileId)) continue;

      this.queued.add(saltProfileId);
      this.pending.push({ saltProfileId, reason });
    }

    this.drain();
  }

  private drain() {
    while (this.activeCount < this.maxConcurrent && this.pending.length > 0) {
      const job = this.pending.shift()!;
      this.queued.delete(job.saltProfileId);
      this.inFlight.add(job.saltProfileId);
      this.activeCount += 1;

      void this.run(job).finally(() => {
        this.activeCount -= 1;
        this.inFlight.delete(job.saltProfileId);
        this.drain();
      });
    }
  }

  private async run(job: PendingEnrichmentJob) {
    const profile = await this.prisma.saltProfile.findUnique({
      where: { id: job.saltProfileId },
      select: {
        id: true,
        saltKey: true,
        enrichmentStatus: true,
        lastEnrichmentAttemptAt: true,
      },
    });

    if (!profile) return;
    if (profile.enrichmentStatus === 'COMPLETE') return;
    if (!this.isCooldownExpired(profile.lastEnrichmentAttemptAt)) {
      this.logger.debug(
        `Background enrichment skipped for ${profile.saltKey}: cooldown active`,
      );
      return;
    }

    try {
      const result = await this.enrichment.enrichSaltProfile(profile.id, {
        dryRun: false,
        refresh: false,
      });
      this.logger.log(
        `Background enrichment (${job.reason}) completed for ${result.saltKey}: ${result.status}`,
      );
    } catch (error) {
      const message = (error as Error).message ?? 'unknown error';
      this.logger.warn(`Background enrichment failed for ${profile.saltKey}: ${message}`);
      await this.enrichment.markEnrichmentFailure(profile.id, message);
    }
  }

  private isCooldownExpired(lastAttemptAt?: Date | null) {
    if (!lastAttemptAt) return true;
    return Date.now() - lastAttemptAt.getTime() >= this.cooldownMs;
  }
}
