import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { IngredientNormalizer } from './ingredient-normalizer';
import type { RxNormResolution } from './medicine-enrichment.types';

@Injectable()
export class RxNormService {
  private readonly logger = new Logger(RxNormService.name);
  private readonly normalizer = new IngredientNormalizer();
  private readonly baseUrl = 'https://rxnav.nlm.nih.gov/REST/rxcui.json';

  constructor(private readonly http: HttpService) {}

  async resolveIngredient(ingredient: string): Promise<RxNormResolution> {
    const normalized = this.normalizer.normalize(ingredient);
    const fetchedAt = new Date().toISOString();
    let lastUrl = this.sourceUrl(normalized.normalized);

    for (const alias of normalized.aliasesTried) {
      const url = this.sourceUrl(alias);
      lastUrl = url;

      try {
        const { data } = await firstValueFrom(
          this.http.get(this.baseUrl, {
            params: { name: alias, search: 2 },
            timeout: 15000,
          }),
        );
        const rxCui = data?.idGroup?.rxnormId?.[0];
        if (!rxCui) continue;

        return {
          ingredient,
          normalizedIngredient: alias,
          aliasesTried: normalized.aliasesTried,
          rxCui,
          sourceRef: {
            sourceType: 'RxNorm',
            provider: 'RxNav',
            ingredient,
            normalizedIngredient: alias,
            rxCui,
            title: `RxNorm RxCUI lookup for ${alias}`,
            url,
            fetchedAt,
          },
        };
      } catch (error) {
        const message = (error as Error).message ?? 'unknown error';
        this.logger.warn(`RxNorm lookup failed for "${alias}": ${message}`);
      }
    }

    return {
      ingredient,
      normalizedIngredient: normalized.normalized,
      aliasesTried: normalized.aliasesTried,
      sourceRef: {
        sourceType: 'RxNorm',
        provider: 'RxNav',
        ingredient,
        normalizedIngredient: normalized.normalized,
        title: `RxNorm RxCUI lookup for ${normalized.normalized}`,
        url: lastUrl,
        fetchedAt,
      },
    };
  }

  private sourceUrl(name: string) {
    return `${this.baseUrl}?name=${encodeURIComponent(name)}&search=2`;
  }
}