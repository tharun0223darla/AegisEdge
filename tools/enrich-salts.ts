import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { MedicineEnrichmentService } from '../src/medicines/enrichment/medicine-enrichment.service';
import { OpenFdaLabelService } from '../src/medicines/enrichment/openfda-label.service';
import { DailyMedLabelService } from '../src/medicines/enrichment/dailymed-label.service';
import { MedlinePlusConnectService } from '../src/medicines/enrichment/medlineplus-connect.service';
import { RxNormService } from '../src/medicines/enrichment/rxnorm.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

@Module({
  imports: [PrismaModule, HttpModule],
  providers: [
    MedicineEnrichmentService,
    OpenFdaLabelService,
    DailyMedLabelService,
    MedlinePlusConnectService,
    RxNormService,
  ],
})
class EnrichmentCliModule {}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const app = await NestFactory.createApplicationContext(EnrichmentCliModule, {
    logger: ['error', 'warn', 'log'],
  });
  const enrichment = app.get(MedicineEnrichmentService);
  const prisma = app.get(PrismaService);
  const dryRun = !process.argv.includes('--commit');
  const refresh = process.argv.includes('--refresh');
  const report = process.argv.includes('--report');
  const id = argValue('--id');
  const saltKey = argValue('--salt-key');
  const limit = Number(argValue('--limit') ?? 5);

  try {
    if (report) {
      console.log(JSON.stringify(await enrichment.coverageReport(), null, 2));
      return;
    }

    if (id || saltKey) {
      const profile = id
        ? await prisma.saltProfile.findUnique({ where: { id } })
        : await prisma.saltProfile.findUnique({ where: { saltKey: saltKey! } });

      if (!profile) {
        throw new Error('Salt profile not found.');
      }

      const result = await enrichment.enrichSaltProfile(profile.id, { dryRun, refresh });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const batchLimit = Math.max(1, Math.min(limit, 500));
    const profiles = await prisma.saltProfile.findMany({
      where: { enrichmentStatus: { in: ['NEEDS_SOURCE', 'PARTIAL'] } },
      orderBy: { updatedAt: 'asc' },
      take: batchLimit,
      select: { id: true, saltKey: true, displayName: true },
    });
    const results: Awaited<ReturnType<typeof enrichment.enrichSaltProfile>>[] = [];
    const failures: { saltProfileId: string; saltKey: string; error: string }[] = [];

    console.log(
      `Starting ${dryRun ? 'dry-run' : 'commit'} enrichment for ${profiles.length} salts` +
        ` (limit=${batchLimit}, refresh=${refresh}).`,
    );

    for (const [index, profile] of profiles.entries()) {
      const startedAt = Date.now();
      console.log(`[${index + 1}/${profiles.length}] ${profile.saltKey} - ${profile.displayName}`);

      try {
        const result = await enrichment.enrichSaltProfile(profile.id, { dryRun, refresh });
        results.push(result);
        const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
        console.log(
          `  ${result.status} in ${seconds}s | fields=${Object.keys(result.fields.sourceRefs).join(', ') || 'none'}`,
        );
      } catch (error) {
        const message = (error as Error).message ?? 'unknown error';
        failures.push({ saltProfileId: profile.id, saltKey: profile.saltKey, error: message });
        console.error(`  FAILED: ${message}`);
        if (!dryRun) {
          await enrichment.markEnrichmentFailure(profile.id, message);
        }
      }
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          refresh,
          count: results.length,
          failures: failures.length,
          statusCounts: results.reduce<Record<string, number>>((acc, result) => {
            acc[result.status] = (acc[result.status] ?? 0) + 1;
            return acc;
          }, {}),
          failureItems: failures.slice(0, 20),
          results: results.map((result) => ({
            saltProfileId: result.saltProfileId,
            saltKey: result.saltKey,
            displayName: result.displayName,
            status: result.status,
            sourcedFields: Object.keys(result.fields.sourceRefs),
            ingredients: result.ingredients.map((ingredient) => ({
              ingredient: ingredient.ingredient,
              normalizedIngredient: ingredient.normalizedIngredient,
              rxCui: ingredient.rxCui,
            })),
          })),
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
