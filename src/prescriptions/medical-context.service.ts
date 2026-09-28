import { Injectable, Logger } from '@nestjs/common';

export interface MedicalContextResult {
  hasContext: boolean;
  form?: 'TABLET' | 'CAPSULE' | null;
  strength?: string | null;
  frequency?: string | null;
  durationDays?: number | null;
}

@Injectable()
export class MedicalContextService {
  private readonly logger = new Logger(MedicalContextService.name);

  /**
   * Infers clinical properties from raw neighboring text of an extracted token candidate.
   * If clinical parameters (form, strength, frequency shorthand, or duration) are found,
   * we return hasContext = true, which adds a +10 boost to confidence scoring.
   */
  inferContext(candidate: string, neighborText: string): MedicalContextResult {
    if (!neighborText) {
      return { hasContext: false };
    }

    const text = neighborText.toLowerCase().trim();
    let hasContext = false;
    let form: 'TABLET' | 'CAPSULE' | null = null;
    let strength: string | null = null;
    let frequency: string | null = null;
    let durationDays: number | null = null;

    // 1. Form Inference (Tablet / Capsule)
    if (/\b(tab|tablet|tablets|tabs)\b/i.test(text)) {
      form = 'TABLET';
      hasContext = true;
    } else if (/\b(cap|capsule|capsules|caps)\b/i.test(text)) {
      form = 'CAPSULE';
      hasContext = true;
    }

    // 2. Strength Inference (e.g. 40mg, 500 mg, 40, 500)
    const strengthMatch = /\b(\d+(?:\.\d+)?)\s*(mg|mcg|g|ml|tab|cap)?\b/i.exec(text);
    // Ignore small numbers like 1, 2, 3 which are likely dosages/quantities, and ignore dates
    if (strengthMatch) {
      const val = parseFloat(strengthMatch[1]);
      const unit = strengthMatch[2] || '';
      if (unit.toLowerCase() === 'mg' || unit.toLowerCase() === 'mcg' || val >= 10) {
        strength = `${val}${unit || 'mg'}`;
        hasContext = true;
      }
    }

    // 3. Frequency shorthand patterns (OD, BD, HS, 1-0-1 etc.)
    if (/\b(od|qd|daily|once\s+daily)\b/i.test(text) || /\b1-0-0\b/.test(text)) {
      frequency = 'DAILY';
      hasContext = true;
    } else if (/\b(bd|bid|twice\s+daily|twice\s+a\s+day)\b/i.test(text) || /\b1-0-1\b/.test(text)) {
      frequency = 'TWICE_DAILY';
      hasContext = true;
    } else if (/\b(tid|tds|three\s+times\s+daily)\b/i.test(text) || /\b1-1-1\b/.test(text)) {
      frequency = 'THREE_TIMES_DAILY';
      hasContext = true;
    } else if (/\b(qid|four\s+times\s+daily)\b/i.test(text) || /\b1-1-1-1\b/.test(text)) {
      frequency = 'FOUR_TIMES_DAILY';
      hasContext = true;
    } else if (/\b(hs|bedtime|at\s+night)\b/i.test(text) || /\b0-0-1\b/.test(text)) {
      frequency = 'DAILY'; // Bedtime is taken daily
      hasContext = true;
    } else if (/\b(sos|prn|as\s+needed)\b/i.test(text)) {
      frequency = 'AS_NEEDED';
      hasContext = true;
    }

    // 4. Duration patterns (e.g. for 5 days, 5 days, 1 week)
    const durationMatch = /\b(?:for\s+)?(\d+)\s*(?:day|days|wk|wks|week|weeks)\b/i.exec(text);
    if (durationMatch) {
      const num = parseInt(durationMatch[1], 10);
      const rawUnit = durationMatch[0].toLowerCase();
      if (rawUnit.includes('week') || rawUnit.includes('wk')) {
        durationDays = num * 7;
      } else {
        durationDays = num;
      }
      hasContext = true;
    }

    return {
      hasContext,
      form,
      strength,
      frequency,
      durationDays,
    };
  }
}
