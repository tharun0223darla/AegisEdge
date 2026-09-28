import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type {
  ClinicalField,
  ClinicalSourceRef,
  LabelSectionMapping,
  OpenFdaLabelResult,
} from './medicine-enrichment.types';
import {
  isInjectionOnlyClinicalContent,
  isNonHumanClinicalContent,
} from './trusted-clinical-sources';

const FIELD_TO_SECTION: Record<ClinicalField, string> = {
  uses: 'indications_and_usage',
  howToTake: 'dosage_and_administration',
  sideEffects: 'adverse_reactions',
  warnings: 'warnings',
  storage: 'storage_and_handling',
};

@Injectable()
export class OpenFdaLabelService {
  private readonly logger = new Logger(OpenFdaLabelService.name);
  private readonly apiKey = process.env.OPENFDA_API_KEY?.trim();
  private readonly cacheDir =
    process.env.OPENFDA_CACHE_DIR?.trim() ??
    join(process.cwd(), 'data', 'enrichment-cache', 'openfda');
  private lastRequestAt = 0;
  private readonly minIntervalMs = Number(
    process.env.OPENFDA_MIN_INTERVAL_MS ?? 300,
  );

  constructor(private readonly http: HttpService) {}

  async fetchLabel(input: {
    ingredient: string;
    normalizedIngredient: string;
    aliasesTried?: string[];
    rxCui?: string;
    refresh?: boolean;
  }): Promise<OpenFdaLabelResult | null> {
    const candidates = this.lookupCandidates(
      input.normalizedIngredient,
      input.aliasesTried,
    );

    if (!input.refresh) {
      for (const candidate of candidates) {
        const cached = this.readCache(candidate);
        if (cached) return cached;
      }
    }

    for (const candidate of candidates) {
      await this.waitForRateLimit();

      const search = `openfda.generic_name:"${candidate}"`;
      const params: Record<string, string | number> = { search, limit: 1 };
      if (this.apiKey) params.api_key = this.apiKey;
      const sourceUrl = this.buildSourceUrl(search);

      try {
        const { data } = await firstValueFrom(
          this.http.get('https://api.fda.gov/drug/label.json', {
            params,
            timeout: 20000,
          }),
        );
        const label = data?.results?.[0];
        if (!label) continue;

        const result: OpenFdaLabelResult = {
          ingredient: input.ingredient,
          normalizedIngredient: candidate,
          rxCui: input.rxCui,
          label,
          fetchedAt: new Date().toISOString(),
          sourceUrl,
        };
        this.writeCache(candidate, result);
        this.writeCache(input.normalizedIngredient, result);
        return result;
      } catch (error) {
        const responseStatus = (error as any)?.response?.status;
        if (responseStatus === 404) continue;

        const message = (error as Error).message ?? 'unknown error';
        this.logger.warn(
          `openFDA label lookup failed for "${candidate}": ${message}`,
        );
      }
    }

    return null;
  }

  mapLabel(result: OpenFdaLabelResult): LabelSectionMapping {
    const sourceRefs: Partial<Record<ClinicalField, ClinicalSourceRef[]>> = {};
    const mapped: LabelSectionMapping = { sourceRefs };
    const label = result.label;
    const labelText = JSON.stringify(label);
    if (
      isNonHumanClinicalContent(labelText) ||
      this.isInjectionOnlyLabel(label)
    ) {
      this.logger.warn(
        `Rejected non-human or injection-only openFDA label for ${result.normalizedIngredient}`,
      );
      return mapped;
    }

    const uses = this.sectionText(label, FIELD_TO_SECTION.uses);
    if (uses) {
      mapped.uses = uses;
      sourceRefs.uses = [this.sourceRef(result, 'uses')];
    }

    const howToTake = this.sectionText(label, FIELD_TO_SECTION.howToTake);
    if (howToTake) {
      mapped.howToTake = howToTake;
      sourceRefs.howToTake = [this.sourceRef(result, 'howToTake')];
    }

    const adverse = this.sectionText(label, FIELD_TO_SECTION.sideEffects, 1800);
    const sideEffects = this.extractSideEffects(adverse);
    if (sideEffects.length) {
      mapped.sideEffects = sideEffects;
      sourceRefs.sideEffects = [this.sourceRef(result, 'sideEffects')];
    }

    const warnings = this.sectionText(label, FIELD_TO_SECTION.warnings);
    if (warnings) {
      mapped.warnings = warnings;
      sourceRefs.warnings = [this.sourceRef(result, 'warnings')];
    }

    const storage = this.sectionText(label, FIELD_TO_SECTION.storage, 700);
    if (storage) {
      mapped.storage = storage;
      sourceRefs.storage = [this.sourceRef(result, 'storage')];
    }

    return mapped;
  }

  private isInjectionOnlyLabel(label: Record<string, unknown>) {
    const openFda = this.asRecord(label.openfda);
    const routeValue = openFda?.route;
    const routes = Array.isArray(routeValue)
      ? routeValue
          .filter((route): route is string => typeof route === 'string')
          .map((route) => route.toLowerCase())
      : [];
    if (routes.length > 0) {
      const hasInjectionRoute = routes.some((route: string) =>
        /intravenous|intramuscular|injection|infusion/.test(route),
      );
      const hasNonInjectionRoute = routes.some(
        (route: string) =>
          !/intravenous|intramuscular|injection|infusion/.test(route),
      );
      if (hasInjectionRoute && !hasNonInjectionRoute) return true;
    }

    return isInjectionOnlyClinicalContent(
      [
        this.sectionText(label, FIELD_TO_SECTION.uses, 3000),
        this.sectionText(label, FIELD_TO_SECTION.howToTake, 3000),
      ].join(' '),
    );
  }

  private sourceRef(
    result: OpenFdaLabelResult,
    field: ClinicalField,
  ): ClinicalSourceRef {
    return {
      sourceType: 'openFDA',
      provider: 'openFDA drug label API',
      field,
      sourceField: FIELD_TO_SECTION[field],
      ingredient: result.ingredient,
      normalizedIngredient: result.normalizedIngredient,
      rxCui: result.rxCui,
      title: `openFDA ${FIELD_TO_SECTION[field]} for ${result.normalizedIngredient}`,
      url: result.sourceUrl,
      fetchedAt: result.fetchedAt,
      setId: this.optionalString(result.label.set_id),
      effectiveTime: this.optionalString(result.label.effective_time),
    };
  }

  private sectionText(
    label: Record<string, unknown>,
    section: string,
    limit = 1200,
  ) {
    const value = label[section];
    const text = Array.isArray(value)
      ? value.join('\n')
      : typeof value === 'string'
        ? value
        : '';
    return this.cleanText(text, limit);
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  }

  private optionalString(value: unknown) {
    return typeof value === 'string' ? value : undefined;
  }

  private cleanText(value: string, limit: number) {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= limit) return text;
    return `${text.slice(0, limit).replace(/\s+\S*$/, '')}...`;
  }

  private extractSideEffects(value: string) {
    if (!value) return [];

    return Array.from(
      new Set(
        value
          .split(/(?:[.;]\s+|\n+|•|- )/)
          .map((item) => this.cleanText(item, 180))
          .filter((item) => item.length >= 4)
          .slice(0, 12),
      ),
    );
  }

  private lookupCandidates(
    normalizedIngredient: string,
    aliasesTried?: string[],
  ) {
    return Array.from(
      new Set(
        [normalizedIngredient, ...(aliasesTried ?? [])]
          .map((item) => item.trim().toLowerCase())
          .filter(Boolean),
      ),
    );
  }
  private buildSourceUrl(search: string) {
    const url = new URL('https://api.fda.gov/drug/label.json');
    url.searchParams.set('search', search);
    url.searchParams.set('limit', '1');
    return url.toString();
  }

  private cachePath(normalizedIngredient: string) {
    const safeName = normalizedIngredient
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-');
    return join(this.cacheDir, `${safeName}.json`);
  }

  private readCache(normalizedIngredient: string): OpenFdaLabelResult | null {
    const path = this.cachePath(normalizedIngredient);
    if (!existsSync(path)) return null;

    try {
      return JSON.parse(readFileSync(path, 'utf8')) as OpenFdaLabelResult;
    } catch {
      return null;
    }
  }

  private writeCache(normalizedIngredient: string, result: OpenFdaLabelResult) {
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      writeFileSync(
        this.cachePath(normalizedIngredient),
        JSON.stringify(result, null, 2),
      );
    } catch (error) {
      const message = (error as Error).message ?? 'unknown error';
      this.logger.warn(`Unable to write openFDA cache: ${message}`);
    }
  }

  private async waitForRateLimit() {
    const elapsed = Date.now() - this.lastRequestAt;
    const waitMs = Math.max(0, this.minIntervalMs - elapsed);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastRequestAt = Date.now();
  }
}
