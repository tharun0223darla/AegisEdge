import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import type {
  ClinicalField,
  ClinicalSourceRef,
  DailyMedLabelResult,
  LabelSectionMapping,
} from './medicine-enrichment.types';
import { isNonHumanClinicalContent } from './trusted-clinical-sources';

const FIELD_LABELS: Record<ClinicalField, RegExp[]> = {
  uses: [/indications?\s*(?:and|&)\s*usage/i, /indications?/i],
  howToTake: [/dosage\s*(?:and|&)\s*administration/i],
  sideEffects: [/adverse\s*reactions?/i],
  warnings: [/warnings?/i, /boxed\s*warning/i],
  storage: [
    /storage\s*(?:and|&)\s*handling/i,
    /how\s*supplied\s*\/\s*storage/i,
  ],
};

@Injectable()
export class DailyMedLabelService {
  private readonly logger = new Logger(DailyMedLabelService.name);
  private readonly baseUrl =
    'https://dailymed.nlm.nih.gov/dailymed/services/v2';
  private readonly cacheDir =
    process.env.DAILYMED_CACHE_DIR?.trim() ??
    join(process.cwd(), 'data', 'enrichment-cache', 'dailymed');
  private lastRequestAt = 0;
  private localIndexLoaded = false;
  private localIndex: DailyMedLabelResult[] = [];
  private readonly minIntervalMs = Number(
    process.env.DAILYMED_MIN_INTERVAL_MS ?? 600,
  );

  constructor(private readonly http: HttpService) {}

  async fetchLabel(input: {
    ingredient: string;
    normalizedIngredient: string;
    rxCui?: string;
    aliasesTried?: string[];
    refresh?: boolean;
  }): Promise<DailyMedLabelResult | null> {
    const cacheKey = input.rxCui || input.normalizedIngredient;
    const candidates = this.lookupCandidates(
      input.normalizedIngredient,
      input.aliasesTried,
    );
    if (!input.refresh) {
      for (const key of [cacheKey, ...candidates]) {
        const cached = this.readCache(key);
        if (cached) return cached;
      }

      const indexed = this.findLocalIndexedLabel({
        ...input,
        aliasesTried: candidates,
      });
      if (indexed) return indexed;
    }

    const set = await this.findSet({ ...input, aliasesTried: candidates });
    if (!set?.setId) return null;

    await this.waitForRateLimit();
    const xmlUrl = `${this.baseUrl}/spls/${encodeURIComponent(set.setId)}.xml`;

    try {
      const { data } = await firstValueFrom(
        this.http.get(xmlUrl, {
          responseType: 'text',
          timeout: 20000,
        }),
      );

      const result: DailyMedLabelResult = {
        ingredient: input.ingredient,
        normalizedIngredient: input.normalizedIngredient,
        rxCui: input.rxCui,
        setId: set.setId,
        title: set.title,
        xml: String(data ?? ''),
        fetchedAt: new Date().toISOString(),
        sourceUrl: xmlUrl,
      };
      this.writeCache(cacheKey, result);
      this.writeCache(result.normalizedIngredient, result);
      return result;
    } catch (error) {
      const message = (error as Error).message ?? 'unknown error';
      this.logger.warn(
        `DailyMed SPL fetch failed for "${input.normalizedIngredient}": ${message}`,
      );
      return null;
    }
  }

  mapLabel(result: DailyMedLabelResult): LabelSectionMapping {
    const sourceRefs: Partial<Record<ClinicalField, ClinicalSourceRef[]>> = {};
    const mapped: LabelSectionMapping = { sourceRefs };
    if (isNonHumanClinicalContent(`${result.title ?? ''}\n${result.xml}`)) {
      this.logger.warn(`Rejected non-human DailyMed label ${result.setId}`);
      return mapped;
    }
    const sections = this.extractSections(result.xml);

    for (const field of Object.keys(FIELD_LABELS) as ClinicalField[]) {
      const section = sections.find((item) =>
        FIELD_LABELS[field].some((pattern) => pattern.test(item.heading)),
      );
      if (!section?.text) continue;

      if (field === 'sideEffects') {
        const effects = this.extractSideEffects(section.text);
        if (!effects.length) continue;
        mapped.sideEffects = effects;
      } else {
        (mapped as any)[field] = this.cleanText(
          section.text,
          field === 'storage' ? 700 : 1200,
        );
      }

      sourceRefs[field] = [this.sourceRef(result, field, section.heading)];
    }

    return mapped;
  }

  private async findSet(input: {
    ingredient: string;
    normalizedIngredient: string;
    rxCui?: string;
    aliasesTried?: string[];
  }): Promise<{ setId: string; title?: string } | null> {
    const attempts: Array<Record<string, string>> = [];
    const candidates = this.lookupCandidates(input.normalizedIngredient, [
      input.ingredient,
      ...(input.aliasesTried ?? []),
    ]);
    if (input.rxCui) attempts.push({ rxcui: input.rxCui });
    for (const candidate of candidates) attempts.push({ drug_name: candidate });

    for (const params of attempts) {
      await this.waitForRateLimit();
      try {
        const { data } = await firstValueFrom(
          this.http.get(`${this.baseUrl}/spls.json`, {
            params,
            timeout: 15000,
          }),
        );
        const row = this.firstSetRow(data);
        if (row?.setId) return row;
      } catch (error) {
        const status = (error as any)?.response?.status;
        if (status !== 404) {
          const message = (error as Error).message ?? 'unknown error';
          this.logger.warn(
            `DailyMed search failed for ${JSON.stringify(params)}: ${message}`,
          );
        }
      }
    }

    return null;
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

  private findLocalIndexedLabel(input: {
    ingredient: string;
    normalizedIngredient: string;
    rxCui?: string;
    aliasesTried?: string[];
  }) {
    this.loadLocalIndex();
    const candidates = this.lookupCandidates(input.normalizedIngredient, [
      input.ingredient,
      ...(input.aliasesTried ?? []),
    ]);

    return (
      this.localIndex.find(
        (label) => input.rxCui && label.rxCui === input.rxCui,
      ) ??
      this.localIndex.find((label) =>
        candidates.some((candidate) =>
          this.labelMatchesCandidate(label, candidate),
        ),
      ) ??
      null
    );
  }

  private labelMatchesCandidate(label: DailyMedLabelResult, candidate: string) {
    const haystack = [
      label.normalizedIngredient,
      label.ingredient,
      label.title ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(candidate);
  }

  private loadLocalIndex() {
    if (this.localIndexLoaded) return;
    this.localIndexLoaded = true;

    try {
      if (!existsSync(this.cacheDir)) return;
      const labels: DailyMedLabelResult[] = [];
      for (const file of readdirSync(this.cacheDir)) {
        if (!file.endsWith('.json')) continue;
        try {
          const parsed = JSON.parse(
            readFileSync(join(this.cacheDir, file), 'utf8'),
          ) as DailyMedLabelResult;
          if (parsed?.setId && parsed?.xml) labels.push(parsed);
        } catch {
          // Ignore malformed local cache entries; live lookup can still run.
        }
      }
      this.localIndex = labels;
    } catch (error) {
      const message = (error as Error).message ?? 'unknown error';
      this.logger.warn(`Unable to read DailyMed local index: ${message}`);
    }
  }
  private firstSetRow(data: any): { setId: string; title?: string } | null {
    const rows = Array.isArray(data?.data)
      ? data.data
      : Array.isArray(data?.results)
        ? data.results
        : Array.isArray(data)
          ? data
          : [];

    const row = rows.find(
      (item: any) => item?.setid || item?.set_id || item?.setId,
    );
    if (!row) return null;

    return {
      setId: String(row.setid ?? row.set_id ?? row.setId),
      title: row.title ? String(row.title) : undefined,
    };
  }

  private sourceRef(
    result: DailyMedLabelResult,
    field: ClinicalField,
    sourceField: string,
  ): ClinicalSourceRef {
    return {
      sourceType: 'DailyMed',
      provider: 'DailyMed / National Library of Medicine',
      field,
      sourceField,
      ingredient: result.ingredient,
      normalizedIngredient: result.normalizedIngredient,
      rxCui: result.rxCui,
      title:
        result.title || `DailyMed label for ${result.normalizedIngredient}`,
      url: result.sourceUrl,
      fetchedAt: result.fetchedAt,
      setId: result.setId,
    };
  }

  private extractSections(xml: string) {
    const sections: Array<{ heading: string; text: string }> = [];
    const sectionRegex = /<section\b[\s\S]*?<\/section>/gi;
    const matches = xml.match(sectionRegex) ?? [];

    for (const section of matches) {
      const heading =
        this.attr(section, 'displayName') ||
        this.innerText(section, 'title') ||
        this.attr(section, 'code') ||
        '';
      const textBlock = this.innerXml(section, 'text');
      const text = this.cleanText(this.stripXml(textBlock), 2400);
      if (heading && text)
        sections.push({ heading: this.decodeXml(heading), text });
    }

    return sections;
  }

  private attr(value: string, name: string) {
    const match = new RegExp(`${name}="([^"]+)"`, 'i').exec(value);
    return match?.[1] ?? '';
  }

  private innerText(value: string, tag: string) {
    return this.stripXml(this.innerXml(value, tag));
  }

  private innerXml(value: string, tag: string) {
    const match = new RegExp(
      `<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,
      'i',
    ).exec(value);
    return match?.[1] ?? '';
  }

  private stripXml(value: string) {
    return this.decodeXml(value.replace(/<[^>]+>/g, ' '));
  }

  private decodeXml(value: string) {
    return value
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  }

  private cleanText(value: string, limit: number) {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!text) return '';
    if (text.length <= limit) return text;
    return `${text.slice(0, limit).replace(/\s+\S*$/, '')}...`;
  }

  private extractSideEffects(value: string) {
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

  private cachePath(key: string) {
    const safeName = key.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    return join(this.cacheDir, `${safeName}.json`);
  }

  private readCache(key: string): DailyMedLabelResult | null {
    const path = this.cachePath(key);
    if (!existsSync(path)) return null;

    try {
      return JSON.parse(readFileSync(path, 'utf8')) as DailyMedLabelResult;
    } catch {
      return null;
    }
  }

  private writeCache(key: string, result: DailyMedLabelResult) {
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      writeFileSync(this.cachePath(key), JSON.stringify(result, null, 2));
    } catch (error) {
      const message = (error as Error).message ?? 'unknown error';
      this.logger.warn(`Unable to write DailyMed cache: ${message}`);
    }
  }

  private async waitForRateLimit() {
    const elapsed = Date.now() - this.lastRequestAt;
    const waitMs = Math.max(0, this.minIntervalMs - elapsed);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.lastRequestAt = Date.now();
  }
}
