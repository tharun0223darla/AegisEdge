import { Injectable, Logger } from '@nestjs/common';
import { CoreAIService } from '../ai/core-ai.service';
import { createHash } from 'crypto';

export interface VerificationResult {
  valid: boolean;
  brand: string;
  generic: string;
  strength: string;
  category: string;
}

interface CacheEntry {
  value: VerificationResult;
  timestamp: number;
}

class LruCache<K, V> {
  private map = new Map<K, V>();
  constructor(private readonly maxSize: number) {}
  
  get(key: K): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }
  
  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    }
    this.map.set(key, value);
    if (this.map.size > this.maxSize) {
      const firstKey = this.map.keys().next().value;
      if (firstKey !== undefined) {
        this.map.delete(firstKey);
      }
    }
  }

  delete(key: K): void {
    this.map.delete(key);
  }
}

@Injectable()
export class MedicineVerificationService {
  private readonly logger = new Logger(MedicineVerificationService.name);

  // Cache configuration
  private readonly isCacheEnabled: boolean;
  private readonly cacheMaxSize: number;
  private readonly cacheTtlMs: number;

  // Versions and metadata used for cache key generation
  private readonly modelName = 'llama3:latest';
  private readonly promptVersion = 'v2.0';
  private readonly schemaVersion = '1.0.0-release3';
  private readonly policyVersion = 'v2';
  private readonly parametersVersion = 'temp-0.0';
  private readonly normalizationVersion = 'v1';

  private readonly cache: LruCache<string, CacheEntry>;
  private readonly inFlight = new Map<string, Promise<VerificationResult>>();

  constructor(private coreAiService: CoreAIService) {
    this.isCacheEnabled = process.env.VERIFICATION_CACHE_ENABLED !== 'false';
    this.cacheMaxSize = Number(process.env.VERIFICATION_CACHE_MAX_SIZE || 1000);
    this.cacheTtlMs = Number(process.env.VERIFICATION_CACHE_TTL_MS || 86400000); // 24 hours default
    this.cache = new LruCache<string, CacheEntry>(this.cacheMaxSize);
  }

  /**
   * Verifies if a medicine candidate is a real pharmaceutical drug and extracts
   * brand name, generic composition, category, and strength using local AI.
   * Leverages SHA-256 context-safe key hashing, LRU eviction, and coalescing.
   */
  async verifyMedicine(
    name: string,
    metadata?: {
      strength?: string | null;
      dosageForm?: string | null;
      frequency?: string | null;
      evidenceHash?: string | null;
      userId?: string | null;
      documentId?: string | null;
    }
  ): Promise<VerificationResult> {
    const cleanName = name.toLowerCase().trim();
    const strength = (metadata?.strength || '').toLowerCase().trim();
    const dosageForm = (metadata?.dosageForm || '').toLowerCase().trim();
    const frequency = (metadata?.frequency || '').toLowerCase().trim();
    const evidenceHash = (metadata?.evidenceHash || '').trim();
    const userId = metadata?.userId || '';
    const docId = metadata?.documentId || '';

    // Construct canonical context string (contains all version tags)
    const rawKey = `name:${cleanName}|strength:${strength}|form:${dosageForm}|freq:${frequency}|evHash:${evidenceHash}|model:${this.modelName}|prompt:${this.promptVersion}|schema:${this.schemaVersion}|policy:${this.policyVersion}|params:${this.parametersVersion}|norm:${this.normalizationVersion}|user:${userId}|doc:${docId}`;
    
    // Hash key to prevent logging patient text or exposing raw keys
    const cacheKey = createHash('sha256').update(rawKey).digest('hex');

    // 1. Check Cache
    if (this.isCacheEnabled) {
      const entry = this.cache.get(cacheKey);
      if (entry) {
        if (Date.now() - entry.timestamp > this.cacheTtlMs) {
          this.logger.log(`Cache key expired: ${cacheKey}`);
          this.cache.delete(cacheKey);
        } else {
          this.logger.log(`Using cached AI verification for key: ${cacheKey}`);
          return entry.value;
        }
      }
    }

    // 2. Check In-Flight Coalescence
    let activePromise = this.inFlight.get(cacheKey);
    if (activePromise) {
      this.logger.log(`Coalescing verification request for key: ${cacheKey}`);
      return activePromise;
    }

    // 3. Initiate AI Verification
    this.logger.log(`AI verification requested for key: ${cacheKey}`);
    const prompt = `
You are a professional pharmaceutical verification system.
Analyze the following extracted medication text: "${name}"

Determine:
1. Is this a real, legitimate medicine name (or close misspelling of a brand/generic)? Respond "true" or "false" in the "valid" field.
2. What is the standard Brand name (e.g., "Pregamax-M")?
3. What is the generic composition/active ingredients (e.g., "Pregabalin + Methylcobalamin")?
4. What is the strength if written or implied (e.g., "75mg", "500mg")? If not specified, return null or empty string.
5. What is the therapeutic category/drug class (e.g., "Analgesic", "Neuropathic Pain", "Antidiabetic")?

Return a JSON object in this format EXACTLY:
{
  "valid": true,
  "brand": "",
  "generic": "",
  "strength": "",
  "category": ""
}
`;

    const runCallPromise = (async () => {
      try {
        const result = await this.coreAiService.generateJSON<VerificationResult>(
          prompt,
          'You are a strict clinical pharmacy agent responsible for verifying medicine names, identifying active chemical generic ingredients, resolving brand aliases, and identifying drug classes. Never hallucinate fake medications.',
        );

        // Do not cache malformed or invalid responses
        if (result && result.valid) {
          if (this.isCacheEnabled) {
            this.cache.set(cacheKey, {
              value: result,
              timestamp: Date.now(),
            });
            this.logger.log(`Cached successful AI verification for key: ${cacheKey}`);
          }
        } else {
          this.logger.warn(`AI verification returned invalid/malformed for key: ${cacheKey}`);
        }
        return result;
      } catch (error) {
        this.logger.error(`Failed to verify medicine with AI: ${error.message}`);
        throw error;
      } finally {
        // Clean up in-flight map
        this.inFlight.delete(cacheKey);
      }
    })();

    this.inFlight.set(cacheKey, runCallPromise);
    return runCallPromise;
  }
}
