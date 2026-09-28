import { Injectable, Logger } from '@nestjs/common';
import { ScheduleFrequency } from '@prisma/client';

export interface StructuredSchedule {
  frequency: ScheduleFrequency | null;
  timesOfDay: string[];
  durationDays: number | null;
  dosage: string | null;
  instructions: string | null;
}

@Injectable()
export class PrescriptionContextService {
  private readonly logger = new Logger(PrescriptionContextService.name);

  /**
   * Infers structured dosage, frequency, and scheduling options from raw instructions or text tokens.
   */
  inferContext(
    rawInstructions?: string | null,
    rawDosage?: string | null,
    inferredFrequency?: string | null,
  ): StructuredSchedule {
    const textToAnalyze = `${rawDosage || ''} ${rawInstructions || ''}`.trim().toLowerCase();
    
    let frequency: ScheduleFrequency | null = null;
    let timesOfDay: string[] = [];
    let durationDays: number | null = null;
    let dosage = rawDosage || null;
    let instructions = rawInstructions || null;

    if (!textToAnalyze) {
      return { frequency, timesOfDay, durationDays, dosage, instructions };
    }

    // 1. Frequency Parsing Heuristics
    // Check 1-0-1 format
    if (/\b1-0-1\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.TWICE_DAILY;
      timesOfDay = ['08:00', '20:00'];
    } else if (/\b1-1-1\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.THREE_TIMES_DAILY;
      timesOfDay = ['08:00', '14:00', '20:00'];
    } else if (/\b1-0-0\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.DAILY;
      timesOfDay = ['08:00'];
    } else if (/\b0-0-1\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.DAILY;
      timesOfDay = ['22:00']; // Bedtime
    } else if (/\b(tid|tds|three\s+times)\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.THREE_TIMES_DAILY;
      timesOfDay = ['08:00', '14:00', '20:00'];
    } else if (/\b(bid|bd|twice\s+a\s+day|twice\s+daily)\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.TWICE_DAILY;
      timesOfDay = ['08:00', '20:00'];
    } else if (/\b(qid|four\s+times)\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.FOUR_TIMES_DAILY;
      timesOfDay = ['08:00', '12:00', '16:00', '20:00'];
    } else if (/\bhs\b/.test(textToAnalyze) || /\b(at\s+bedtime|bedtime|night)\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.DAILY;
      timesOfDay = ['22:00'];
    } else if (/\b(od|qd|daily|once\s+a\s+day|once\s+daily)\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.DAILY;
      timesOfDay = ['08:00'];
    } else if (/\b(weekly)\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.WEEKLY;
      timesOfDay = ['08:00'];
    } else if (/\b(sos|prn|as\s+needed)\b/.test(textToAnalyze)) {
      frequency = ScheduleFrequency.AS_NEEDED;
      timesOfDay = [];
    }

    // Default mapping fallback if parameter frequency is already supplied
    if (!frequency && inferredFrequency) {
      const parsedFreq = inferredFrequency.toUpperCase();
      if (Object.values(ScheduleFrequency).includes(parsedFreq as any)) {
        frequency = parsedFreq as ScheduleFrequency;
        timesOfDay =
          frequency === ScheduleFrequency.DAILY
            ? ['08:00']
            : frequency === ScheduleFrequency.TWICE_DAILY
            ? ['08:00', '20:00']
            : frequency === ScheduleFrequency.THREE_TIMES_DAILY
              ? ['08:00', '14:00', '20:00']
              : frequency === ScheduleFrequency.FOUR_TIMES_DAILY
                ? ['08:00', '12:00', '16:00', '20:00']
                : [];
      }
    }

    // 2. Duration Extraction Heuristic
    const durationMatch = /\b(?:for\s+)?(\d+)\s*(?:day|days|wk|wks|week|weeks|month|months)\b/i.exec(textToAnalyze);
    if (durationMatch) {
      const num = parseInt(durationMatch[1], 10);
      const unit = durationMatch[0].toLowerCase();
      if (unit.includes('week') || unit.includes('wk')) {
        durationDays = num * 7;
      } else if (unit.includes('month')) {
        durationDays = num * 30;
      } else {
        durationDays = num;
      }
    }

    // 3. Intake Units Standardizer
    if (/\b(?:cap|capsule|capsules)\b/.test(textToAnalyze)) {
      dosage = dosage ? `${dosage} (capsule)` : '1 capsule';
    } else if (/\b(?:tab|tablet|tablets)\b/.test(textToAnalyze)) {
      dosage = dosage ? `${dosage} (tablet)` : '1 tablet';
    }

    return {
      frequency,
      timesOfDay,
      durationDays,
      dosage,
      instructions: instructions || 'Take as directed by physician.',
    };
  }
}
