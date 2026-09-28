import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import type { ClinicalSourceRef, MedlinePlusLinkResult } from './medicine-enrichment.types';

@Injectable()
export class MedlinePlusConnectService {
  private readonly logger = new Logger(MedlinePlusConnectService.name);
  private readonly baseUrl = 'https://connect.medlineplus.gov/service';
  private readonly rxNormCodeSystem = '2.16.840.1.113883.6.88';
  private readonly cacheDir =
    process.env.MEDLINEPLUS_CACHE_DIR?.trim() ??
    join(process.cwd(), 'data', 'enrichment-cache', 'medlineplus');
  private lastRequestAt = 0;
  private readonly minIntervalMs = Number(process.env.MEDLINEPLUS_MIN_INTERVAL_MS ?? 700);

  constructor(private readonly http: HttpService) {}

  async fetchLink(input: {
    ingredient: string;
    normalizedIngredient: string;
    rxCui?: string;
    refresh?: boolean;
  }): Promise<MedlinePlusLinkResult | null> {
    if (!input.rxCui) return null;

    if (!input.refresh) {
      const cached = this.readCache(input.rxCui);
      if (cached) return cached;
    }

    await this.waitForRateLimit();
    const params = {
      'mainSearchCriteria.v.cs': this.rxNormCodeSystem,
      'mainSearchCriteria.v.c': input.rxCui,
      'knowledgeResponseType': 'application/json',
      'informationRecipient.languageCode.c': 'en',
    };
    const sourceUrl = this.buildSourceUrl(params);

    try {
      const { data } = await firstValueFrom(
        this.http.get(this.baseUrl, { params, timeout: 15000 }),
      );
      const entry = this.firstEntry(data);
      if (!entry?.url) return null;

      const result: MedlinePlusLinkResult = {
        ingredient: input.ingredient,
        normalizedIngredient: input.normalizedIngredient,
        rxCui: input.rxCui,
        title: entry.title || `MedlinePlus information for ${input.normalizedIngredient}`,
        url: entry.url,
        summary: entry.summary,
        fetchedAt: new Date().toISOString(),
        sourceUrl,
      };
      this.writeCache(input.rxCui, result);
      return result;
    } catch (error) {
      const status = (error as any)?.response?.status;
      if (status === 404) return null;
      const message = (error as Error).message ?? 'unknown error';
      this.logger.warn(`MedlinePlus lookup failed for RxCUI ${input.rxCui}: ${message}`);
      return null;
    }
  }

  sourceRef(result: MedlinePlusLinkResult): ClinicalSourceRef {
    return {
      sourceType: 'MedlinePlus',
      provider: 'MedlinePlus Connect / National Library of Medicine',
      sourceField: 'patient_education_link',
      ingredient: result.ingredient,
      normalizedIngredient: result.normalizedIngredient,
      rxCui: result.rxCui,
      title: result.title,
      url: result.url,
      fetchedAt: result.fetchedAt,
    };
  }

  private firstEntry(data: any): { title?: string; url?: string; summary?: string } | null {
    const feed = data?.feed ?? data;
    const entries = Array.isArray(feed?.entry)
      ? feed.entry
      : Array.isArray(feed?.entries)
        ? feed.entries
        : [];
    const entry = entries[0];
    if (!entry) return null;

    const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
    const link = links.find((item: any) => item?.href) ?? links[0];
    const title = typeof entry.title === 'string' ? entry.title : entry.title?._value;
    const summary = typeof entry.summary === 'string' ? entry.summary : entry.summary?._value;

    return {
      title: title ? this.cleanText(title, 160) : undefined,
      url: link?.href ? String(link.href) : undefined,
      summary: summary ? this.cleanText(summary, 300) : undefined,
    };
  }

  private buildSourceUrl(params: Record<string, string>) {
    const url = new URL(this.baseUrl);
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    return url.toString();
  }

  private cleanText(value: string, limit: number) {
    const text = value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text.length <= limit) return text;
    return `${text.slice(0, limit).replace(/\s+\S*$/, '')}...`;
  }

  private cachePath(rxCui: string) {
    const safeName = rxCui.toLowerCase().replace(/[^a-z0-9-]+/g, '-');
    return join(this.cacheDir, `${safeName}.json`);
  }

  private readCache(rxCui: string): MedlinePlusLinkResult | null {
    const path = this.cachePath(rxCui);
    if (!existsSync(path)) return null;

    try {
      return JSON.parse(readFileSync(path, 'utf8')) as MedlinePlusLinkResult;
    } catch {
      return null;
    }
  }

  private writeCache(rxCui: string, result: MedlinePlusLinkResult) {
    try {
      mkdirSync(this.cacheDir, { recursive: true });
      writeFileSync(this.cachePath(rxCui), JSON.stringify(result, null, 2));
    } catch (error) {
      const message = (error as Error).message ?? 'unknown error';
      this.logger.warn(`Unable to write MedlinePlus cache: ${message}`);
    }
  }

  private async waitForRateLimit() {
    const elapsed = Date.now() - this.lastRequestAt;
    const waitMs = Math.max(0, this.minIntervalMs - elapsed);
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    this.lastRequestAt = Date.now();
  }
}
