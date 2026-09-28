import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Module } from '@nestjs/common';
import { PatientExplanationService } from '../src/medicines/patient-explanations/patient-explanation.service';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

@Module({
  imports: [PrismaModule],
  providers: [PatientExplanationService],
})
class PatientExplanationCliModule {}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const app = await NestFactory.createApplicationContext(PatientExplanationCliModule, {
    logger: ['error', 'warn', 'log'],
  });
  const explanations = app.get(PatientExplanationService);
  const prisma = app.get(PrismaService);
  const dryRun = !process.argv.includes('--commit');
  const id = argValue('--id');
  const saltKey = argValue('--salt-key');
  const language = argValue('--language') ?? 'en';
  const limit = Number(argValue('--limit') ?? 10);

  try {
    if (id || saltKey) {
      const profile = id
        ? await prisma.saltProfile.findUnique({ where: { id } })
        : await prisma.saltProfile.findUnique({ where: { saltKey: saltKey! } });

      if (!profile) {
        throw new Error('Salt profile not found.');
      }

      const result = await explanations.generateForSaltProfile(profile.id, {
        dryRun,
        language,
      });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const batchLimit = Math.max(1, Math.min(limit, 500));
    const profiles = await prisma.saltProfile.findMany({
      where: {
        enrichmentStatus: { in: ['PARTIAL', 'COMPLETE'] },
        OR: [
          { patientExplanations: { none: { language } } },
          { patientExplanations: { some: { language, status: 'NEEDS_SOURCE' } } },
        ],
      },
      orderBy: { updatedAt: 'asc' },
      take: batchLimit,
      select: { id: true, saltKey: true, displayName: true },
    });
    const results: any[] = [];
    const failures: { saltProfileId: string; saltKey: string; error: string }[] = [];

    console.log(
      `Starting ${dryRun ? 'dry-run' : 'commit'} patient explanations for ${profiles.length} salts` +
        ` (limit=${batchLimit}, language=${language}).`,
    );

    for (const [index, profile] of profiles.entries()) {
      const startedAt = Date.now();
      console.log(`[${index + 1}/${profiles.length}] ${profile.saltKey} - ${profile.displayName}`);

      try {
        const result = await explanations.generateForSaltProfile(profile.id, { dryRun, language });
        results.push(result);
        const seconds = Math.round((Date.now() - startedAt) / 100) / 10;
        console.log(
          `  ${result.status} in ${seconds}s | fields=${Object.keys(result.fields.sourceRefs).join(', ') || 'none'}`,
        );
      } catch (error) {
        const message = (error as Error).message ?? 'unknown error';
        failures.push({ saltProfileId: profile.id, saltKey: profile.saltKey, error: message });
        console.error(`  FAILED: ${message}`);
      }
    }

    console.log(
      JSON.stringify(
        {
          dryRun,
          language,
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
            generatedFields: Object.keys(result.fields.sourceRefs),
            unsafeOmittedFields: result.fields.unsafeOmittedFields,
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