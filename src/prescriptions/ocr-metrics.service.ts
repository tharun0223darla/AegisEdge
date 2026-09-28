import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface OcrMetrics {
  success: number;
  recovery: number;
  empty: number;
  manualEdits: number;
  falsePositives: number;
  averageConfidence: number;
  totalRuns: number; // for computing rolling average
  topPrefixMatches?: Record<string, number>;
}

@Injectable()
export class OcrMetricsService {
  private readonly logger = new Logger(OcrMetricsService.name);
  private readonly metricsFilePath = path.join(process.cwd(), 'uploads', 'ocr-metrics.json');

  constructor() {
    this.ensureMetricsFileExists();
  }

  getMetrics(): OcrMetrics {
    try {
      if (!fs.existsSync(this.metricsFilePath)) {
        return this.getDefaultMetrics();
      }
      const raw = fs.readFileSync(this.metricsFilePath, 'utf8');
      return JSON.parse(raw || '{}') as OcrMetrics;
    } catch (error) {
      this.logger.warn(`Failed to read OCR metrics: ${error.message}. Returning defaults.`);
      return this.getDefaultMetrics();
    }
  }

  recordRun(params: {
    success: boolean;
    recoveryTriggered: boolean;
    isEmpty: boolean;
    confidence: number;
  }): void {
    try {
      const metrics = this.getMetrics();
      metrics.totalRuns += 1;

      if (params.success) metrics.success += 1;
      if (params.recoveryTriggered) metrics.recovery += 1;
      if (params.isEmpty) metrics.empty += 1;

      // Calculate rolling average confidence
      const count = metrics.totalRuns;
      metrics.averageConfidence = Math.round(
        ((metrics.averageConfidence * (count - 1)) + params.confidence) / count
      );

      this.saveMetrics(metrics);
      this.logger.log(`OCR telemetry run recorded: ${JSON.stringify(metrics)}`);
    } catch (error) {
      this.logger.error(`Failed to record OCR telemetry run: ${error.message}`);
    }
  }

  recordManualEdit(): void {
    try {
      const metrics = this.getMetrics();
      metrics.manualEdits += 1;
      this.saveMetrics(metrics);
      this.logger.log('OCR manual edit recorded in telemetry');
    } catch (error) {
      this.logger.error(`Failed to record manual edit telemetry: ${error.message}`);
    }
  }

  recordFalsePositive(): void {
    try {
      const metrics = this.getMetrics();
      metrics.falsePositives += 1;
      this.saveMetrics(metrics);
      this.logger.log('OCR false positive recorded in telemetry');
    } catch (error) {
      this.logger.error(`Failed to record false positive telemetry: ${error.message}`);
    }
  }

  recordPrefixMatch(prefix: string): void {
    try {
      const metrics = this.getMetrics();
      if (!metrics.topPrefixMatches) {
        metrics.topPrefixMatches = {};
      }
      metrics.topPrefixMatches[prefix] = (metrics.topPrefixMatches[prefix] || 0) + 1;
      this.saveMetrics(metrics);
      this.logger.log(`OCR prefix match recorded: "${prefix}"`);
    } catch (error) {
      this.logger.error(`Failed to record prefix match: ${error.message}`);
    }
  }

  private getDefaultMetrics(): OcrMetrics {
    return {
      success: 0,
      recovery: 0,
      empty: 0,
      manualEdits: 0,
      falsePositives: 0,
      averageConfidence: 0,
      totalRuns: 0,
      topPrefixMatches: {},
    };
  }

  private saveMetrics(metrics: OcrMetrics): void {
    try {
      fs.writeFileSync(this.metricsFilePath, JSON.stringify(metrics, null, 2), 'utf8');
    } catch (error) {
      this.logger.error(`Failed to save OCR metrics to disk: ${error.message}`);
    }
  }

  private ensureMetricsFileExists(): void {
    try {
      const dir = path.dirname(this.metricsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(this.metricsFilePath)) {
        this.saveMetrics(this.getDefaultMetrics());
      }
    } catch (error) {
      this.logger.error(`Failed to initialize OCR metrics path: ${error.message}`);
    }
  }
}
