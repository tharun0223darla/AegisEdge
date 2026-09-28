import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { OcrEvidence } from './interfaces/ocr-evidence.interface';

export interface OcrCacheData {
  rawText: string;
  ocrSource: string;
  ocrConfidence: number;
  layout?: {
    rxRegion: string;
    instructionRegion: string;
    confidence: number;
    zones: Record<string, string>;
  };
  /** @deprecated Final candidates are user-specific and must never be reused. */
  candidates?: any[];
  evidence?: OcrEvidence[];
  cachedAt: string;
  cacheSchemaVersion?: string;
}

@Injectable()
export class OcrCacheService {
  private readonly logger = new Logger(OcrCacheService.name);
  private readonly cacheFilePath = path.join(
    process.cwd(),
    'uploads',
    'ocr-cache.json',
  );
  private readonly cacheTTLMs = this.readPositiveInt(
    'OCR_CACHE_TTL_MS',
    24 * 60 * 60 * 1000,
  );
  private readonly maxEntries = this.readPositiveInt(
    'OCR_CACHE_MAX_ENTRIES',
    250,
  );
  private readonly cacheVersion =
    process.env.OCR_CACHE_VERSION || 'ocr-evidence-v5-divider-continuity';

  constructor() {
    this.ensureCacheFileExists();
  }

  generateHash(buffer: Buffer): string {
    // Include a processing-version salt so code/config changes do not reuse
    // stale OCR evidence produced by an older pipeline.
    return crypto
      .createHash('sha256')
      .update(this.cacheVersion)
      .update(buffer)
      .digest('hex');
  }

  get(hash: string): OcrCacheData | null {
    try {
      const cache = this.readCacheFile();
      const entry = cache[hash];
      if (!entry) return null;

      const cachedTime = new Date(entry.cachedAt).getTime();
      if (
        !Number.isFinite(cachedTime) ||
        Date.now() - cachedTime > this.cacheTTLMs
      ) {
        this.delete(hash);
        return null;
      }
      if (
        entry.cacheSchemaVersion &&
        entry.cacheSchemaVersion !== this.cacheVersion
      ) {
        this.delete(hash);
        return null;
      }

      this.logger.debug(`OCR cache hit: ${hash.slice(0, 12)}`);
      // Old cache files may contain final candidates. Never expose them.
      return { ...entry, candidates: [] };
    } catch (error) {
      this.logger.warn(`OCR cache read failed: ${this.safeError(error)}`);
      return null;
    }
  }

  set(
    hash: string,
    data: Omit<OcrCacheData, 'cachedAt' | 'cacheSchemaVersion'>,
  ): void {
    try {
      const cache = this.readCacheFile();
      cache[hash] = {
        ...data,
        candidates: [],
        cachedAt: new Date().toISOString(),
        cacheSchemaVersion: this.cacheVersion,
      };
      this.evictOldest(cache);
      this.writeCacheFile(cache);
    } catch (error) {
      this.logger.warn(`OCR cache write failed: ${this.safeError(error)}`);
    }
  }

  private delete(hash: string): void {
    const cache = this.readCacheFile();
    if (!(hash in cache)) return;
    delete cache[hash];
    this.writeCacheFile(cache);
  }

  private evictOldest(cache: Record<string, OcrCacheData>): void {
    const entries = Object.entries(cache);
    if (entries.length <= this.maxEntries) return;
    entries
      .sort(
        (a, b) =>
          new Date(a[1].cachedAt).getTime() - new Date(b[1].cachedAt).getTime(),
      )
      .slice(0, entries.length - this.maxEntries)
      .forEach(([key]) => delete cache[key]);
  }

  private ensureCacheFileExists(): void {
    const dir = path.dirname(this.cacheFilePath);
    fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(this.cacheFilePath)) {
      fs.writeFileSync(this.cacheFilePath, '{}', {
        encoding: 'utf8',
        mode: 0o600,
      });
    }
  }

  private readCacheFile(): Record<string, OcrCacheData> {
    try {
      if (!fs.existsSync(this.cacheFilePath)) return {};
      const raw = fs.readFileSync(this.cacheFilePath, 'utf8');
      return JSON.parse(raw || '{}');
    } catch (error) {
      this.logger.warn(
        `Invalid OCR cache file; ignoring it: ${this.safeError(error)}`,
      );
      return {};
    }
  }

  private writeCacheFile(cache: Record<string, OcrCacheData>): void {
    const tempPath = `${this.cacheFilePath}.${process.pid}.tmp`;
    fs.writeFileSync(tempPath, JSON.stringify(cache), {
      encoding: 'utf8',
      mode: 0o600,
    });
    fs.renameSync(tempPath, this.cacheFilePath);
  }

  private readPositiveInt(name: string, fallback: number): number {
    const parsed = Number(process.env[name]);
    return Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : fallback;
  }

  private safeError(error: unknown): string {
    return (error instanceof Error ? error.message : String(error))
      .replace(/[\r\n]+/g, ' ')
      .slice(0, 140);
  }
}
