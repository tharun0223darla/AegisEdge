import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RxNormService } from './rxnorm.service';
import { OpenFdaLabelService } from './openfda-label.service';
import { DailyMedLabelService } from './dailymed-label.service';
import { MedlinePlusConnectService } from './medlineplus-connect.service';
import { hasAdminProtectedClinicalSource, hasTrustedClinicalSource } from './trusted-clinical-sources';
import type {
  ClinicalField,
  ClinicalSourceRef,
  LabelSectionMapping,
  RxNormResolution,
  SaltEnrichmentResult,
} from './medicine-enrichment.types';

const TARGET_FIELDS: ClinicalField[] = ['uses', 'howToTake', 'sideEffects', 'warnings', 'storage'];
const MAX_ENRICHMENT_BATCH_SIZE = 500;

@Injectable()
export class MedicineEnrichmentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rxNorm: RxNormService,
    private readonly openFda: OpenFdaLabelService,
    private readonly dailyMed: DailyMedLabelService,
    private readonly medlinePlus: MedlinePlusConnectService,
  ) {}

  async enrichSaltProfile(
    id: string,
    options?: { dryRun?: boolean; refresh?: boolean },
  ): Promise<SaltEnrichmentResult> {
    const profile = await this.prisma.saltProfile.findUnique({ where: { id } });
    if (!profile) {
      throw new NotFoundException('Salt profile not found');
    }

    const attemptAt = new Date();
    const ingredients = this.extractIngredients(profile.ingredients, profile.displayName);
    const rxNormResolutions: RxNormResolution[] = [];
    const mappedLabels: LabelSectionMapping[] = [];
    const patientEducationRefs: ClinicalSourceRef[] = [];

    for (const ingredient of ingredients) {
      const resolution = await this.rxNorm.resolveIngredient(ingredient);
      rxNormResolutions.push(resolution);

      const openFdaLabel = await this.openFda.fetchLabel({
        ingredient,
        normalizedIngredient: resolution.normalizedIngredient,
        aliasesTried: resolution.aliasesTried,
        rxCui: resolution.rxCui,
        refresh: options?.refresh,
      });
      const ingredientMappings: LabelSectionMapping[] = [];

      if (openFdaLabel) {
        ingredientMappings.push(this.openFda.mapLabel(openFdaLabel));
      }

      if (this.hasMissingTargetField(ingredientMappings)) {
        const dailyMedLabel = await this.dailyMed.fetchLabel({
          ingredient,
          normalizedIngredient: resolution.normalizedIngredient,
          aliasesTried: resolution.aliasesTried,
          rxCui: resolution.rxCui,
          refresh: options?.refresh,
        });

        if (dailyMedLabel) {
          ingredientMappings.push(this.dailyMed.mapLabel(dailyMedLabel));
        }
      }

      mappedLabels.push(...ingredientMappings);

      const patientLink = await this.medlinePlus.fetchLink({
        ingredient,
        normalizedIngredient: resolution.normalizedIngredient,
        rxCui: resolution.rxCui,
        refresh: options?.refresh,
      });

      if (patientLink) {
        patientEducationRefs.push(this.medlinePlus.sourceRef(patientLink));
      }
    }

    const merged = this.mergeMappings(mappedLabels);
    if (patientEducationRefs.length) {
      (merged.sourceRefs as Record<string, ClinicalSourceRef[]>).patientEducation = patientEducationRefs;
    }
    const sourceRefs = this.mergeSourceRefs(profile.sourceRefs, merged.sourceRefs);
    const fields = this.preserveAdminFields(profile, merged, sourceRefs);
    const status = this.enrichmentStatus(fields.sourceRefs);

    if (!options?.dryRun) {
      await this.prisma.saltProfile.update({
        where: { id: profile.id },
        data: {
          uses: fields.uses ?? null,
          howToTake: fields.howToTake ?? null,
          sideEffects: fields.sideEffects ?? [],
          warnings: fields.warnings ?? null,
          storage: fields.storage ?? null,
          sourceRefs: fields.sourceRefs as any,
          enrichmentStatus: status,
          lastEnrichmentAttemptAt: attemptAt,
          lastEnrichmentSuccessAt: status === 'NEEDS_SOURCE' ? profile.lastEnrichmentSuccessAt : attemptAt,
          lastEnrichmentError:
            status === 'NEEDS_SOURCE'
              ? 'No trusted clinical source fields found in RxNorm/openFDA/DailyMed/MedlinePlus.'
              : null,
        },
      });
    }

    return {
      saltProfileId: profile.id,
      saltKey: profile.saltKey,
      displayName: profile.displayName,
      status,
      fields,
      ingredients: rxNormResolutions,
      dryRun: Boolean(options?.dryRun),
    };
  }


  async markEnrichmentFailure(id: string, error: string) {
    await this.prisma.saltProfile.update({
      where: { id },
      data: {
        lastEnrichmentAttemptAt: new Date(),
        lastEnrichmentError: error.slice(0, 1000),
      },
    });
  }
  async enrichNext(options?: { limit?: number; dryRun?: boolean; refresh?: boolean }) {
    const limit = Math.max(1, Math.min(options?.limit ?? 10, MAX_ENRICHMENT_BATCH_SIZE));
    const profiles = await this.prisma.saltProfile.findMany({
      where: { enrichmentStatus: { in: ['NEEDS_SOURCE', 'PARTIAL'] } },
      orderBy: { updatedAt: 'asc' },
      take: limit,
    });
    const results: SaltEnrichmentResult[] = [];

    for (const profile of profiles) {
      results.push(
        await this.enrichSaltProfile(profile.id, {
          dryRun: options?.dryRun,
          refresh: options?.refresh,
        }),
      );
    }

    return results;
  }

  async coverageReport() {
    const [total, complete, partial, needsSource] = await Promise.all([
      this.prisma.saltProfile.count(),
      this.prisma.saltProfile.count({ where: { enrichmentStatus: 'COMPLETE' } }),
      this.prisma.saltProfile.count({ where: { enrichmentStatus: 'PARTIAL' } }),
      this.prisma.saltProfile.count({ where: { enrichmentStatus: 'NEEDS_SOURCE' } }),
    ]);

    return {
      total,
      COMPLETE: complete,
      PARTIAL: partial,
      NEEDS_SOURCE: needsSource,
      coveragePercent: total ? Math.round(((complete + partial) / total) * 10000) / 100 : 0,
      completePercent: total ? Math.round((complete / total) * 10000) / 100 : 0,
    };
  }

  private extractIngredients(value: unknown, fallback: string) {
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

  private mergeMappings(mappings: LabelSectionMapping[]): LabelSectionMapping {
    const merged: LabelSectionMapping = { sourceRefs: {} };

    for (const field of TARGET_FIELDS) {
      const values = mappings
        .map((mapping) => mapping[field])
        .filter((value) => !this.isEmpty(value));

      if (!values.length) continue;

      if (field === 'sideEffects') {
        (merged as any)[field] = Array.from(
          new Set(values.flatMap((value) => (Array.isArray(value) ? value : []))),
        ).slice(0, 16);
      } else {
        (merged as any)[field] = values
          .map((value) => String(value))
          .join('\n\n')
          .slice(0, 2400);
      }

      merged.sourceRefs[field] = mappings.flatMap(
        (mapping) => mapping.sourceRefs[field] ?? [],
      );
    }

    return merged;
  }

  private mergeSourceRefs(
    existingRefs: unknown,
    newRefs: Record<string, ClinicalSourceRef[] | undefined>,
  ) {
    const existing = this.asRecord(existingRefs);
    const merged: Record<string, unknown> = { ...existing };

    for (const [key, refs] of Object.entries(newRefs)) {
      if (!refs?.length || this.hasAdminSource(existing[key])) continue;
      merged[key] = refs;
    }

    return merged;
  }

  private preserveAdminFields(
    profile: any,
    mapped: LabelSectionMapping,
    sourceRefs: Record<string, unknown>,
  ): LabelSectionMapping {
    const output: LabelSectionMapping = { ...mapped, sourceRefs: sourceRefs as any };

    for (const field of TARGET_FIELDS) {
      if (!this.hasAdminSource(sourceRefs[field])) continue;
      (output as any)[field] = profile[field] ?? (field === 'sideEffects' ? [] : null);
    }

    return output;
  }

  private hasMissingTargetField(mappings: LabelSectionMapping[]) {
    if (!mappings.length) return true;
    return TARGET_FIELDS.some((field) =>
      mappings.every((mapping) => this.isEmpty((mapping as any)[field])),
    );
  }

  private enrichmentStatus(sourceRefs: Partial<Record<ClinicalField, unknown>>) {
    const sourcedCount = TARGET_FIELDS.filter((field) => this.hasTrustedSource(sourceRefs[field])).length;
    if (sourcedCount === TARGET_FIELDS.length) return 'COMPLETE' as const;
    if (sourcedCount > 0) return 'PARTIAL' as const;
    return 'NEEDS_SOURCE' as const;
  }

  private hasAdminSource(value: unknown) {
    return hasAdminProtectedClinicalSource(value);
  }

  private hasTrustedSource(value: unknown) {
    return hasTrustedClinicalSource(value);
  }

  private asRecord(value: unknown) {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  }

  private isEmpty(value: unknown) {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === 'string') return value.trim().length === 0;
    return false;
  }
}
