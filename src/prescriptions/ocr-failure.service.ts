import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface OcrFailureEntry {
  imageHash: string;
  rawOCR: string;
  finalOCR: string;
  confidence: number;
  reason: string;
  latency: number; // in milliseconds
  timestamp: string;
}

@Injectable()
export class OcrFailureService {
  private readonly logger = new Logger(OcrFailureService.name);
  private readonly failureFilePath = path.join(process.cwd(), 'uploads', 'ocr-failures.json');

  constructor() {
    this.ensureFailureFileExists();
  }

  /**
   * Log an OCR extraction failure.
   */
  logFailure(entry: Omit<OcrFailureEntry, 'timestamp'>): void {
    try {
      const failures = this.readFailureFile();
      const newEntry: OcrFailureEntry = {
        ...entry,
        timestamp: new Date().toISOString(),
      };
      failures.push(newEntry);
      this.writeFailureFile(failures);
      this.logger.warn(`OCR Extraction Failure logged for hash ${entry.imageHash}. Reason: ${entry.reason}`);
    } catch (error) {
      this.logger.error(`Failed to log OCR failure: ${error.message}`);
    }
  }

  private ensureFailureFileExists(): void {
    try {
      const dir = path.dirname(this.failureFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(this.failureFilePath)) {
        fs.writeFileSync(this.failureFilePath, JSON.stringify([]), 'utf8');
      }
    } catch (error) {
      this.logger.error(`Failed to initialize failure log file: ${error.message}`);
    }
  }

  private readFailureFile(): OcrFailureEntry[] {
    try {
      if (!fs.existsSync(this.failureFilePath)) {
        return [];
      }
      const raw = fs.readFileSync(this.failureFilePath, 'utf8');
      return JSON.parse(raw || '[]');
    } catch (error) {
      this.logger.warn(`Failed to parse failure file, resetting list: ${error.message}`);
      return [];
    }
  }

  private writeFailureFile(failures: OcrFailureEntry[]): void {
    try {
      fs.writeFileSync(this.failureFilePath, JSON.stringify(failures, null, 2), 'utf8');
    } catch (error) {
      this.logger.error(`Failed to write failures to log file: ${error.message}`);
    }
  }
}
