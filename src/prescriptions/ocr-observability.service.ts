import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';

export interface ObservabilityEvent {
  timestamp: string;
  success: boolean;
  isEmpty: boolean;
  recoveryTriggered: boolean;
  latency: number;
  prefixMatched: boolean;
  accuracy: number; // 0 or 100
}

export interface DailySummary {
  date: string;
  totalRuns: number;
  emptyRuns: number;
  recoveryRuns: number;
  totalLatency: number;
  prefixMatches: number;
  correctRuns: number; // for accuracy calculation
}

export interface ObservabilityData {
  rolling_5000_events: ObservabilityEvent[];
  daily_summary: Record<string, DailySummary>;
}

@Injectable()
export class OcrObservabilityService {
  private readonly logger = new Logger(OcrObservabilityService.name);
  private readonly filePath = path.join(process.cwd(), 'uploads', 'ocr-observability.json');

  constructor() {
    this.ensureFileExists();
  }

  getData(): ObservabilityData {
    try {
      if (!fs.existsSync(this.filePath)) {
        return this.getDefaultData();
      }
      const raw = fs.readFileSync(this.filePath, 'utf8');
      return JSON.parse(raw || '{}') as ObservabilityData;
    } catch (error) {
      this.logger.warn(`Failed to read OCR observability data: ${error.message}`);
      return this.getDefaultData();
    }
  }

  recordEvent(event: Omit<ObservabilityEvent, 'timestamp'>) {
    try {
      const data = this.getData();
      const timestamp = new Date().toISOString();
      const newEvent: ObservabilityEvent = {
        ...event,
        timestamp,
      };

      // 1. Add to rolling 5000 events list
      data.rolling_5000_events.push(newEvent);
      if (data.rolling_5000_events.length > 5000) {
        data.rolling_5000_events.shift();
      }

      // 2. Update daily summary
      const dateKey = timestamp.split('T')[0];
      if (!data.daily_summary[dateKey]) {
        data.daily_summary[dateKey] = {
          date: dateKey,
          totalRuns: 0,
          emptyRuns: 0,
          recoveryRuns: 0,
          totalLatency: 0,
          prefixMatches: 0,
          correctRuns: 0,
        };
      }

      const summary = data.daily_summary[dateKey];
      summary.totalRuns += 1;
      summary.totalLatency += event.latency;
      if (event.isEmpty) summary.emptyRuns += 1;
      if (event.recoveryTriggered) summary.recoveryRuns += 1;
      if (event.prefixMatched) summary.prefixMatches += 1;
      if (event.accuracy >= 90) summary.correctRuns += 1; // count highly accurate runs

      this.saveData(data);
    } catch (error) {
      this.logger.error(`Failed to record observability event: ${error.message}`);
    }
  }

  private getDefaultData(): ObservabilityData {
    return {
      rolling_5000_events: [],
      daily_summary: {},
    };
  }

  private saveData(data: ObservabilityData) {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
      this.logger.error(`Failed to save OCR observability data: ${error.message}`);
    }
  }

  private ensureFileExists() {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      if (!fs.existsSync(this.filePath)) {
        this.saveData(this.getDefaultData());
      }
    } catch (error) {
      this.logger.error(`Failed to initialize OCR observability file: ${error.message}`);
    }
  }
}
