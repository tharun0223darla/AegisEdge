import { Injectable, Logger } from '@nestjs/common';

export interface TokenScore {
  token: string;
  isMedicine: boolean;
  isDosage: boolean;
  isFrequencyOrInstruction: boolean;
  isNoise: boolean;
  score: number; // 0 to 100
}

@Injectable()
export class MedicalTokenService {
  private readonly logger = new Logger(MedicalTokenService.name);

  // Common noise keywords
  private static readonly NOISE_KEYWORDS = [
    'date', 'sex', 'age', 'gender', 'name', 'phone', 'address', 'email', 'patient', 'doctor', 
    'hospital', 'clinic', 'registration', 'reg', 'no', 'opd', 'ipd', 'signature', 'sign', 
    'bp', 'temp', 'pulse', 'spo2', 'weight', 'height', 'bmi', 'vitals', 'symptoms', 'diagnosis'
  ];

  // Specific noise patterns
  private static readonly NOISE_PATTERNS = [
    /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi, // Dates: 12/06/2026, 12-06-2026
    /\b\d{4}[/-]\d{1,2}[/-]\d{1,2}\b/gi, // Dates: 2026/06/12
    /\b\+?\d{1,4}[-.\s]?\(?\d{1,3}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/gi, // Phone numbers
    /\b(male|female|m|f|yrs?|years?|months?)\b/gi, // Gender, age keywords
    /\b\d{1,3}\s*(yr|yrs|year|years|m|f|male|female)\b/gi, // Age/gender combos (e.g. 59 yr, 25 F)
  ];

  // Common dosage strength indicators (e.g. 500mg, 5ml, 10mcg)
  private static readonly DOSAGE_PATTERNS = [
    /\b\d+(\.\d+)?\s*(mg|mcg|g|ml|tab|cap|tablet|capsule|puffs?)\b/gi,
    /\b\d+(\.\d+)?%\b/g, // Percentage solutions
  ];

  // Common scheduling frequency abbreviations
  private static readonly FREQUENCY_PATTERNS = [
    /\b(od|bd|bid|tds|tid|qid|hs|prn|sos|daily|weekly|monthly|twice\s+a\s+day|three\s+times\s+a\s+day)\b/gi,
    /\b[01]-[01]-[01]\b/g, // 1-0-1, 0-0-1 type notations
    /\b[01]-[01]-[01]-[01]\b/g,
  ];

  /**
   * Cleans OCR lines, removes extreme noise, and parses them into clinical candidate structures.
   */
  cleanAndValidateTokens(rawText: string): string[] {
    if (!rawText) return [];
    
    // Split by lines
    const lines = rawText.split(/\r?\n/);
    const validLines: string[] = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.length < 3) continue;

      // Check if the line is purely noise (e.g. "aa SexiA Date" or "59 we vr Ra")
      if (this.isPureNoise(trimmed)) {
        this.logger.log(`Filtering out noisy line: "${trimmed}"`);
        continue;
      }

      validLines.push(trimmed);
    }

    return validLines;
  }

  /**
   * Scores a single token (or short phrase) on whether it resembles a valid medicine name.
   */
  scoreToken(token: string): TokenScore {
    const cleanToken = token.trim();
    let isMedicine = false;
    let isDosage = false;
    let isFrequencyOrInstruction = false;
    let isNoise = false;
    let score = 0;

    // Check if token matches noise patterns
    const lower = cleanToken.toLowerCase();
    
    // Match against keywords
    const matchesNoiseKeyword = MedicalTokenService.NOISE_KEYWORDS.some(
      (keyword) => lower.includes(keyword) || lower === keyword
    );
    
    // Match against patterns
    const matchesNoisePattern = MedicalTokenService.NOISE_PATTERNS.some(
      (regex) => regex.test(cleanToken)
    );

    if (matchesNoiseKeyword || matchesNoisePattern) {
      isNoise = true;
      score = 0;
    } else {
      // Check if matches dosage patterns
      const matchesDosage = MedicalTokenService.DOSAGE_PATTERNS.some(
        (regex) => regex.test(cleanToken)
      );

      // Check if matches frequency patterns
      const matchesFrequency = MedicalTokenService.FREQUENCY_PATTERNS.some(
        (regex) => regex.test(cleanToken)
      );

      if (matchesDosage) {
        isDosage = true;
        score = 80;
      } else if (matchesFrequency) {
        isFrequencyOrInstruction = true;
        score = 80;
      } else {
        // Medicine heuristic: Capitalized, has no digits, length between 3 and 25
        const isCapitalized = /^[A-Z][a-zA-Z]*$/.test(cleanToken);
        const hasDigits = /\d/.test(cleanToken);
        const hasSpecialChars = /[^a-zA-Z\s-]/.test(cleanToken);

        if (isCapitalized && !hasDigits && !hasSpecialChars && cleanToken.length >= 3 && cleanToken.length <= 25) {
          isMedicine = true;
          score = 75;
        } else if (!hasDigits && cleanToken.length >= 4 && cleanToken.length <= 30) {
          isMedicine = true;
          score = 50; // Moderate score
        }
      }
    }

    return {
      token: cleanToken,
      isMedicine,
      isDosage,
      isFrequencyOrInstruction,
      isNoise,
      score,
    };
  }

  private isPureNoise(line: string): boolean {
    const lower = line.toLowerCase();
    
    // Check if line consists mostly of noise patterns or garbage chars
    // e.g. "aa SexiA Date"
    if (lower.includes('sex') && lower.includes('date')) return true;
    if (lower.includes('age') && lower.includes('sex')) return true;
    
    // Pattern: mostly isolated characters (e.g. "aa vr Ra vr")
    const words = line.split(/\s+/).filter(Boolean);
    const shortWords = words.filter(w => w.length <= 2);
    if (words.length > 2 && shortWords.length / words.length > 0.6) {
      return true;
    }

    // Pattern: matches multiple noise patterns
    let noiseHits = 0;
    for (const pattern of MedicalTokenService.NOISE_PATTERNS) {
      // reset regex index
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        noiseHits++;
      }
    }
    if (noiseHits >= 2) return true;

    return false;
  }
}
