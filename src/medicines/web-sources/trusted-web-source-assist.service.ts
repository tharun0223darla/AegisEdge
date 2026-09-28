import { createHash } from 'crypto';
import { Injectable, Logger, Optional } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { CoreAIService } from '../../ai/core-ai.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CLINICAL_WEB_SEARCH_ALLOW_DOMAINS,
  REJECTED_WEB_SOURCE_DOMAINS,
  classifyWebClinicalSource,
  type WebClinicalSourceTier,
} from './trusted-web-source-policy';

type ClinicalDraftField = 'uses' | 'howToTake' | 'sideEffects' | 'warnings' | 'storage';

export interface WebSourceAssistDraft {
  uses?: string;
  howToTake?: string;
  sideEffects?: string[];
  warnings?: string;
  storage?: string;
  sourceNote?: string;
  unsafeDoseFields?: string[];
}

export interface WebSourceAssistSource {
  title: string;
  url: string;
  host: string;
  tier: WebClinicalSourceTier;
  reason: string;
  score?: number;
  snippet?: string;
  relevanceScore?: number;
  usableForClinicalFields: boolean;
}

export interface WebSourceAssistEvidence {
  field: ClinicalDraftField;
  sourceTitle: string;
  sourceUrl: string;
  snippet: string;
}

export interface WebSourceAssistResult {
  configured: boolean;
  provider: 'Tavily';
  query: string;
  generatedAt: string;
  message: string;
  sources: WebSourceAssistSource[];
  evidence: WebSourceAssistEvidence[];
  draft: WebSourceAssistDraft;
  warnings: string[];
  cached?: boolean;
  cacheId?: string;
  cacheExpiresAt?: string | null;
}
interface AssistInput {
  reviewId: string;
  saltProfile: {
    id: string;
    saltKey?: string | null;
    displayName?: string | null;
    ingredients?: unknown;
  };
  rawName?: string | null;
  composition?: string | null;
}

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

@Injectable()
export class TrustedWebSourceAssistService {
  private readonly logger = new Logger(TrustedWebSourceAssistService.name);
  private readonly cache = new Map<string, { createdAt: number; result: WebSourceAssistResult }>();

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    @Optional() private readonly ai?: CoreAIService,
  ) {}

  async assist(input: AssistInput, options?: { refresh?: boolean }): Promise<WebSourceAssistResult> {
    const query = this.buildQuery(input);
    const cacheKey = `${input.saltProfile.id}:${query}`;
    const queryHash = this.queryHash(input.saltProfile.id, query);
    const ttlMs = this.cacheTtlMs();
    const expiresAt = this.cacheExpiresAt(ttlMs);

    if (!options?.refresh) {
      const memoryCached = this.cache.get(cacheKey);
      if (memoryCached && Date.now() - memoryCached.createdAt < ttlMs) {
        return this.markCached(memoryCached.result, memoryCached.result.cacheId, memoryCached.result.cacheExpiresAt, 'memory');
      }

      const persisted = await this.readPersistedCache(queryHash);
      if (persisted) {
        const cachedResult = this.resultFromPersistedCache(persisted);
        this.cache.set(cacheKey, { createdAt: persisted.searchedAt.getTime(), result: cachedResult });
        return this.markCached(cachedResult, persisted.id, persisted.expiresAt?.toISOString() ?? null, 'database');
      }
    }

    const apiKey = this.config.get<string>('TAVILY_API_KEY')?.trim() || process.env.TAVILY_API_KEY?.trim();
    if (!apiKey) {
      return {
        configured: false,
        provider: 'Tavily',
        query,
        generatedAt: new Date().toISOString(),
        message: 'Tavily is not configured. Add TAVILY_API_KEY to enable trusted web-source search.',
        sources: [],
        evidence: [],
        draft: {},
        warnings: ['TAVILY_API_KEY is missing.'],
        cached: false,
        cacheExpiresAt: null,
      };
    }

    const warnings: string[] = [];
    const relevanceTerms = this.relevanceTerms(input);
    let searchResults: TavilyResult[];
    try {
      searchResults = await this.searchTavily(apiKey, query);
    } catch (error) {
      const result = this.tavilyUnavailableResult(query, error);
      return this.storePersistedCache(input, query, queryHash, cacheKey, result, 'FAILED', expiresAt, result.warnings[0]);
    }
    const sources = this.rankSources(searchResults, relevanceTerms);
    const clinicalSources = sources
      .filter((source) => source.usableForClinicalFields && (source.relevanceScore ?? 0) > 0)
      .slice(0, 5);

    if (!clinicalSources.length) {
      const result: WebSourceAssistResult = {
        configured: true,
        provider: 'Tavily',
        query,
        generatedAt: new Date().toISOString(),
        message: 'No trusted clinical source from the allowlist was found. Admin can retry with Force refresh or a corrected salt query later.',
        sources,
        evidence: [],
        draft: {},
        warnings: ['No allowlisted clinical source found.'],
        cached: false,
        cacheExpiresAt: null,
      };
      return this.storePersistedCache(input, query, queryHash, cacheKey, result, 'EMPTY', expiresAt);
    }

    const extracted = await this.extractTavily(apiKey, clinicalSources.map((source) => source.url));
    const evidence = this.buildEvidence(clinicalSources, extracted, relevanceTerms);
    const draft = await this.buildGroundedDraft(input, evidence, warnings);
    const result: WebSourceAssistResult = {
      configured: true,
      provider: 'Tavily',
      query,
      generatedAt: new Date().toISOString(),
      message: this.hasDraft(draft)
        ? 'Trusted web sources found. Draft filled for admin review; verify every field before saving.'
        : 'Trusted web sources found. Review the source snippets and write the final patient-safe summary before saving.',
      sources,
      evidence,
      draft,
      warnings,
      cached: false,
      cacheExpiresAt: null,
    };

    return this.storePersistedCache(input, query, queryHash, cacheKey, result, 'SUCCESS', expiresAt);
  }
  private cacheTtlMs() {
    const configured = Number(this.config.get<string>('WEB_SOURCE_ASSIST_CACHE_TTL_MS') ?? process.env.WEB_SOURCE_ASSIST_CACHE_TTL_MS ?? 7 * 24 * 60 * 60 * 1000);
    return Number.isFinite(configured) && configured > 0 ? configured : 7 * 24 * 60 * 60 * 1000;
  }

  private cacheExpiresAt(ttlMs: number) {
    return new Date(Date.now() + ttlMs);
  }

  private queryHash(saltProfileId: string, query: string) {
    return createHash('sha256').update(`${saltProfileId}\n${query}`).digest('hex');
  }

  private async readPersistedCache(queryHash: string) {
    const cached = await this.prisma.webSourceAssistCache.findUnique({ where: { queryHash } });
    if (!cached) return null;
    if (cached.expiresAt && cached.expiresAt.getTime() <= Date.now()) return null;
    return cached;
  }

  private resultFromPersistedCache(row: any): WebSourceAssistResult {
    const result = row.result as WebSourceAssistResult;
    return {
      configured: Boolean(result.configured),
      provider: 'Tavily',
      query: String(result.query ?? row.query),
      generatedAt: String(result.generatedAt ?? row.searchedAt.toISOString()),
      message: String(result.message ?? 'Cached trusted web-source assist result reused.'),
      sources: Array.isArray(result.sources) ? result.sources : [],
      evidence: Array.isArray(result.evidence) ? result.evidence : [],
      draft: result.draft && typeof result.draft === 'object' ? result.draft : {},
      warnings: Array.isArray(result.warnings) ? result.warnings.map(String) : [],
      cached: true,
      cacheId: row.id,
      cacheExpiresAt: row.expiresAt?.toISOString() ?? null,
    };
  }

  private markCached(result: WebSourceAssistResult, cacheId?: string, cacheExpiresAt?: string | null, source?: string): WebSourceAssistResult {
    const suffix = source ? ` Cached ${source} result reused; use Force refresh to search again.` : ' Cached result reused; use Force refresh to search again.';
    return {
      ...result,
      cached: true,
      cacheId: cacheId ?? result.cacheId,
      cacheExpiresAt: cacheExpiresAt ?? result.cacheExpiresAt ?? null,
      message: result.message.includes('Cached') ? result.message : `${result.message}${suffix}`,
    };
  }

  private async storePersistedCache(
    input: AssistInput,
    query: string,
    queryHash: string,
    cacheKey: string,
    result: WebSourceAssistResult,
    status: 'SUCCESS' | 'EMPTY' | 'FAILED',
    expiresAt: Date,
    lastError?: string,
  ): Promise<WebSourceAssistResult> {
    const draftedFields = this.draftedFields(result.draft);
    const row = await this.prisma.webSourceAssistCache.upsert({
      where: { queryHash },
      create: {
        saltProfileId: input.saltProfile.id,
        query,
        queryHash,
        provider: result.provider,
        status,
        result: this.cacheResultPayload(result) as any,
        sourceCount: result.sources.length,
        evidenceCount: result.evidence.length,
        draftedFields: draftedFields as any,
        warnings: result.warnings as any,
        lastError: lastError ?? null,
        expiresAt,
      },
      update: {
        query,
        provider: result.provider,
        status,
        result: this.cacheResultPayload(result) as any,
        sourceCount: result.sources.length,
        evidenceCount: result.evidence.length,
        draftedFields: draftedFields as any,
        warnings: result.warnings as any,
        lastError: lastError ?? null,
        searchedAt: new Date(),
        expiresAt,
      },
    });

    const resultWithCache = {
      ...result,
      cached: false,
      cacheId: row.id,
      cacheExpiresAt: row.expiresAt?.toISOString() ?? null,
    };
    this.cache.set(cacheKey, { createdAt: Date.now(), result: resultWithCache });
    return resultWithCache;
  }

  private cacheResultPayload(result: WebSourceAssistResult): WebSourceAssistResult {
    return {
      configured: result.configured,
      provider: result.provider,
      query: result.query,
      generatedAt: result.generatedAt,
      message: result.message,
      sources: result.sources,
      evidence: result.evidence,
      draft: result.draft,
      warnings: result.warnings,
      cached: false,
      cacheExpiresAt: result.cacheExpiresAt ?? null,
    };
  }

  private draftedFields(draft: WebSourceAssistDraft) {
    return Object.entries(draft ?? {})
      .filter(([key, value]) => key !== 'sourceNote' && key !== 'unsafeDoseFields' && (Array.isArray(value) ? value.length : Boolean(value)))
      .map(([key]) => key);
  }
  private buildQuery(input: AssistInput) {
    const name = input.saltProfile.displayName || input.rawName || input.saltProfile.saltKey || 'medicine';
    const ingredients = this.ingredientNames(input.saltProfile.ingredients).join(' ');
    const composition = input.composition ?? '';
    return [name, ingredients, composition, 'medicine uses dosage side effects warnings storage']
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  private ingredientNames(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value
      .map((item) => {
        if (!item || typeof item !== 'object') return '';
        const row = item as Record<string, unknown>;
        return String(row.name ?? row.ingredient ?? row.salt ?? '').trim();
      })
      .filter(Boolean);
  }

  private relevanceTerms(input: AssistInput) {
    const terms = [
      input.saltProfile.displayName,
      input.saltProfile.saltKey,
      input.rawName,
      input.composition,
      ...this.ingredientNames(input.saltProfile.ingredients),
    ]
      .flatMap((value) => String(value ?? '').split(/[+/,()\[\]-]/))
      .map((value) => value.trim().toLowerCase())
      .filter((value) => value.length >= 4)
      .filter((value) => !/^(medicine|uses?|dosage|side|effects?|warnings?|storage|tablet|capsule|syrup|injection|mg|mcg|ml|gm|g)$/i.test(value));

    return Array.from(new Set(terms));
  }

  private relevanceScore(text: string, terms: string[]) {
    const normalized = text.toLowerCase();
    return terms.reduce((score, term) => {
      if (!term) return score;
      if (normalized.includes(term)) return score + 2;
      const compactTerm = term.replace(/\s+/g, '');
      if (compactTerm.length >= 6 && normalized.replace(/\s+/g, '').includes(compactTerm)) return score + 1;
      return score;
    }, 0);
  }

  private hasRelevantText(text: string, terms: string[]) {
    if (!terms.length) return true;
    return this.relevanceScore(text, terms) > 0;
  }
  private async searchTavily(apiKey: string, query: string): Promise<TavilyResult[]> {
    const maxResults = Math.max(1, Math.min(Number(this.config.get<string>('WEB_SOURCE_SEARCH_MAX_RESULTS') ?? 8), 20));
    const searchDepth = this.config.get<string>('WEB_SOURCE_SEARCH_DEPTH') || 'advanced';
    const country = this.config.get<string>('WEB_SOURCE_SEARCH_COUNTRY') || 'india';

    const { data } = await firstValueFrom(
      this.http.post(
        'https://api.tavily.com/search',
        {
          query,
          topic: 'general',
          search_depth: searchDepth,
          chunks_per_source: 3,
          max_results: maxResults,
          include_domains: CLINICAL_WEB_SEARCH_ALLOW_DOMAINS,
          exclude_domains: REJECTED_WEB_SOURCE_DOMAINS,
          country,
          include_answer: false,
          include_raw_content: false,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` },
          timeout: 30_000,
        },
      ),
    );

    return Array.isArray(data?.results) ? data.results : [];
  }

  private rankSources(results: TavilyResult[], relevanceTerms: string[]): WebSourceAssistSource[] {
    const tierRank: Record<WebClinicalSourceTier, number> = {
      OFFICIAL: 0,
      MEDICAL_REFERENCE: 1,
      IDENTITY_ONLY: 2,
      REJECTED: 3,
    };

    return results
      .map((result) => {
        const url = String(result.url ?? '');
        const classification = classifyWebClinicalSource(url);
        const title = String(result.title ?? classification.host ?? 'Untitled source');
        const snippet = this.cleanSnippet(String(result.content ?? ''), 700);
        const relevanceScore = this.relevanceScore(`${title} ${snippet} ${url}`, relevanceTerms);
        return {
          title,
          url,
          host: classification.host,
          tier: classification.tier,
          reason: relevanceScore > 0 ? classification.reason : `${classification.reason} Result did not mention the target salt in title/snippet.`,
          score: typeof result.score === 'number' ? result.score : undefined,
          snippet,
          relevanceScore,
          usableForClinicalFields: classification.usableForClinicalFields && relevanceScore > 0,
        };
      })
      .filter((source) => source.url.startsWith('http'))
      .sort((a, b) => tierRank[a.tier] - tierRank[b.tier] || (b.relevanceScore ?? 0) - (a.relevanceScore ?? 0) || (b.score ?? 0) - (a.score ?? 0));
  }

  private async extractTavily(apiKey: string, urls: string[]) {
    if (!urls.length) return new Map<string, string>();

    try {
      const { data } = await firstValueFrom(
        this.http.post(
          'https://api.tavily.com/extract',
          {
            urls,
            extract_depth: 'basic',
            format: 'text',
            include_images: false,
            timeout: 20,
          },
          {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 40_000,
          },
        ),
      );

      const map = new Map<string, string>();
      for (const row of Array.isArray(data?.results) ? data.results : []) {
        if (row?.url && row?.raw_content) {
          map.set(String(row.url), String(row.raw_content));
        }
      }
      return map;
    } catch (error) {
      this.logger.warn(`Tavily extract failed: ${(error as Error).message}`);
      return new Map<string, string>();
    }
  }

  private buildEvidence(sources: WebSourceAssistSource[], extracted: Map<string, string>, relevanceTerms: string[]): WebSourceAssistEvidence[] {
    const evidence: WebSourceAssistEvidence[] = [];
    for (const source of sources) {
      const content = extracted.get(source.url) || source.snippet || '';
      if (!this.hasRelevantText(content || source.title, relevanceTerms)) continue;
      for (const field of ['uses', 'howToTake', 'sideEffects', 'warnings', 'storage'] as ClinicalDraftField[]) {
        const snippet = this.bestSnippet(content, field);
        if (!snippet || !this.hasRelevantText(snippet, relevanceTerms)) continue;
        evidence.push({
          field,
          sourceTitle: source.title,
          sourceUrl: source.url,
          snippet,
        });
      }
    }

    return evidence.slice(0, 20);
  }

  private bestSnippet(content: string, field: ClinicalDraftField) {
    const text = this.cleanSnippet(content, 9000);
    if (!text) return '';

    const patterns: Record<ClinicalDraftField, RegExp[]> = {
      uses: [/indications?\s*(?:and|&)?\s*usage/i, /used\s+to\s+treat/i, /treatment\s+of/i, /indicated\s+for/i],
      howToTake: [/dosage\s*(?:and|&)?\s*administration/i, /recommended\s+dose/i, /administer/i, /take\s+.*(?:daily|with|without)/i],
      sideEffects: [/adverse\s+reactions?/i, /side\s+effects?/i, /common\s+adverse/i],
      warnings: [/warnings?\s*(?:and|&)?\s*precautions?/i, /contraindications?/i, /boxed\s+warning/i],
      storage: [/storage\s*(?:and|&)?\s*handling/i, /store\s+at/i, /protect\s+from/i],
    };

    const lowerBound = Math.max(0, text.length - 1);
    for (const pattern of patterns[field]) {
      const match = pattern.exec(text);
      if (!match?.index && match?.index !== 0) continue;
      const start = Math.max(0, match.index - 220);
      const end = Math.min(lowerBound, match.index + 900);
      return this.cleanSnippet(text.slice(start, end), 1000);
    }

    return '';
  }

  private async buildGroundedDraft(
    input: AssistInput,
    evidence: WebSourceAssistEvidence[],
    warnings: string[],
  ): Promise<WebSourceAssistDraft> {
    if (!evidence.length) return {};
    if (!this.ai) {
      warnings.push('Local LLM is unavailable. A conservative source-snippet draft was prepared for admin review.');
      return this.fallbackDraftFromEvidence(evidence, warnings);
    }

    const sourceText = evidence
      .slice(0, 12)
      .map((item, index) => `[S${index + 1}] field=${item.field}\ntitle=${item.sourceTitle}\nurl=${item.sourceUrl}\nexcerpt=${item.snippet}`)
      .join('\n\n');

    const system = [
      'You create admin-review drafts for medicine patient guidance.',
      'Use only the supplied excerpts. Do not use outside knowledge.',
      'Paraphrase in fresh patient-friendly wording. Do not copy source sentences verbatim.',
      'If a field is not clearly supported, return an empty string or empty array.',
      'Do not invent doses, frequencies, durations, contraindications, or side effects.',
      'If dosage numbers are present, preserve them exactly and list the field in unsafeDoseFields for admin confirmation.',
      'Return strict JSON only.',
    ].join(' ');

    const prompt = `Medicine salt: ${input.saltProfile.displayName ?? input.rawName ?? input.saltProfile.saltKey}\n\nTrusted source excerpts:\n${sourceText}\n\nReturn JSON with keys: uses, howToTake, sideEffects, warnings, storage, sourceNote, unsafeDoseFields.`;

    try {
      const draft = await this.ai.generateJSON<WebSourceAssistDraft>(prompt, system);
      let cleaned = this.cleanDraft(draft);
      if (!this.hasDraft(cleaned)) {
        warnings.push('Local LLM returned no usable draft. A conservative source-snippet draft was prepared for admin review.');
        cleaned = this.fallbackDraftFromEvidence(evidence, warnings);
      }
      if (cleaned.unsafeDoseFields?.length) {
        warnings.push('Draft contains dose/frequency wording. Admin must verify numbers against the source before saving.');
      }
      return cleaned;
    } catch (error) {
      this.logger.warn(`Web-source draft generation failed: ${(error as Error).message}`);
      warnings.push('Local LLM draft failed. A conservative source-snippet draft was prepared for admin review.');
      return this.fallbackDraftFromEvidence(evidence, warnings);
    }
  }

  private fallbackDraftFromEvidence(
    evidence: WebSourceAssistEvidence[],
    warnings: string[],
  ): WebSourceAssistDraft {
    const output: WebSourceAssistDraft = {};
    const unsafeDoseFields = new Set<string>();
    const sourceNoteParts: string[] = [];

    const uses = this.firstEvidence(evidence, 'uses');
    if (uses) {
      output.uses = this.sourceBackedUsesSummary(uses.snippet);
      sourceNoteParts.push(`Uses drafted from: ${uses.sourceTitle}`);
    }

    const howToTake = this.firstEvidence(evidence, 'howToTake');
    if (howToTake) {
      output.howToTake = this.sourceBackedHowToTakeSummary(howToTake.snippet);
      unsafeDoseFields.add('howToTake');
      sourceNoteParts.push(`How-to-take draft needs admin dose check: ${howToTake.sourceTitle}`);
    }

    const sideEffects = this.firstEvidence(evidence, 'sideEffects');
    if (sideEffects) {
      const extracted = this.sourceBackedSideEffects(sideEffects.snippet);
      if (extracted.length) output.sideEffects = extracted;
      sourceNoteParts.push(`Side-effect draft checked from: ${sideEffects.sourceTitle}`);
    }

    const warningsEvidence = this.firstEvidence(evidence, 'warnings');
    if (warningsEvidence) {
      output.warnings = this.sourceBackedWarningSummary(warningsEvidence.snippet);
      sourceNoteParts.push(`Warnings drafted from: ${warningsEvidence.sourceTitle}`);
    }

    const storage = this.firstEvidence(evidence, 'storage');
    if (storage) {
      output.storage = this.sourceBackedStorageSummary(storage.snippet);
      sourceNoteParts.push(`Storage drafted from: ${storage.sourceTitle}`);
    }

    if (unsafeDoseFields.size) {
      output.unsafeDoseFields = Array.from(unsafeDoseFields);
      warnings.push('Fallback draft contains dose/frequency wording. Admin must verify it against the source before saving.');
    }

    if (sourceNoteParts.length) {
      output.sourceNote = sourceNoteParts.join('\n');
    }

    return this.cleanDraft(output);
  }

  private firstEvidence(evidence: WebSourceAssistEvidence[], field: ClinicalDraftField) {
    return evidence.find((item) => item.field === field && item.snippet.trim());
  }

  private sourceBackedUsesSummary(snippet: string) {
    const text = this.cleanSnippet(snippet, 1400);
    const usedMatch = /(?:is|are|was|were)?\s*used\s+as\s+([^.;]+)|used\s+for\s+([^.;]+)|treatment\s+of\s+([^.;]+)/i.exec(text);
    const bronchodilator = /bronchodilator/i.test(text);
    const asthma = /asthma/i.test(text);
    const copd = /\bCOPD\b|chronic obstructive pulmonary disease/i.test(text);
    const mucus = /mucus|mucociliary|viscosity|sputum/i.test(text);
    const parts: string[] = [];

    if (bronchodilator && (asthma || copd)) {
      parts.push(`The source describes this medicine as a bronchodilator used for ${[asthma ? 'bronchial asthma' : '', copd ? 'COPD' : ''].filter(Boolean).join(' and ')}.`);
    } else if (usedMatch) {
      parts.push(`Source summary: ${this.sentenceCase(this.cleanSnippet(usedMatch[0], 260))}.`);
    }

    if (mucus) {
      parts.push('The source also describes mucus-clearing effects, such as reducing mucus thickness and supporting mucociliary clearance.');
    }

    return this.cleanSnippet(parts.join(' ') || `Source summary: ${this.firstSentence(text)}`, 1000);
  }

  private sourceBackedHowToTakeSummary(snippet: string) {
    const text = this.cleanSnippet(snippet, 1400);
    const dose = /\b\d+(?:\.\d+)?\s*(?:mg|mcg|g|gm|ml|iu|units?)\b[^.;]*(?:once|twice|daily|day|orally|inhalation)?[^.;]*/i.exec(text)?.[0];
    if (dose) {
      return this.cleanSnippet(
        `Source excerpt describes: ${this.sentenceCase(dose)}. This must be checked by the admin against the source and the patient's prescription before saving as patient guidance.`,
        1000,
      );
    }
    return this.cleanSnippet(`Source summary: ${this.firstSentence(text)} Confirm the exact dose and schedule from the doctor's prescription.`, 1000);
  }

  private sourceBackedSideEffects(snippet: string) {
    const text = this.cleanSnippet(snippet, 1400);
    const effects = new Set<string>();
    if (/cardiovascular/i.test(text)) effects.add('Cardiovascular side effects were discussed in the source');
    if (/nausea/i.test(text)) effects.add('Nausea');
    if (/vomiting/i.test(text)) effects.add('Vomiting');
    if (/headache/i.test(text)) effects.add('Headache');
    if (/palpitation/i.test(text)) effects.add('Palpitations');
    return Array.from(effects).slice(0, 8);
  }

  private sourceBackedWarningSummary(snippet: string) {
    return this.cleanSnippet(`Source summary: ${this.firstSentence(snippet)} Review the original source before saving warnings for patient display.`, 1000);
  }

  private sourceBackedStorageSummary(snippet: string) {
    return this.cleanSnippet(`Source summary: ${this.firstSentence(snippet)}`, 700);
  }

  private firstSentence(text: string) {
    const cleaned = this.cleanSnippet(text, 1200);
    const sentence = cleaned.split(/(?<=[.!?])\s+/).find((part) => part.trim().length > 30);
    return this.cleanSnippet(sentence ?? cleaned, 320);
  }

  private sentenceCase(text: string) {
    const cleaned = this.cleanSnippet(text, 400);
    if (!cleaned) return cleaned;
    return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  private cleanDraft(draft: WebSourceAssistDraft): WebSourceAssistDraft {
    const output: WebSourceAssistDraft = {};
    if (typeof draft?.uses === 'string' && draft.uses.trim()) output.uses = this.cleanSnippet(draft.uses, 1200);
    if (typeof draft?.howToTake === 'string' && draft.howToTake.trim()) output.howToTake = this.cleanSnippet(draft.howToTake, 1200);
    if (typeof draft?.warnings === 'string' && draft.warnings.trim()) output.warnings = this.cleanSnippet(draft.warnings, 1200);
    if (typeof draft?.storage === 'string' && draft.storage.trim()) output.storage = this.cleanSnippet(draft.storage, 700);
    if (Array.isArray(draft?.sideEffects)) {
      output.sideEffects = draft.sideEffects.map((item) => this.cleanSnippet(String(item), 160)).filter(Boolean).slice(0, 12);
    }
    if (typeof draft?.sourceNote === 'string' && draft.sourceNote.trim()) output.sourceNote = this.cleanSnippet(draft.sourceNote, 700);
    if (Array.isArray(draft?.unsafeDoseFields)) {
      output.unsafeDoseFields = draft.unsafeDoseFields.map(String).filter(Boolean).slice(0, 5);
    }
    return output;
  }

  private tavilyUnavailableResult(query: string, error: unknown): WebSourceAssistResult {
    const warning = this.tavilyFailureWarning(error);
    this.logger.warn(`Tavily web-source search failed: ${warning}`);

    return {
      configured: true,
      provider: 'Tavily',
      query,
      generatedAt: new Date().toISOString(),
      message: 'Tavily web-source search could not be reached from this backend. Check internet, DNS, VPN/proxy, firewall, or API usage limits, then try again.',
      sources: [],
      evidence: [],
      draft: {},
      warnings: [warning],
    };
  }

  private tavilyFailureWarning(error: unknown) {
    const anyError = error as any;
    const code = String(anyError?.code ?? '').trim();
    const status = Number(anyError?.response?.status ?? 0);
    const responseMessage = String(
      anyError?.response?.data?.detail?.error ??
        anyError?.response?.data?.detail ??
        anyError?.response?.data?.error ??
        '',
    ).trim();
    const rawMessage = String(anyError?.message ?? 'unknown error').trim();

    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      return `DNS/network issue: this machine cannot resolve api.tavily.com (${code || rawMessage}).`;
    }

    if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNREFUSED') {
      return `Network issue while contacting Tavily (${code}).`;
    }

    if (status === 401) {
      return 'Tavily rejected the API key. Check TAVILY_API_KEY in backend .env and restart the backend.';
    }

    if (status === 429) {
      return 'Tavily rate limit reached. Wait and retry later.';
    }

    if (status === 432 || status === 433) {
      return 'Tavily usage limit or pay-as-you-go limit reached. Check Tavily dashboard credits/limits.';
    }

    if (status >= 400) {
      return `Tavily API returned HTTP ${status}${responseMessage ? `: ${responseMessage}` : ''}.`;
    }

    return rawMessage || 'Tavily request failed.';
  }
  private hasDraft(draft: WebSourceAssistDraft) {
    return Boolean(
      draft.uses ||
        draft.howToTake ||
        draft.warnings ||
        draft.storage ||
        draft.sideEffects?.length,
    );
  }

  private cleanSnippet(value: string, limit: number) {
    return value
      .replace(/\s+/g, ' ')
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim()
      .slice(0, limit)
      .trim();
  }
}