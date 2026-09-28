import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { NestFactory } from '@nestjs/core';
import { DailyMedLabelService } from '../src/medicines/enrichment/dailymed-label.service';
import { IngredientNormalizer } from '../src/medicines/enrichment/ingredient-normalizer';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

@Module({
  imports: [PrismaModule, HttpModule],
  providers: [DailyMedLabelService],
})
class DailyMedIndexCliModule {}

function argValue(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function extractIngredients(value: unknown, fallback: string) {
  if (Array.isArray(value)) {
    const parsed = value
      .map((item: any) => String(item?.ingredient ?? item?.name ?? '').trim())
      .filter(Boolean);
    if (parsed.length) return parsed;
  }

  return fallback
    .split(/\s+\+\s+/)
    .map((part) => part.replace(/\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|ml|iu|units?|%)\b/gi, '').trim())
    .filter(Boolean);
}

async function main() {
  const app = await NestFactory.createApplicationContext(DailyMedIndexCliModule, {
    logger: ['error', 'warn', 'log'],
  });
  const prisma = app.get(PrismaService);
  const dailyMed = app.get(DailyMedLabelService);
  const normalizer = new IngredientNormalizer();
  const limit = Math.max(1, Math.min(Number(argValue('--limit') ?? 250), 2000));
  const status = argValue('--status') ?? 'NEEDS_SOURCE';
  const refresh = process.argv.includes('--refresh');

  try {
    const profiles = await prisma.saltProfile.findMany({
      where: { enrichmentStatus: status as any },
      orderBy: [{ lastEnrichmentAttemptAt: 'asc' }, { updatedAt: 'asc' }],
      take: limit,
      select: { saltKey: true, displayName: true, ingredients: true },
    });
    const ingredientMap = new Map<string, { ingredient: string; aliasesTried: string[] }>();

    for (const profile of profiles) {
      for (const ingredient of extractIngredients(profile.ingredients, profile.displayName)) {
        const normalized = normalizer.normalize(ingredient);
        const key = normalized.aliasesTried.join('|');
        if (!ingredientMap.has(key)) {
          ingredientMap.set(key, {
            ingredient,
            aliasesTried: normalized.aliasesTried,
          });
        }
      }
    }

    const ingredients = Array.from(ingredientMap.values());
    const results: Array<{ ingredient: string; status: string; setId?: string; title?: string }> = [];

    console.log(
      `Indexing DailyMed labels for ${ingredients.length} unique ingredients from ${profiles.length} ${status} salts` +
        ` (refresh=${refresh}).`,
    );

    for (const [index, item] of ingredients.entries()) {
      const startedAt = Date.now();
      const normalizedIngredient = item.aliasesTried[0] ?? item.ingredient.toLowerCase();
      console.log(`[${index + 1}/${ingredients.length}] ${item.ingredient} -> ${item.aliasesTried.join(', ')}`);

      const label = await dailyMed.fetchLabel({
        ingredient: item.ingredient,
        normalizedIngredient,
        aliasesTried: item.aliasesTried,
        refresh,
      });
      const seconds = Math.round((Date.now() - startedAt) / 100) / 10;

      if (label) {
        results.push({ ingredient: item.ingredient, status: 'INDEXED', setId: label.setId, title: label.title });
        console.log(`  INDEXED in ${seconds}s | setId=${label.setId} | ${label.title ?? 'DailyMed label'}`);
      } else {
        results.push({ ingredient: item.ingredient, status: 'NOT_FOUND' });
        console.log(`  NOT_FOUND in ${seconds}s`);
      }
    }

    console.log(
      JSON.stringify(
        {
          status,
          saltsRead: profiles.length,
          uniqueIngredients: ingredients.length,
          indexed: results.filter((result) => result.status === 'INDEXED').length,
          notFound: results.filter((result) => result.status === 'NOT_FOUND').length,
          sample: results.slice(0, 30),
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